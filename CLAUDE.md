# 原神角色 𝕏 圖片搜尋

點選原神角色 → 產生 𝕏（Twitter）hashtag 搜尋網址 → 到 𝕏 找角色圖片。
純靜態網頁，部署在 GitHub Pages：https://twl-benchen.github.io/genshin-impact-search/
（從 `main` 分支發布，合併後約一兩分鐘生效）

使用者以繁體中文溝通，畫面文字、程式註解、commit 訊息都用繁體中文。

## 架構

沒有框架、沒有建置步驟，瀏覽器直接讀檔。

| 檔案 | 用途 |
|---|---|
| `index.html` | 整個網頁：CSS、HTML、JS 都在裡面 |
| `characters.js` | 角色與元素資料（`ELEMENTS`、`CHARACTERS`），同時支援瀏覽器 `<script>` 與 Node `require` |
| `img/characters/*`、`img/elements/*` | 本地頭像與元素圖示（由腳本下載，勿手動放） |
| `img/manifest.js` | 自動產生的本地圖片清單 `window.LOCAL_ICONS`，勿手動編輯 |
| `scripts/download-icons.mjs` | 下載 `characters.js` 裡的圖片到 `img/`、產生 manifest、更新 `index.html` 的資料版本號 |
| `.github/workflows/download-icons.yml` | `main` 上 `characters.js` 有變動時自動執行上面的腳本並提交（也可手動執行） |

資料用 `<script>` 載入而不是 `fetch` JSON，這樣直接雙擊 `index.html`（`file://`）也能用。

### 角色資料格式（`characters.js`）

```js
{ id: 'Jean', name: '琴', element: 'Anemo', rarity: 5,
  tags: { en: 'Jean' },                               // 一般 hashtag（en/ja/tw/cn）
  common: { ja: 'ジン', tw: '琴', cn: '琴' },          // 選填：常見字 tag，只在進階搜尋時使用
  img: 'https://...HoYoWiki 官方圖...' },
```

- `id`：英文 hashtag，也是網址 hash 與圖片檔名用的唯一識別。
- `rarity`：4 或 5，決定卡片底色；`Other`（旅行者、派蒙等）一律 5。
- `tags`：沒有的語言就不寫。太常見的字（琴、砂糖、北斗、ジン、ガイア、レザー…）不放 `tags`，改放 `common`。
- 新增角色：在對應元素區塊加一行即可，推到 `main` 後 Action 會自動下載圖片。

### 搜尋語法（`index.html` 的 `termsFor` / `buildQuery`）

- 每個角色依「搜尋語言」設定取出 tag，同一角色內用 OR：`(#Klee OR #クレー OR #可莉)`。
- 進階搜尋開啟時，`common` 的 tag 會加上 #原神 限定：`(#琴 #原神)`。
- AND 模式：各角色的組之間用空格（同時出現）；OR 模式：全部攤平用 OR。
- 所選語言都沒有 tag 時，退回英文 tag，角色不會從搜尋中消失。
- 網址：`https://x.com/search?q=` + `encodeURIComponent(query)`。

### 狀態

- 已選角色與元素篩選：存在網址 hash（`#c=Klee,Nahida&e=Pyro`），並備份到 localStorage（沒有 hash 時還原）。
- 設定面板（AND/OR、搜尋語言、進階搜尋）：**刻意不保存**，每次開啟都回到預設（AND、四種語言全選、進階搜尋關閉）。這是使用者的要求。

### 圖片載入順序

本地圖片（`LOCAL_ICONS`）→ `characters.js` 的原網址 → 顯示名稱首字的替代方塊。圖片都有 `loading="lazy"`。

## 已完成的功能

- 元素篩選（再點一次同一元素恢復顯示全部）、角色多選
- 多語 hashtag（英／日／繁／簡）、AND／OR、進階搜尋（常見字 + #原神 限定）
- 右上角原神風格齒輪 → 從右側滑出的深藍設定面板（×、點背景、Esc 關閉；焦點鎖在面板內）
- 底部固定操作列：已選角色頭像與繁中 tag 上下對齊（點擊移除）、前往𝕏／複製網址／清空
- 原神介面風格：米白／深藍／金配色、膠囊按鈕、Noto Sans TC / Noto Serif TC
- 卡片淡淡的星級底色（五星金、四星紫）；選取時元素色細外框（55%）＋光暈（70%）；有選取時其他角色稍微變淡
- 背景淡米色漸層，選元素時帶一點該元素的顏色（`@property --tint` 讓漸層可以平滑轉換）
- 角色與元素都是 `<button aria-pressed>`，可鍵盤操作
- `<head>`：lang、charset、title、description、Open Graph、favicon
- 角色更新到 7.0（7.1 的薇斯納、沃雅妮莎尚未加入）

