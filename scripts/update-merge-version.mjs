// 依檔案內容產生版本號，寫進 merge.html 裡 merge/*.css、merge/*.js 的 ?v=，
// 避免 GitHub Pages 快取讓新的 merge.html 配上舊的 JS／CSS。
// 改了 merge/ 底下的檔案後執行：node scripts/update-merge-version.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = path.join(root, 'merge.html');
const html = await readFile(htmlPath, 'utf8');

const pattern = /((?:src|href)=")(merge\/[^"?]+)(?:\?v=[^"]*)?"/g;
const versions = {};
for (const [, , file] of html.matchAll(pattern)) {
    versions[file] ??= createHash('sha256').update(await readFile(path.join(root, file))).digest('hex').slice(0, 8);
}
const updated = html.replace(pattern, (_, attr, file) => `${attr}${file}?v=${versions[file]}"`);

if (updated !== html) {
    await writeFile(htmlPath, updated);
    for (const [file, v] of Object.entries(versions)) console.log(`${file} → ?v=${v}`);
} else {
    console.log('merge.html 版本號已是最新');
}
