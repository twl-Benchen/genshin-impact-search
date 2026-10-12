// 最簡單的 service worker：只為了讓網站可以安裝成 PWA（Android 分享選單才會出現本站）。
// 刻意不做任何快取，避免和 ?v= 版本號機制衝突、讓使用者看到舊版。
// 只處理頁面導覽：照常走網路，離線時顯示一行提示；其他請求（圖片、𝕏 媒體、CDN）完全不經過這裡。

self.addEventListener('install', function () {
    self.skipWaiting();
});

self.addEventListener('activate', function (event) {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
    if (event.request.mode !== 'navigate') return;
    event.respondWith(fetch(event.request).catch(function () {
        return new Response(
            '<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
            '<title>沒有網路</title><body style="font-family:sans-serif;padding:24px;background:#F6F2EA;color:#3B4255">' +
            '<p>目前沒有網路連線，請連上網路後重新整理。</p></body>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
    }));
});
