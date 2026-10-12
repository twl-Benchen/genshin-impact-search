// 圖片合併頁：資料夾分頁（圖片／影片）
// 目前分頁記在網址 hash（#video），重新整理或分享連結時會停在同一頁。
(function () {
    'use strict';

    var TABS = ['images', 'videos'];
    var current = null;

    function tab(name) { return document.getElementById('tab-' + name); }
    function panel(name) { return document.getElementById('panel-' + name); }

    function select(name, focus) {
        if (TABS.indexOf(name) === -1 || name === current) return;
        current = name;
        TABS.forEach(function (n) {
            var on = n === name;
            tab(n).setAttribute('aria-selected', on ? 'true' : 'false');
            tab(n).tabIndex = on ? 0 : -1;
            panel(n).hidden = !on;
        });
        if (focus) tab(name).focus();
        try {
            history.replaceState(null, '', name === 'videos' ? '#video' : location.pathname + location.search);
        } catch (e) { }
        // 讓預覽等依版面寬度計算的東西重新畫（隱藏時寬度是 0）
        document.dispatchEvent(new CustomEvent('merge-tab', { detail: name }));
    }

    function setCount(name, n) {
        var el = document.getElementById('count-' + name);
        el.textContent = n;
        el.hidden = !n;
    }

    TABS.forEach(function (name, i) {
        tab(name).addEventListener('click', function () { select(name); });
        // 左右方向鍵切換分頁（WAI-ARIA tabs 的慣例）
        tab(name).addEventListener('keydown', function (e) {
            var delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
            if (!delta) return;
            e.preventDefault();
            select(TABS[(i + delta + TABS.length) % TABS.length], true);
        });
    });

    window.MergeTabs = {
        select: select,
        setCount: setCount,
        current: function () { return current; }
    };

    function fromHash() {
        select(location.hash === '#video' ? 'videos' : 'images');
    }

    window.addEventListener('hashchange', fromHash);
    fromHash();
})();