## 重要決定（使用者指定，修改前先確認）

- 底部已選角色的 tag **一律顯示繁體中文**（`tags.tw` → `common.tw` → 名稱），與實際搜尋用哪些 tag 無關。
- Aloy 的中文用 **埃洛伊**（不是官方繁中的「亞蘿伊」）。
- 星級底色要「淡淡的」，不能影響整體畫面顏色。
- 選取的光暈不能太寬，避免影響隔壁角色。
- 標題副標是「(需要登入𝕏帳號)」。
- 設定面板底色參考 HoYoWiki 的深藍色（`#3A4357`）。
- 改動先推到分支並提供預覽網址，使用者看過、說「直接併」後才開 PR 並合併。

## 踩過的坑

- **雲端 session 連不到 HoYoverse 網域**（`*.hoyoverse.com`、`*.hoyolab.com`，403）。所以圖片改由 GitHub Action 下載。角色名稱與官方圖網址改從 npm 套件 `genshin-db` 取得：它的 `images.hoyowiki_icon` 就是 HoYoWiki 官方圖網址。
- **GitHub Pages 快取約 10 分鐘**：曾發生新的 `index.html` 配上快取裡舊的 `characters.js`（沒有 `rarity`），四星角色全部變成金色。現在 `characters.js` 和 `img/manifest.js` 的 `<script src>` 都帶 `?v=<資料內容雜湊>`，由 `download-icons.mjs` 自動更新。若手動改了 `characters.js` 而 Action 沒跑，記得在本機執行 `node scripts/download-icons.mjs`。
- **raw.githack 預覽也有快取**：用分支名稱的網址會看到舊版。給使用者預覽時要用指定 commit 的網址：
  `https://raw.githack.com/twl-Benchen/genshin-impact-search/<完整 commit SHA>/index.html`
- **圓角裁切失效**：在有 `backdrop-filter` 的操作列裡，`overflow: hidden` + `border-radius` 沒有裁到圖片。圖片本身要加 `border-radius: inherit`；小頭像外框改用 `border`，不要用 `box-shadow`。
- **flex 的 `gap` 會拆開文字**：按鈕裡 `前往𝕏<span>頁面</span>` 會變成「前往𝕏 頁面」，文字要整段包在同一個 `<span>` 裡。
- **`<button>` 內容預設垂直置中**：名稱換行時卡片會上下錯開，`.character` 要用 `flex-direction: column; justify-content: flex-start`。
- **`#Gaming`（嘉明）等英文名稱本身就是常見單字**，搜尋結果會混雜，目前尚未處理（見下一步）。
- **在 Bash 裡 `pkill -f "http.server 8767"` 會連自己的 shell 一起殺掉**（指令列也含那段字）。改用 `pkill -f "http.server 876[0-9]"`，並放在獨立的指令裡。

## 測試方式

沒有自動化測試。改完用 Playwright（瀏覽器已預裝）實際操作並截圖：

```bash
python3 -m http.server 8767   # 在 repo 根目錄
```

```js
const { chromium } = require('playwright');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
```

至少檢查：桌面（1440px）與手機（390px）、沒有水平捲動、選取／移除／清空、產生的搜尋語法、`pageerror` 為空。
雲端環境連不到 Google Fonts 與 HoYoverse，截圖會用預設字體；本地圖片在 `img/` 裡，可以正常顯示。

## 下一步（尚未做）

- 加入 7.1 角色（薇斯納 Vesna、沃雅妮莎 Vodyanitsa），之後的新角色照同樣格式加。
- 搜尋加上 `filter:images`、`-filter:retweets`，或網址加 `&f=media` 直接開媒體分頁。
- 處理英文名稱是常見單字的角色（`#Gaming`、`#Amber`、`#Lisa`、`#Mona`…），例如加上 #原神 限定。
- 進階篩選：`min_faves:`（熱門圖）、`since:`（時間範圍）。
- 角色名稱搜尋框。
- 卡片角落加小元素圖示。
- 深色模式。
- `og:image`（現在圖片已在 repo，可以指定分享預覽圖）。
- 補充 README。
- 已選角色很多時，𝕏 搜尋語法可能超過長度上限，可考慮提示或限制。
