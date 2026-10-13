# 開發者說明

網站功能說明請見 [README](../README.md)。

## 技術概要

- 純 HTML／CSS／JavaScript，**沒有框架、沒有建置步驟**，瀏覽器直接讀檔；部署在 GitHub Pages（`main` 分支）。
- 角色資料用 `<script>` 載入（不是 `fetch` JSON），所以直接雙擊 `index.html`（`file://`）也能用。
- 圖片合併頁使用的外部服務與函式庫：
  - [FxTwitter API](https://github.com/FixTweet/FxTwitter)（`api.fxtwitter.com`）：取得貼文的圖片與影片網址，不使用 𝕏 官方 API。
  - [SortableJS](https://github.com/SortableJS/Sortable)：拖曳排序（觸控也能用），從 jsDelivr CDN 載入。
  - [gifenc](https://github.com/mattdesl/gifenc)：GIF 編碼，在 Web Worker 裡執行，從 jsDelivr CDN 載入。
- 𝕏 的影片伺服器會拒絕帶有其他網站 Referer 的請求，所以所有 𝕏 媒體都用 `fetch(網址, { referrerPolicy: 'no-referrer' })` 下載成 blob 再處理。

## 檔案結構

```
index.html              首頁（角色搜尋）：CSS、HTML、JS 都在這個檔案裡
characters.js           角色與元素資料（ELEMENTS、CHARACTERS）
img/
  characters/、elements/  本地角色頭像與元素圖示（WebP，由腳本產生）
  manifest.js           本地圖片清單（自動產生）
  app-icon-*.png        App 圖示（由腳本產生）
merge.html              圖片合併下載頁
merge/
  ui.js                 資料夾分頁、膠囊切換鈕
  core.js               圖片清單、排序、合併、匯出
  x.js                  𝕏 連結解析、FxTwitter API、分享直達
  gif.js                MP4 下載、GIF 轉檔
  merge.css             合併頁樣式
manifest.json、sw.js、pwa.js   PWA（可安裝、Android 分享直達）
scripts/                維護用腳本（見下方）
.github/workflows/      characters.js 更新時自動下載角色圖片
```

## 在本機執行

```bash
git clone https://github.com/twl-Benchen/genshin-impact-search.git
cd genshin-impact-search
python3 -m http.server 8000
# 開啟 http://localhost:8000/
```

直接雙擊 `index.html` 也能用；但 Service Worker 與「安裝成 App」需要透過 `http://localhost` 或 HTTPS 開啟。

## 新增角色

在 `characters.js` 對應元素的區塊加一行：

```js
{ id: 'Jean', name: '琴', element: 'Anemo', rarity: 5,
  tags: { en: 'Jean' },                        // 一般 hashtag：en／ja／tw／cn，沒有的語言就不寫
  common: { ja: 'ジン', tw: '琴', cn: '琴' },   // 選填：太常見的字，只在進階搜尋時加上 #原神 使用
  img: 'https://…HoYoWiki 官方圖網址…' },
```

- `id`：英文 hashtag，也是網址與圖片檔名用的唯一識別。
- `rarity`：4 或 5，決定卡片底色。
- 推到 `main` 後，GitHub Action 會自動下載頭像、轉成小尺寸 WebP、更新圖片清單與版本號並提交。

## 維護腳本

第一次執行前先 `npm install`（只有 sharp 一個相依套件，網頁本身不需要建置）。

| 指令 | 用途 |
|---|---|
| `node scripts/download-icons.mjs` | 下載 `characters.js` 裡的角色圖片、轉成 WebP、產生 `img/manifest.js`、更新 `index.html` 的 `?v=` 版本號（Action 會自動執行） |
| `node scripts/update-merge-version.mjs` | 改了 `merge/` 底下的檔案後執行，更新 `merge.html` 裡的 `?v=` 版本號 |
| `node scripts/generate-app-icons.mjs` | 重新產生 App 圖示 |

`?v=` 版本號是為了避開 GitHub Pages 的快取（約 10 分鐘），避免新的 HTML 配上舊的 JS／CSS。
