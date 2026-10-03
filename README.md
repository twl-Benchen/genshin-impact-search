https://twl-benchen.github.io/genshin-impact-search/

## 新增或修改角色

角色資料都在 `characters.js`，在對應元素區塊加一行即可：

```js
{ id: 'Klee', name: '可莉', element: 'Pyro', tags: ['Klee', 'クレー', '可莉'],
  img: 'https://...HoYoWiki 圖片網址...' },
```

- `tags`：搜尋時會組成 `(#Klee OR #クレー OR #可莉)`，太常見的字不要放
- `img`：圖片網址；推到 main 後 GitHub Action 會自動把圖片下載到 `img/`，網頁優先使用本地圖片
- 也可以手動執行 `node scripts/download-icons.mjs`（加 `--force` 會全部重新下載）

選取的角色會記在網址裡（例如 `#c=Klee,Nahida&e=Pyro`），可以存成書籤或直接分享。
