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

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { parseStatusIds: parseStatusIds, originalPhotoUrl: originalPhotoUrl };
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

    async function fetchPhoto(url) {
        var res;
        try {
            res = await fetchWithTimeout(originalPhotoUrl(url));
            if (!res.ok) throw new Error();
        } catch (e) {
            // 原圖抓不到時，退回 API 給的網址
            res = await fetchWithTimeout(url);
            if (!res.ok) throw new Error('HTTP ' + res.status);
        }
        return res.blob();
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
        if (!photos.length) {
            var hasVideo = media.videos && media.videos.length;
            return { ok: false, author: author, text: hasVideo ? '這篇貼文是 GIF／影片，沒有圖片可以合併' : '這篇貼文沒有圖片', entries: [] };
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
        if (!entries.length) return { ok: false, author: author, text: '圖片下載失敗，請稍後再試', entries: [] };
        return {
            ok: true,
            author: author,
            text: entries.length + ' 張圖片' + (failed ? '（' + failed + ' 張下載失敗）' : ''),
            entries: entries
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
        results.forEach(function (r) { entries = entries.concat(r.entries); });
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

    window.MergeX = { parseStatusIds: parseStatusIds, run: run };
})();
