// 圖片合併頁：貼 𝕏 貼文連結 → 用 FxTwitter API 取得原圖 → 加進合併清單
// 連結解析的函式也可以在 Node 裡 require 測試
(function () {
    'use strict';

    var API = 'https://api.fxtwitter.com/status/';
    var TIMEOUT = 10000;

    // x.com、twitter.com 及常見的嵌入用網域；帳號、/i/、/i/web/ 或直接 /statuses/
    var LINK_PATTERN = /(?:^|[^\w.-])(?:https?:\/\/)?(?:www\.|mobile\.|m\.)?(?:x|twitter|fxtwitter|vxtwitter|fixupx|fixvx)\.com\/(?:(?:i\/web|i|[A-Za-z0-9_]{1,15})\/)?status(?:es)?\/(\d{1,25})/gi;

    // 從一段文字找出所有貼文 ID（去除重複、保留順序）
    function parseStatusIds(text) {
        var ids = [];
        var m;
        LINK_PATTERN.lastIndex = 0;
        while ((m = LINK_PATTERN.exec(text || ''))) {
            if (ids.indexOf(m[1]) === -1) ids.push(m[1]);
        }
        return ids;
    }

    // pbs.twimg.com 的圖片網址改成原圖
    function originalPhotoUrl(url) {
        return url.split('?')[0] + '?name=orig';
    }

    // 影片有多種畫質時，選 bitrate 最高的 MP4
    function bestVideoUrl(video) {
        var mp4 = (video.variants || []).filter(function (v) {
            return v && v.url && /mp4/.test(v.content_type || v.url);
        });
        if (!mp4.length) return video.url;
        mp4.sort(function (a, b) { return (b.bitrate || 0) - (a.bitrate || 0); });
        return mp4[0].url;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { parseStatusIds: parseStatusIds, originalPhotoUrl: originalPhotoUrl, bestVideoUrl: bestVideoUrl };
    }
    if (typeof document === 'undefined') return;

    // ===== 抓取 =====
    function FetchError(message) {
        this.message = message;
    }

    async function fetchWithTimeout(url) {
        var controller = window.AbortController ? new AbortController() : null;
        var timer = setTimeout(function () { if (controller) controller.abort(); }, TIMEOUT);
        try {
            return await fetch(url, controller ? { signal: controller.signal } : {});
        } finally {
            clearTimeout(timer);
        }
    }

    var API_DOWN = 'FxTwitter 服務暫時無法使用，請稍後再試';

    async function fetchTweet(id) {
        var res, data;
        try {
            res = await fetchWithTimeout(API + id);
        } catch (e) {
            throw new FetchError(API_DOWN);
        }
        try {
            data = await res.json();
        } catch (e) {
            data = null;
        }
        var code = data && data.code || res.status;
        if (code === 404) throw new FetchError('找不到這篇貼文（可能已刪除或連結錯誤）');
        if (code === 401 || data && data.message === 'PRIVATE_TWEET') throw new FetchError('這是私人帳號的貼文，無法取得');
        if (code !== 200 || !data || !data.tweet) throw new FetchError(API_DOWN);
        return data.tweet;
    }

    // 抓 𝕏 的圖片／影片。video.twimg.com 看到其他網站的 Referer 會回 403，
    // 所以一律不送 Referer；也因此影片不能直接 <video src>（<video> 無法設定 referrerpolicy），
    // 要先抓成 blob 再給 <video>。onProgress(0~1) 只在伺服器有回傳檔案大小時才會呼叫；
    // timeout（毫秒）可省略，影片檔較大就不設。
    async function fetchMedia(url, onProgress, timeout) {
        var controller = timeout && window.AbortController ? new AbortController() : null;
        var timer = controller && setTimeout(function () { controller.abort(); }, timeout);
        try {
            var res = await fetch(url, { referrerPolicy: 'no-referrer', signal: controller ? controller.signal : undefined });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            var total = Number(res.headers.get('content-length')) || 0;
            if (!onProgress || !total || !res.body || !res.body.getReader) return await res.blob();

            var reader = res.body.getReader();
            var chunks = [];
            var loaded = 0;
            for (;;) {
                var step = await reader.read();
                if (step.done) break;
                chunks.push(step.value);
                loaded += step.value.length;
                onProgress(Math.min(1, loaded / total));
            }
            return new Blob(chunks, { type: res.headers.get('content-type') || '' });
        } finally {
            clearTimeout(timer);
        }
    }

    async function fetchPhoto(url) {
        try {
            return await fetchMedia(originalPhotoUrl(url), null, 30000);
        } catch (e) {
            // 原圖抓不到時，退回 API 給的網址
            return fetchMedia(url, null, 30000);
        }
    }

    // 抓一篇貼文的所有圖片；回傳 { ok, text, entries }
    async function loadTweet(id) {
        var tweet;
        try {
            tweet = await fetchTweet(id);
        } catch (e) {
            return { ok: false, text: e instanceof FetchError ? e.message : API_DOWN, entries: [] };
        }
        var author = tweet.author && tweet.author.screen_name || 'x';
        var media = tweet.media || {};
        var photos = media.photos || [];
        var videos = (media.videos || []).filter(function (v) { return v && (v.url || v.variants); }).map(function (v, i, all) {
            return {
                url: bestVideoUrl(v),
                type: v.type === 'gif' ? 'gif' : 'video',
                thumb: v.thumbnail_url || '',
                width: v.width || 0,
                height: v.height || 0,
                duration: v.duration || 0,
                author: author,
                id: id,
                name: author + '_' + id + (all.length > 1 ? '_' + (i + 1) : '')
            };
        });
        var videoText = videos.length ? (videos.every(function (v) { return v.type === 'gif'; }) ? 'GIF ' : '影片 ') + videos.length + ' 支' : '';
        if (!photos.length) {
            if (videos.length) return { ok: true, author: author, text: videoText + '（在「影片」分頁）', entries: [], videos: videos };
            return { ok: false, author: author, text: '這篇貼文沒有圖片', entries: [] };
        }

        var results = await Promise.all(photos.map(function (p) {
            return fetchPhoto(p.url).catch(function () { return null; });
        }));
        var entries = [];
        var failed = 0;
        results.forEach(function (blob, i) {
            if (!blob) {
                failed++;
                return;
            }
            entries.push({
                blob: blob,
                name: author + '_' + id + '_' + (i + 1),
                label: '@' + author + (photos.length > 1 ? ' ' + (i + 1) + '/' + photos.length : ''),
                source: { author: author, id: id }
            });
        });
        if (!entries.length) {
            return { ok: false, author: author, text: '圖片下載失敗，請稍後再試' + (videoText ? '；' + videoText + '在「影片」分頁' : ''), entries: [], videos: videos };
        }
        return {
            ok: true,
            author: author,
            text: entries.length + ' 張圖片' + (failed ? '（' + failed + ' 張下載失敗）' : '') + (videoText ? '、' + videoText + '（在「影片」分頁）' : ''),
            entries: entries,
            videos: videos
        };
    }

    // ===== 介面 =====
    var input = document.getElementById('link-input');
    var button = document.getElementById('fetch-btn');
    var list = document.getElementById('fetch-results');
    var busy = false;

    function resultRow(id, state, text) {
        var li = document.createElement('li');
        li.className = 'fetch-row ' + state;
        var mark = document.createElement('span');
        mark.className = 'fetch-mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.textContent = state === 'ok' ? '✓' : state === 'error' ? '!' : '…';
        var label = document.createElement('span');
        label.className = 'fetch-text';
        label.textContent = text;
        li.append(mark, label);
        li.dataset.id = id;
        return li;
    }

    async function run(text) {
        if (busy) return;
        var ids = parseStatusIds(text);
        list.textContent = '';
        if (!ids.length) {
            list.appendChild(resultRow('', 'error', '看不出是 𝕏 貼文連結，請貼上像 https://x.com/帳號/status/數字 這樣的網址'));
            return;
        }

        busy = true;
        button.disabled = true;
        var rows = ids.map(function (id) {
            var row = resultRow(id, 'loading', '貼文 ' + id + '：抓取中…');
            list.appendChild(row);
            return row;
        });

        // 多篇同時抓，但依貼上順序加進清單
        var results = await Promise.all(ids.map(function (id, i) {
            return loadTweet(id).then(function (r) {
                var prefix = r.author ? '@' + r.author + '（' + id + '）：' : '貼文 ' + id + '：';
                rows[i].replaceWith(rows[i] = resultRow(id, r.ok ? 'ok' : 'error', prefix + r.text));
                return r;
            });
        }));
        var entries = [];
        var videos = [];
        results.forEach(function (r) {
            entries = entries.concat(r.entries);
            videos = videos.concat(r.videos || []);
        });
        if (videos.length && window.MergeGif) window.MergeGif.addVideos(videos);
        // 只有影片就切到「影片」分頁、只有圖片就切到「圖片」；兩種都有時留在原分頁，看分頁上的數字
        if (videos.length && !entries.length) window.MergeTabs.select('videos');
        if (entries.length && !videos.length) window.MergeTabs.select('images');
        if (entries.length) await window.MergeCore.addImages(entries);

        busy = false;
        button.disabled = false;
        // 全部成功就清空輸入框，方便貼下一批
        if (results.every(function (r) { return r.ok; })) input.value = '';
    }

    button.addEventListener('click', function () {
        run(input.value);
    });

    // Ctrl／⌘ + Enter 送出
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            run(input.value);
        }
    });

    // 貼到輸入框時直接開始抓
    input.addEventListener('paste', function () {
        setTimeout(function () {
            if (parseStatusIds(input.value).length) run(input.value);
        });
    });

    // 在頁面其他地方貼上連結也可以（貼上圖片檔由 core.js 處理）
    document.addEventListener('paste', function (e) {
        var target = e.target;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        var data = e.clipboardData;
        if (!data || (data.files && data.files.length)) return;
        var text = data.getData('text');
        if (!parseStatusIds(text).length) return;
        e.preventDefault();
        input.value = text;
        run(text);
    });

    window.MergeX = { parseStatusIds: parseStatusIds, fetchMedia: fetchMedia, run: run };
})();
