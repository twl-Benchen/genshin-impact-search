// 註冊 service worker，讓網站可以安裝成 PWA（Android 分享選單直達 merge.html）。
// iOS 不支援分享目標，但註冊本身無害；不支援或失敗時什麼都不做。
if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { });
    });
}
