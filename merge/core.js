// 圖片合併頁（merge.html）：圖片清單、排序、合併繪製、canvas 上限、匯出下載
// 所有處理都在瀏覽器本地完成，不上傳任何伺服器。
(function () {
    'use strict';

    // ===== 常數 =====
    var THUMB_MAX = 240;      // 清單縮圖的最長邊
    var PREVIEW_MAX = 1600;   // 預覽用縮小圖的最長邊（全解析度只在下載時才解碼）
    var PREVIEW_AREA = 4000000; // 預覽 canvas 的最大面積
    var MAX_SIDE = 32767;     // Chrome／Firefox 的單邊上限
    var SETTINGS_KEY = 'genshin-merge-settings';
    var DEFAULTS = { direction: 'vertical', align: 'max', gap: 0, bg: '#ffffff', custom: '#3a4357', format: 'png', quality: 92 };

    // canvas 最大面積：iOS／iPadOS Safari 是 4096×4096；其他手機記憶體較少，保守一點
    var isIOS = /iP(hone|od|ad)/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var isMobile = isIOS || /Android|Mobile/i.test(navigator.userAgent);
    var MAX_AREA = window.__MERGE_MAX_AREA || (isIOS ? 16777216 : isMobile ? 33554432 : 100000000);

    // ===== 狀態 =====
    var items = [];     // { id, name, blob, width, height, preview: canvas, thumb: canvas, label }
    var nextId = 1;
    var settings = loadSettings();
    var cachedExport = null; // { key, blob, name }：設定沒變時，分享可以直接用，不必重畫

    var $ = function (id) { return document.getElementById(id); };
    var thumbList = $('thumb-list');
    var previewCanvas = $('preview-canvas');

    // ===== 設定（存在 sessionStorage，與首頁一樣只保留到分頁關閉） =====
    function loadSettings() {
        var s = {};
        try { s = JSON.parse(sessionStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { }
        var result = {};
        Object.keys(DEFAULTS).forEach(function (k) {
            result[k] = typeof s[k] === typeof DEFAULTS[k] ? s[k] : DEFAULTS[k];
        });
        return result;
    }

    function saveSettings() {
        try { sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { }
    }

    function setRadio(name, value) {
        var input = document.querySelector('input[name="' + name + '"][value="' + value + '"]');
        if (input) input.checked = true;
    }

    // 讓畫面跟著設定走（返回上一頁時瀏覽器可能會自己恢復表單狀態）
    function syncSettingsUI() {
        setRadio('direction', settings.direction);
        setRadio('align', settings.align);
        setRadio('format', settings.format);
        var preset = settings.bg !== 'custom' && document.querySelector('input[name="bg"][value="' + settings.bg + '"]');
        setRadio('bg', preset ? settings.bg : 'custom');
        $('gap-input').value = settings.gap;
        $('quality-input').value = settings.quality;
        $('bg-color').value = settings.custom;
        updateOptionLabels();
    }

    function updateOptionLabels() {
        var horizontal = settings.direction === 'horizontal';
        document.querySelectorAll('[name="align"] + span').forEach(function (span) {
            span.textContent = horizontal ? span.dataset.h : span.dataset.v;
        });
        $('align-note').textContent = horizontal ? '其他圖片會等比縮放，讓高度一致' : '其他圖片會等比縮放，讓寬度一致';
        $('gap-output').textContent = settings.gap + ' px';
        $('quality-output').textContent = settings.quality;
        $('quality-row').hidden = settings.format !== 'jpeg';
        $('custom-swatch').style.setProperty('--c', settings.custom);
        $('format-note').textContent = settings.format === 'jpeg' && backgroundColor() === 'transparent'
            ? 'JPG 不支援透明，背景會以白色填滿' : '';
    }

    function backgroundColor() {
        return settings.bg === 'custom' ? settings.custom : settings.bg;
    }

    function bindSettings() {
        document.querySelectorAll('input[name="direction"], input[name="align"], input[name="format"]').forEach(function (input) {
            input.addEventListener('change', function () {
                settings[input.name] = input.value;
                onSettingsChange();
            });
        });
        document.querySelectorAll('input[name="bg"]').forEach(function (input) {
            input.addEventListener('change', function () {
                settings.bg = input.value;
                onSettingsChange();
            });
        });
        // 點「自訂」圓點時打開取色器（已選取時再點一次也要打開）
        document.querySelector('.swatch.custom').addEventListener('click', function (e) {
            // 點 label 時，瀏覽器會再對裡面的 radio 觸發一次 click，只處理一次
            if (e.target.tagName !== 'INPUT') $('bg-color').click();
        });
        $('bg-color').addEventListener('input', function () {
            settings.custom = this.value;
            settings.bg = 'custom';
            setRadio('bg', 'custom');
            onSettingsChange();
        });
        $('gap-input').addEventListener('input', function () {
            settings.gap = Number(this.value);
            onSettingsChange();
        });
        $('quality-input').addEventListener('input', function () {
            settings.quality = Number(this.value);
            onSettingsChange();
        });
        window.addEventListener('pageshow', syncSettingsUI);
    }

    var renderQueued = false;
    function onSettingsChange() {
        saveSettings();
        updateOptionLabels();
        // 滑桿拖動時合併成一次重畫
        if (!renderQueued) {
            renderQueued = true;
            requestAnimationFrame(function () {
                renderQueued = false;
                renderPreview();
            });
        }
    }

    // ===== 讀取圖片 =====
    function isImageFile(file) {
        return /^image\//.test(file.type) || (!file.type && /\.(png|jpe?g|gif|webp|avif|bmp|heic|heif)$/i.test(file.name));
    }

    // 用 <img> 解碼：相容性最好（含 iOS 的 HEIC），並會依 EXIF 自動轉正
    function decodeImage(blob) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(blob);
            var img = new Image();
            img.decoding = 'async';
            img.onload = function () {
                resolve({ img: img, release: function () { URL.revokeObjectURL(url); } });
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error('decode'));
            };
            img.src = url;
        });
    }

    function scaledCopy(source, width, height, maxSide) {
        var s = Math.min(1, maxSide / Math.max(width, height));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(width * s));
        c.height = Math.max(1, Math.round(height * s));
        var ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(source, 0, 0, c.width, c.height);
        return c;
    }

    // entries: [{ blob, name, label }]；label 是縮圖下方的說明（例如來源作者），可省略
    async function addImages(entries) {
        var failed = [];
        setStatus('add-status', '讀取中…');
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            try {
                var decoded = await decodeImage(entry.blob);
                var img = decoded.img;
                var w = img.naturalWidth, h = img.naturalHeight;
                if (!w || !h) throw new Error('empty');
                var preview = scaledCopy(img, w, h, PREVIEW_MAX);
                decoded.release();
                items.push({
                    id: nextId++,
                    name: entry.name || '圖片',
                    label: entry.label || '',
                    blob: entry.blob,
                    width: w,
                    height: h,
                    preview: preview,
                    thumb: scaledCopy(preview, preview.width, preview.height, THUMB_MAX)
                });
            } catch (e) {
                failed.push(entry.name || '圖片');
            }
        }
        if (failed.length) {
            setStatus('add-status', '有 ' + failed.length + ' 張無法讀取（不是圖片或格式不支援）：' + failed.join('、'), true);
        } else {
            setStatus('add-status', '');
        }
        onItemsChange();
    }

    function addFiles(fileList) {
        var files = Array.prototype.filter.call(fileList, isImageFile);
        var skipped = fileList.length - files.length;
        if (!files.length) {
            if (skipped) setStatus('add-status', '只能加入圖片檔', true);
            return Promise.resolve();
        }
        return addImages(files.map(function (f) { return { blob: f, name: f.name }; }));
    }

    function setStatus(id, text, isError) {
        var el = $(id);
        el.textContent = text;
        el.classList.toggle('error', !!isError);
    }

    // ===== 縮圖清單 =====
    function onItemsChange() {
        cachedExport = null;
        renderList();
        renderPreview();
    }

    function moveItem(from, to) {
        if (to < 0 || to >= items.length || from === to) return;
        var moved = items.splice(from, 1)[0];
        items.splice(to, 0, moved);
    }

    function renderList() {
        var focusedKey = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.key;
        thumbList.textContent = '';
        items.forEach(function (item, index) {
            var li = document.createElement('li');
            li.className = 'thumb';
            li.dataset.id = item.id;

            var imgBox = document.createElement('div');
            imgBox.className = 'thumb-img';
            item.thumb.setAttribute('aria-hidden', 'true');
            imgBox.appendChild(item.thumb);

            var num = document.createElement('span');
            num.className = 'thumb-num';
            num.textContent = index + 1;

            var remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'thumb-remove';
            remove.textContent = '×';
            remove.setAttribute('aria-label', '移除第 ' + (index + 1) + ' 張');
            remove.addEventListener('click', function () {
                items.splice(items.indexOf(item), 1);
                onItemsChange();
                // 焦點移到下一張的移除鈕，連續刪除比較方便
                var next = thumbList.querySelectorAll('.thumb-remove')[Math.min(index, items.length - 1)];
                if (next) next.focus();
            });

            var bar = document.createElement('div');
            bar.className = 'thumb-bar';
            var prev = moveButton('◀', '往前移', item, -1);
            prev.disabled = index === 0;
            var next = moveButton('▶', '往後移', item, 1);
            next.disabled = index === items.length - 1;
            var size = document.createElement('span');
            size.className = 'thumb-size';
            size.textContent = item.label || (item.width + '×' + item.height);
            size.title = item.name + '（' + item.width + '×' + item.height + '）';
            bar.append(prev, size, next);

            li.append(imgBox, num, remove, bar);
            thumbList.appendChild(li);
        });

        if (focusedKey) {
            var again = thumbList.querySelector('[data-key="' + focusedKey + '"]');
            if (again && !again.disabled) again.focus();
        }

        $('list-head').hidden = items.length === 0;
        $('list-count').textContent = '共 ' + items.length + ' 張';
    }

    function moveButton(text, label, item, delta) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'thumb-move';
        btn.textContent = text;
        btn.setAttribute('aria-label', label);
        btn.dataset.key = item.id + ':' + delta;
        btn.addEventListener('click', function () {
            var from = items.indexOf(item);
            moveItem(from, from + delta);
            onItemsChange();
        });
        return btn;
    }

    function initSortable() {
        if (!window.Sortable) return; // CDN 載入失敗時仍可用 ◀ ▶ 排序
        window.Sortable.create(thumbList, {
            animation: 150,
            delay: 150,             // 手機上長按才開始拖曳，避免影響捲動
            delayOnTouchOnly: true,
            filter: 'button',
            preventOnFilter: false,
            onEnd: function (e) {
                if (e.oldIndex === e.newIndex) return;
                moveItem(e.oldIndex, e.newIndex);
                onItemsChange();
            }
        });
    }

    // ===== 合併版面計算 =====
    // 回傳原始尺寸（未套用 canvas 上限）下的版面
    function computeLayout() {
        var vertical = settings.direction === 'vertical';
        var sides = items.map(function (it) { return vertical ? it.width : it.height; });
        var base = settings.align === 'min' ? Math.min.apply(null, sides) : Math.max.apply(null, sides);
        var gap = settings.gap;
        var pos = 0;
        var rects = items.map(function (it) {
            var r;
            if (vertical) {
                var h = it.height * base / it.width;
                r = { x: 0, y: pos, w: base, h: h };
                pos += h + gap;
            } else {
                var w = it.width * base / it.height;
                r = { x: pos, y: 0, w: w, h: base };
                pos += w + gap;
            }
            return r;
        });
        var total = pos - gap;
        return {
            width: vertical ? base : total,
            height: vertical ? total : base,
            rects: rects
        };
    }

    // 依已知上限算出縮放比例
    function limitScale(width, height) {
        return Math.min(1, MAX_SIDE / width, MAX_SIDE / height, Math.sqrt(MAX_AREA / (width * height)));
    }

    // 實際建立 canvas 並讀回一個像素，確認這個尺寸瀏覽器真的畫得出來
    function canvasWorks(w, h) {
        var c = document.createElement('canvas');
        try {
            c.width = w;
            c.height = h;
            var ctx = c.getContext('2d');
            if (!ctx) return false;
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(w - 1, h - 1, 1, 1);
            return ctx.getImageData(w - 1, h - 1, 1, 1).data[0] === 255;
        } catch (e) {
            return false;
        } finally {
            c.width = c.height = 0; // 立刻釋放記憶體（iOS 特別需要）
        }
    }

    function outputSize(layout, scale) {
        return { width: Math.max(1, Math.round(layout.width * scale)), height: Math.max(1, Math.round(layout.height * scale)) };
    }

    function drawMerged(ctx, layout, scale, sources, fill) {
        var size = outputSize(layout, scale);
        ctx.clearRect(0, 0, size.width, size.height);
        if (fill !== 'transparent') {
            ctx.fillStyle = fill;
            ctx.fillRect(0, 0, size.width, size.height);
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        layout.rects.forEach(function (r, i) {
            placeImage(ctx, sources[i], r, scale);
        });
    }

    // 取整數座標，避免相鄰圖片之間出現細縫
    function placeImage(ctx, source, r, scale) {
        var x = Math.round(r.x * scale), y = Math.round(r.y * scale);
        var x2 = Math.round((r.x + r.w) * scale), y2 = Math.round((r.y + r.h) * scale);
        ctx.drawImage(source, x, y, x2 - x, y2 - y);
    }

    function exportFill() {
        var bg = backgroundColor();
        return settings.format === 'jpeg' && bg === 'transparent' ? '#ffffff' : bg;
    }

    // ===== 預覽 =====
    function renderPreview() {
        cachedExport = null;
        var has = items.length > 0;
        $('preview-empty').hidden = has;
        previewCanvas.hidden = !has;
        $('download-btn').disabled = !has;
        $('share-btn').disabled = !has;
        if (!has) {
            $('size-info').textContent = '';
            $('size-warn').hidden = true;
            return;
        }

        var layout = computeLayout();
        var scale = limitScale(layout.width, layout.height);
        var out = outputSize(layout, scale);
        $('size-info').textContent = '輸出尺寸：' + out.width + ' × ' + out.height + ' px';
        showSizeWarning(layout, scale);

        // 預覽只畫縮小版，解析度剛好填滿預覽框（寬度＋70vh 的高度）
        var dpr = window.devicePixelRatio || 1;
        var boxWidth = Math.max(200, $('preview-box').clientWidth - 24) * dpr;
        var boxHeight = window.innerHeight * 0.7 * dpr;
        var p = Math.min(1, Math.sqrt(PREVIEW_AREA / (layout.width * layout.height)),
            boxWidth / layout.width, boxHeight / layout.height);
        var size = outputSize(layout, p);
        previewCanvas.width = size.width;
        previewCanvas.height = size.height;
        drawMerged(previewCanvas.getContext('2d'), layout, p, items.map(function (it) { return it.preview; }), exportFill());
    }

    function showSizeWarning(layout, scale) {
        var warn = $('size-warn');
        if (scale >= 1) {
            warn.hidden = true;
            return;
        }
        var out = outputSize(layout, scale);
        warn.hidden = false;
        warn.textContent = '合併後 ' + Math.round(layout.width) + ' × ' + Math.round(layout.height) +
            ' px 超過此瀏覽器的圖片大小上限，已自動縮小為 ' + out.width + ' × ' + out.height +
            ' px（' + Math.round(scale * 100) + '%）。' +
            (isMobile ? '用電腦開啟可以輸出較大的尺寸。' : '');
    }

    // ===== 匯出 =====
    function exportKey() {
        return JSON.stringify([settings, items.map(function (it) { return it.id; })]);
    }

    function timestamp() {
        var d = new Date();
        var p = function (n) { return String(n).padStart(2, '0'); };
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    }

    async function buildExport() {
        var key = exportKey();
        if (cachedExport && cachedExport.key === key) return cachedExport;

        var layout = computeLayout();
        var scale = limitScale(layout.width, layout.height);
        // 已知上限之外，實際測試一次；畫不出來就再縮小
        var size = outputSize(layout, scale);
        while (!canvasWorks(size.width, size.height)) {
            scale *= 0.85;
            if (scale < 0.02) throw new Error('canvas');
            size = outputSize(layout, scale);
        }
        showSizeWarning(layout, scale);
        $('size-info').textContent = '輸出尺寸：' + size.width + ' × ' + size.height + ' px';

        var canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        var ctx = canvas.getContext('2d');

        // 一張一張解碼全解析度圖片，畫完就釋放，避免手機記憶體不足
        var fill = exportFill();
        if (fill !== 'transparent') {
            ctx.fillStyle = fill;
            ctx.fillRect(0, 0, size.width, size.height);
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        for (var i = 0; i < items.length; i++) {
            setStatus('export-status', '合併中… ' + (i + 1) + ' / ' + items.length);
            var decoded = await decodeImage(items[i].blob);
            placeImage(ctx, decoded.img, layout.rects[i], scale);
            decoded.release();
        }

        setStatus('export-status', '輸出檔案中…');
        var type = settings.format === 'jpeg' ? 'image/jpeg' : 'image/png';
        var blob = await new Promise(function (resolve) {
            canvas.toBlob(resolve, type, settings.quality / 100);
        });
        canvas.width = canvas.height = 0;
        if (!blob) throw new Error('toBlob');

        cachedExport = {
            key: key,
            blob: blob,
            name: 'merged-' + timestamp() + (settings.format === 'jpeg' ? '.jpg' : '.png')
        };
        return cachedExport;
    }

    function formatBytes(n) {
        return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    }

    function exportError() {
        setStatus('export-status', '合併失敗：圖片太大或記憶體不足。請減少圖片數量、改用「縮小到最窄」，或改用電腦操作。', true);
    }

    async function download() {
        var btn = $('download-btn');
        btn.disabled = true;
        try {
            var result = await buildExport();
            var url = URL.createObjectURL(result.blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = result.name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
            setStatus('export-status', '已下載 ' + result.name + '（' + formatBytes(result.blob.size) + '）');
        } catch (e) {
            exportError();
        } finally {
            btn.disabled = items.length === 0;
        }
    }

    // 手機上用系統分享，iOS 可以直接「儲存影像」到相簿
    async function share() {
        var btn = $('share-btn');
        var ready = cachedExport && cachedExport.key === exportKey();
        btn.disabled = true;
        try {
            var result = await buildExport();
            var file = new File([result.blob], result.name, { type: result.blob.type });
            try {
                await navigator.share({ files: [file] });
                setStatus('export-status', '');
            } catch (e) {
                if (e.name === 'AbortError') {
                    setStatus('export-status', '');
                } else if (!ready && e.name === 'NotAllowedError') {
                    // 合併花太久，瀏覽器不再視為使用者點擊；圖片已準備好，再按一次即可
                    setStatus('export-status', '圖片已準備好，請再按一次「分享／存到相簿」');
                } else {
                    setStatus('export-status', '此瀏覽器無法分享圖片，請改用「下載圖片」', true);
                }
            }
        } catch (e) {
            exportError();
        } finally {
            btn.disabled = items.length === 0;
        }
    }

    function canShareFiles() {
        try {
            return !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'a.png', { type: 'image/png' })] }));
        } catch (e) {
            return false;
        }
    }

    // ===== 上傳、拖放、貼上 =====
    function bindInputs() {
        var input = $('file-input');
        input.addEventListener('change', function () {
            addFiles(input.files).then(function () { input.value = ''; });
        });

        var zone = $('drop-zone');
        var hasFiles = function (e) {
            return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1;
        };
        var depth = 0;
        // 拖到整個頁面都可以放（只處理檔案，不影響縮圖拖曳排序）
        document.addEventListener('dragenter', function (e) {
            if (!hasFiles(e)) return;
            depth++;
            zone.classList.add('dragging');
        });
        document.addEventListener('dragleave', function (e) {
            if (!hasFiles(e)) return;
            depth = Math.max(0, depth - 1);
            if (depth === 0) zone.classList.remove('dragging');
        });
        document.addEventListener('dragover', function (e) {
            if (!hasFiles(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });
        document.addEventListener('drop', function (e) {
            if (!hasFiles(e)) return;
            e.preventDefault();
            depth = 0;
            zone.classList.remove('dragging');
            addFiles(e.dataTransfer.files);
        });

        document.addEventListener('paste', function (e) {
            var files = e.clipboardData && e.clipboardData.files;
            if (files && files.length) {
                e.preventDefault();
                addFiles(files);
            }
        });

        $('clear-btn').addEventListener('click', function () {
            items = [];
            setStatus('add-status', '');
            setStatus('export-status', '');
            onItemsChange();
        });

        $('download-btn').addEventListener('click', download);
        if (canShareFiles()) {
            $('share-btn').hidden = false;
            $('share-btn').addEventListener('click', share);
        }

        // 版面寬度改變時重畫預覽（例如手機轉向）
        var resizeTimer;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(renderPreview, 200);
        });
    }

    // 給之後的「貼 𝕏 連結抓圖」使用
    window.MergeCore = {
        addImages: addImages,
        setStatus: setStatus
    };

    syncSettingsUI();
    bindSettings();
    bindInputs();
    initSortable();
    renderList();
    renderPreview();
})();
