// 把 characters.js 裡的圖片下載到 img/，並產生 img/manifest.js 讓網頁改用本地圖片。
// 用法：node scripts/download-icons.mjs        （只下載還沒有的圖）
//       node scripts/download-icons.mjs --force（全部重新下載）
// 需要 Node.js 18 以上。
import { createRequire } from 'node:module';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ELEMENTS, CHARACTERS } = createRequire(import.meta.url)(path.join(root, 'characters.js'));
const force = process.argv.includes('--force');

const EXT = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/gif': 'gif' };

const jobs = [
    ...ELEMENTS.map(el => ({ key: 'element:' + el.id, dir: 'img/elements', name: el.id, url: el.img })),
    ...CHARACTERS.map(c => ({ key: c.id, dir: 'img/characters', name: c.id, url: c.img })),
];

async function existingFiles(dir) {
    await mkdir(path.join(root, dir), { recursive: true });
    const map = {};
    for (const f of await readdir(path.join(root, dir))) map[path.parse(f).name] = f;
    return map;
}

const existing = {
    'img/elements': await existingFiles('img/elements'),
    'img/characters': await existingFiles('img/characters'),
};

const manifest = {};
let failed = 0;
for (const job of jobs) {
    const have = existing[job.dir][job.name];
    if (have && !force) {
        manifest[job.key] = `${job.dir}/${have}`;
        continue;
    }
    if (!job.url) {
        console.warn(`略過 ${job.name}：沒有圖片網址`);
        continue;
    }
    try {
        const res = await fetch(job.url, { headers: { Referer: 'https://wiki.hoyolab.com/' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ext = EXT[(res.headers.get('content-type') || '').split(';')[0]] || 'png';
        const file = `${job.name}.${ext}`;
        await writeFile(path.join(root, job.dir, file), Buffer.from(await res.arrayBuffer()));
        manifest[job.key] = `${job.dir}/${file}`;
        console.log(`下載 ${job.dir}/${file}`);
    } catch (err) {
        failed++;
        console.error(`失敗 ${job.name}：${err.message}（${job.url}）`);
    }
}

const body = Object.entries(manifest).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
await writeFile(path.join(root, 'img/manifest.js'),
    `// 由 scripts/download-icons.mjs 自動產生，請勿手動編輯\nwindow.LOCAL_ICONS = {\n${body}\n};\n`);
console.log(`完成：${Object.keys(manifest).length} 張本地圖片，${failed} 張失敗`);

// 依資料內容產生版本號，寫進 index.html 的 ?v=，讓瀏覽器在資料更新後重新下載而不是用舊快取
const hash = createHash('sha256');
for (const f of ['characters.js', 'img/manifest.js']) hash.update(await readFile(path.join(root, f)));
const version = hash.digest('hex').slice(0, 8);
const indexPath = path.join(root, 'index.html');
const html = await readFile(indexPath, 'utf8');
const updated = html.replace(/(src="(?:characters\.js|img\/manifest\.js))(?:\?v=[^"]*)?"/g, `$1?v=${version}"`);
if (updated !== html) {
    await writeFile(indexPath, updated);
    console.log(`index.html 資料版本號更新為 ${version}`);
}
