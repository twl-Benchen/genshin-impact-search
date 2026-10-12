// 圖片合併頁：𝕏 的 GIF／影片 → 下載 MP4、轉成 GIF
// 𝕏 的 GIF 其實是 MP4。影片一律用 MergeX.fetchMedia（不送 Referer）抓成 blob，
// 再用 object URL 給 <video>；不可直接 <video src=影片網址>（會被 video.twimg.com 回 403）。
// GIF 編碼用 gifenc，在 module Worker 裡執行；Worker 不能用時退回主執行緒。
(function () {
    'use strict';

    // ===== 讀 MP4 的原始幀率 =====
    // 瀏覽器不提供影片幀率，所以直接讀 MP4 檔頭：找影片軌（hdlr = vide）的 mdhd（時間單位）與
    // stts（每一幀的時間長度），幀率 = 幀數 ÷ 總時間。讀不到（不是 MP4、檔案壞掉）時回傳 0。
    var CONTAINERS = ['moov', 'trak', 'mdia', 'minf', 'stbl'];

    function readBoxes(view, start, end, visit) {
        var pos = start;
        while (pos + 8 <= end) {
            var size = view.getUint32(pos);
            var type = String.fromCharCode(view.getUint8(pos + 4), view.getUint8(pos + 5), view.getUint8(pos + 6), view.getUint8(pos + 7));
            var header = 8;
            if (size === 1) {
                if (pos + 16 > end) return;
                size = view.getUint32(pos + 8) * 4294967296 + view.getUint32(pos + 12);
                header = 16;
            } else if (size === 0) {
                size = end - pos;
            }
            if (size < header || pos + size > end) return;
            visit(type, pos + header, pos + size);
            pos += size;
        }
    }

    function detectMp4Fps(buffer) {
        var view = new DataView(buffer);
        var fps = 0;
        function walkTrack(start, end) {
            var track = { video: false, timescale: 0, frames: 0, ticks: 0 };
            (function walk(s, e) {
                readBoxes(view, s, e, function (type, bs, be) {
                    if (type === 'hdlr' && be - bs >= 12) {
                        track.video = view.getUint32(bs + 8) === 0x76696465; // 'vide'
                    } else if (type === 'mdhd') {
                        var v1 = view.getUint8(bs) === 1;
                        track.timescale = view.getUint32(bs + (v1 ? 20 : 12));
                    } else if (type === 'stts' && be - bs >= 8) {
                        var count = view.getUint32(bs + 4);
                        for (var i = 0; i < count && bs + 16 + i * 8 <= be; i++) {
                            var n = view.getUint32(bs + 8 + i * 8);
                            track.frames += n;
                            track.ticks += n * view.getUint32(bs + 12 + i * 8);
                        }
                    } else if (CONTAINERS.indexOf(type) !== -1) {
                        walk(bs, be);
                    }
                });
            })(start, end);
            if (!fps && track.video && track.timescale && track.ticks) fps = track.frames / (track.ticks / track.timescale);
        }
        try {
            readBoxes(view, 0, view.byteLength, function (type, bs, be) {
                if (type !== 'moov') return;
                readBoxes(view, bs, be, function (t, ts, te) {
                    if (t === 'trak') walkTrack(ts, te);
                });
            });
        } catch (e) {
            return 0;
        }
        return fps > 0 && fps < 1000 ? fps : 0;
    }

    // GIF 的延遲以 10ms 為單位：把每一幀的時間累加後再取整，總長度才會和原影片一樣
    // （例如 24fps 不會因為每幀都四捨五入成 40ms 而變快）
    function frameDelay(i, fps) {
        return Math.round((i + 1) * 100 / fps) * 10 - Math.round(i * 100 / fps) * 10;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { detectMp4Fps: detectMp4Fps, frameDelay: frameDelay };
    }
    if (typeof document === 'undefined') return;

    var GIFENC_URL = 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js';
    var SETTINGS_KEY = 'genshin-gif-settings';
    var DEFAULTS = { fps: 0, width: 0 }; // 0 = 原始
    var MAX_GIF_FPS = 50;   // GIF 每幀至少 20ms，更快的話瀏覽器會放慢播放
    var FALLBACK_FPS = 30;  // 讀不到原始幀率時使用
    var LONG_VIDEO = 20;    // 秒；超過時提示 GIF 會很大
    var MAX_QUEUE = 6;      // 等待編碼的幀數上限，避免擷取太快塞爆記憶體
    var SEEK_TIMEOUT = 3000;

    var $ = function (id) { return document.getElementById(id); };
    var videos = [];
    var nextKey = 1;
    var settings = loadSettings();
    var job = null;         // 進行中的工作：{ cancelled, cleanup }
    var result = null;      // { blob, name, url }

    // ===== 設定（sessionStorage） =====
    function loadSettings() {
        var s = {};
        try { s = JSON.parse(sessionStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { }
        return {
            fps: [0, 30, 20, 15, 10].indexOf(s.fps) !== -1 ? s.fps : DEFAULTS.fps,
            width: [0, 480, 320, 240].indexOf(s.width) !== -1 ? s.width : DEFAULTS.width
        };
    }

    function syncSettingsUI() {
        var fps = document.querySelector('input[name="fps"][value="' + settings.fps + '"]');
        var width = document.querySelector('input[name="gif-width"][value="' + settings.width + '"]');
        if (fps) fps.checked = true;
        if (width) width.checked = true;
        window.MergeUI.updateSegmented();
    }

    function bindSettings() {
        document.querySelectorAll('input[name="fps"], input[name="gif-width"]').forEach(function (input) {
            input.addEventListener('change', function () {
                settings[input.name === 'fps' ? 'fps' : 'width'] = Number(input.value);
                try { sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { }
                renderList();
            });
        });
        window.addEventListener('pageshow', syncSettingsUI);
    }

    // ===== 影片清單 =====
    // list: [{ url, type, thumb, width, height, duration, author, id, name }]
    function addVideos(list) {
        list.forEach(function (v) {
            if (videos.some(function (old) { return old.url === v.url; })) return;
            v.key = nextKey++;
            v.blob = null;
            videos.push(v);
        });
        renderList();
    }

    function formatSeconds(s) {
        return s ? (Math.round(s * 10) / 10) + ' 秒' : '';
    }

    function outputWidth(v) {
        var src = v.width || 0;
        if (!settings.width) return src;
        return src ? Math.min(settings.width, src) : settings.width;
    }

    function button(cls, icon, text) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gbtn' + (cls ? ' ' + cls : '');
        var i = document.createElement('span');
        i.className = 'icon';
        i.setAttribute('aria-hidden', 'true');
        i.textContent = icon;
        var t = document.createElement('span');
        t.textContent = text;
        btn.append(i, t);
        return btn;
    }

    function renderList() {
        var list = $('video-list');
        list.textContent = '';
        videos.forEach(function (v) {
            var li = document.createElement('li');
            li.className = 'video-row';

            var thumb = document.createElement('div');
            thumb.className = 'video-thumb';
            if (v.thumb) {
                var img = document.createElement('img');
                img.alt = '';
                img.referrerPolicy = 'no-referrer';
                img.loading = 'lazy';
                img.src = v.thumb;
                thumb.appendChild(img);
            }
            var badge = document.createElement('span');
            badge.className = 'video-badge';
            badge.textContent = v.type === 'gif' ? 'GIF' : '影片';
            thumb.appendChild(badge);

            var meta = document.createElement('div');
            meta.className = 'video-meta';
            var title = document.createElement('b');
            title.textContent = '@' + v.author;
            var detail = document.createElement('span');
            detail.textContent = [formatSeconds(v.duration), v.width && v.height ? v.width + '×' + v.height : ''].filter(Boolean).join(' · ');
            meta.append(title, detail);
            if (v.duration > LONG_VIDEO) {
                var note = document.createElement('span');
                note.className = 'video-note';
                note.textContent = '影片較長，GIF 會很大，建議降低幀率或寬度';
                meta.appendChild(note);
            }

            var remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'video-remove';
            remove.textContent = '×';
            remove.setAttribute('aria-label', '移除 @' + v.author + ' 的' + (v.type === 'gif' ? ' GIF' : '影片'));
            remove.disabled = !!job;
            remove.addEventListener('click', function () {
                videos.splice(videos.indexOf(v), 1);
                renderList();
            });

            var actions = document.createElement('div');
            actions.className = 'video-actions';
            var mp4 = button('', '↓', '下載 MP4');
            mp4.disabled = !!job;
            mp4.addEventListener('click', function () { downloadMp4(v); });
            var gif = button('primary', 'G', '轉成 GIF');
            gif.disabled = !!job;
            gif.addEventListener('click', function () { convert(v); });
            actions.append(mp4, gif);

            li.append(thumb, meta, remove, actions);
            list.appendChild(li);
        });

        var has = videos.length > 0;
        $('video-empty').hidden = has;
        $('gif-options').hidden = !has;
        window.MergeUI.setCount('videos', videos.length);
    }

    // ===== 進度與狀態 =====
    function setStatus(text, isError) {
        window.MergeCore.setStatus('gif-status', text, isError);
    }

    function showJob(text, progress) {
        $('gif-job').hidden = false;
        $('job-text').textContent = text;
        var bar = $('job-progress');
        if (progress == null) bar.removeAttribute('value');
        else bar.value = progress;
    }

    function startJob() {
        job = { cancelled: false, cleanup: [] };
        setStatus('');
        renderList();
        return job;
    }

    function endJob() {
        if (job) job.cleanup.forEach(function (fn) { try { fn(); } catch (e) { } });
        job = null;
        $('gif-job').hidden = true;
        renderList();
    }

    function Cancelled() { }

    // 要直接顯示給使用者的錯誤訊息
    function UserError(message) {
        this.message = message;
    }

    function checkCancel(j) {
        if (j.cancelled) throw new Cancelled();
    }

    // ===== 下載影片 =====
    async function getBlob(v, j) {
        if (v.blob) return v.blob;
        showJob('下載影片中…', null);
        try {
            v.blob = await window.MergeX.fetchMedia(v.url, function (p) {
                if (!j.cancelled) showJob('下載影片中… ' + Math.round(p * 100) + '%', p);
            });
        } catch (e) {
            checkCancel(j);
            throw new UserError('影片下載失敗（𝕏 拒絕或網路問題），請稍後再試');
        }
        checkCancel(j);
        return v.blob;
    }

    async function downloadMp4(v) {
        if (job) return;
        var j = startJob();
        try {
            var blob = await getBlob(v, j);
            window.MergeCore.saveBlob(blob, v.name + '.mp4');
            setStatus('已下載 ' + v.name + '.mp4（' + window.MergeCore.formatBytes(blob.size) + '）');
        } catch (e) {
            setStatus(e instanceof Cancelled ? '已取消' : e instanceof UserError ? e.message : '影片下載失敗，請稍後再試', !(e instanceof Cancelled));
        } finally {
            endJob();
        }
    }

    // ===== 讀取影片 =====
    function once(target, okEvent, timeout) {
        return new Promise(function (resolve, reject) {
            var timer;
            function done(ok, e) {
                clearTimeout(timer);
                target.removeEventListener(okEvent, onOk);
                target.removeEventListener('error', onErr);
                ok ? resolve() : reject(e);
            }
            function onOk() { done(true); }
            function onErr(e) { done(false, e || new Error('error')); }
            target.addEventListener(okEvent, onOk);
            target.addEventListener('error', onErr);
            if (timeout) timer = setTimeout(function () { done(false, new Error('timeout')); }, timeout);
        });
    }

    async function openVideo(blob, j) {
        var url = URL.createObjectURL(blob);
        var video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.preload = 'auto';
        // 放進頁面（看不到）：iOS Safari 對不在頁面上的影片有時不解碼
        video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
        document.body.appendChild(video);
        j.cleanup.push(function () {
            video.removeAttribute('src');
            video.load();
            video.remove();
            URL.revokeObjectURL(url);
        });

        var loaded = once(video, 'loadeddata', 20000);
        video.src = url;
        video.load();
        try {
            await loaded;
        } catch (e) {
            throw new UserError('這個瀏覽器無法讀取這支影片');
        }
        // 先播一下再暫停，讓 iOS 開始解碼畫面（失敗也沒關係）
        try {
            await video.play();
            video.pause();
        } catch (e) { }
        return video;
    }

    async function seekTo(video, time) {
        if (Math.abs(video.currentTime - time) < 0.0005) return;
        var seeked = once(video, 'seeked', SEEK_TIMEOUT);
        video.currentTime = time;
        try {
            await seeked;
        } catch (e) {
            // iOS 偶爾不觸發 seeked，逾時就直接用目前畫面
        }
    }

    // ===== GIF 編碼器 =====
    var WORKER_SOURCE = [
        "import { GIFEncoder, quantize, applyPalette } from '" + GIFENC_URL + "';",
        'let gif, width, height, count = 0;',
        'self.onmessage = (e) => {',
        '    const m = e.data;',
        "    if (m.type === 'init') { gif = GIFEncoder(); width = m.width; height = m.height; return; }",
        "    if (m.type === 'frame') {",
        '        const rgba = new Uint8ClampedArray(m.buffer);',
        '        const palette = quantize(rgba, 256);',
        '        gif.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay: m.delay });',
        "        self.postMessage({ type: 'progress', encoded: ++count });",
        '        return;',
        '    }',
        "    if (m.type === 'finish') {",
        '        gif.finish();',
        '        const bytes = gif.bytes();',
        "        self.postMessage({ type: 'done', bytes }, [bytes.buffer]);",
        '    }',
        '};',
        "self.postMessage({ type: 'ready' });"
    ].join('\n');

    // 統一介面：{ add(buffer, delay), finish() → Promise<Uint8Array>, encoded, terminate() }
    function workerEncoder(width, height) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
            var worker;
            try {
                worker = new Worker(url, { type: 'module' });
            } catch (e) {
                URL.revokeObjectURL(url);
                reject(e);
                return;
            }
            var enc = {
                encoded: 0,
                failed: false,
                onprogress: null,
                add: function (buffer, delay) { worker.postMessage({ type: 'frame', buffer: buffer, delay: delay }, [buffer]); },
                finish: function () {
                    return new Promise(function (res) {
                        finishResolve = res;
                        worker.postMessage({ type: 'finish' });
                    });
                },
                terminate: function () {
                    worker.terminate();
                    URL.revokeObjectURL(url);
                }
            };
            var finishResolve;
            var timer = setTimeout(function () { fail(new Error('timeout')); }, 20000);
            function fail(e) {
                clearTimeout(timer);
                enc.terminate();
                reject(e);
            }
            worker.onerror = function (e) {
                e.preventDefault && e.preventDefault();
                fail(new Error('worker'));
            };
            worker.onmessage = function (e) {
                var m = e.data;
                if (m.type === 'ready') {
                    clearTimeout(timer);
                    // 編碼途中出錯（例如記憶體不足）：標記起來，讓等待中的迴圈停下
                    worker.onerror = function (err) {
                        err.preventDefault && err.preventDefault();
                        enc.failed = true;
                        if (finishResolve) finishResolve(null);
                    };
                    worker.postMessage({ type: 'init', width: width, height: height });
                    resolve(enc);
                } else if (m.type === 'progress') {
                    enc.encoded = m.encoded;
                    if (enc.onprogress) enc.onprogress();
                } else if (m.type === 'done') {
                    finishResolve(m.bytes);
                }
            };
        });
    }

    // 備案：主執行緒編碼（舊瀏覽器不支援 module Worker 時）
    async function mainThreadEncoder(width, height) {
        var lib = await import(GIFENC_URL);
        var gif = lib.GIFEncoder();
        var enc = {
            encoded: 0,
            onprogress: null,
            add: function (buffer, delay) {
                var rgba = new Uint8ClampedArray(buffer);
                var palette = lib.quantize(rgba, 256);
                gif.writeFrame(lib.applyPalette(rgba, palette), width, height, { palette: palette, delay: delay });
                enc.encoded++;
                if (enc.onprogress) enc.onprogress();
            },
            finish: function () {
                gif.finish();
                return Promise.resolve(gif.bytes());
            },
            terminate: function () { }
        };
        return enc;
    }

    async function createEncoder(width, height) {
        if (window.Worker && !window.__GIF_NO_WORKER) {
            try {
                return await workerEncoder(width, height);
            } catch (e) { }
        }
        try {
            return await mainThreadEncoder(width, height);
        } catch (e) {
            throw new UserError('GIF 編碼器載入失敗，請檢查網路後重試');
        }
    }

    function waitFor(check) {
        return new Promise(function (resolve) {
            (function poll() {
                if (check()) resolve();
                else setTimeout(poll, 30);
            })();
        });
    }

    // ===== 轉成 GIF =====
    async function convert(v) {
        if (job) return;
        var j = startJob();
        clearResult();
        try {
            var blob = await getBlob(v, j);
            showJob('讀取影片中…', null);
            var video = await openVideo(blob, j);
            checkCancel(j);

            var duration = isFinite(video.duration) && video.duration > 0 ? video.duration : v.duration || 1;
            // 原始幀率：從 MP4 檔頭讀，最高 50；讀不到就用 30
            var sourceFps = detectMp4Fps(await blob.arrayBuffer());
            var fps = settings.fps || Math.min(MAX_GIF_FPS, sourceFps || FALLBACK_FPS);
            var total = Math.max(1, Math.floor(duration * fps));
            if (total > 900 && !confirm('這支影片約 ' + Math.round(duration) + ' 秒，會產生 ' + total + ' 幀，GIF 可能非常大、轉檔很久。確定要轉嗎？')) {
                throw new Cancelled();
            }

            var srcW = video.videoWidth || v.width || 480;
            var srcH = video.videoHeight || v.height || 270;
            var width = settings.width ? Math.min(settings.width, srcW) : srcW;
            var height = Math.max(1, Math.round(srcH * width / srcW));

            showJob('載入 GIF 編碼器…', null);
            var encoder = await createEncoder(width, height);
            j.cleanup.push(function () { encoder.terminate(); });
            checkCancel(j);

            var canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            var ctx = canvas.getContext('2d', { willReadFrequently: true });
            var captured = 0;
            var report = function () {
                if (j.cancelled) return;
                showJob('轉檔中：擷取 ' + captured + '/' + total + ' 幀 · 編碼 ' + encoder.encoded + '/' + total,
                    (captured + encoder.encoded) / (total * 2));
            };
            encoder.onprogress = report;

            for (var i = 0; i < total; i++) {
                checkCancel(j);
                // 編碼跟不上時先等一下
                await waitFor(function () { return j.cancelled || encoder.failed || captured - encoder.encoded < MAX_QUEUE; });
                checkCancel(j);
                if (encoder.failed) throw new Error('encoder');
                // 取每一格時間的中間點，避免剛好落在兩幀交界而重複或漏幀
                await seekTo(video, Math.min((i + 0.5) / fps, Math.max(0, duration - 0.001)));
                checkCancel(j);
                ctx.drawImage(video, 0, 0, width, height);
                var frame = ctx.getImageData(0, 0, width, height);
                captured++;
                encoder.add(frame.data.buffer, frameDelay(i, fps));
                report();
                // 主執行緒編碼時讓畫面有機會更新
                await new Promise(function (r) { setTimeout(r, 0); });
            }

            await waitFor(function () { return j.cancelled || encoder.failed || encoder.encoded >= total; });
            checkCancel(j);
            if (encoder.failed) throw new Error('encoder');
            showJob('完成編碼…', 1);
            var bytes = await encoder.finish();
            checkCancel(j);
            if (!bytes) throw new Error('encoder');
            showResult(new Blob([bytes], { type: 'image/gif' }), v.name + '.gif', width, height, total, fps);
        } catch (e) {
            if (e instanceof Cancelled) {
                setStatus('已取消');
            } else {
                setStatus(e instanceof UserError ? e.message : '轉檔失敗，請降低寬度或幀率再試', true);
            }
        } finally {
            endJob();
        }
    }

    // ===== 結果 =====
    function clearResult() {
        if (result) URL.revokeObjectURL(result.url);
        result = null;
        $('gif-result').hidden = true;
        $('gif-preview').removeAttribute('src');
    }

    function showResult(blob, name, width, height, frames, fps) {
        result = { blob: blob, name: name, url: URL.createObjectURL(blob) };
        $('gif-preview').src = result.url;
        $('gif-info').textContent = name + '：' + width + ' × ' + height + ' px · ' + frames + ' 幀 · ' + (Math.round(fps * 10) / 10) + ' fps · ' + window.MergeCore.formatBytes(blob.size);
        $('gif-result').hidden = false;
        $('gif-share').hidden = !window.MergeCore.canShareFiles('image/gif');
    }

    function bindResult() {
        $('job-cancel').addEventListener('click', function () {
            if (job) job.cancelled = true;
        });
        $('gif-download').addEventListener('click', function () {
            if (result) window.MergeCore.saveBlob(result.blob, result.name);
        });
        $('gif-share').addEventListener('click', function () {
            if (!result) return;
            window.MergeCore.shareBlob(result.blob, result.name).catch(function (e) {
                if (e.name !== 'AbortError') setStatus('此瀏覽器無法分享 GIF，請改用「下載 GIF」', true);
            });
        });
    }

    window.MergeGif = { addVideos: addVideos };

    syncSettingsUI();
    bindSettings();
    bindResult();
    renderList();
})();
