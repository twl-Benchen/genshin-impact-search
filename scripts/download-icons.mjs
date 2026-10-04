// 把 characters.js 裡的圖片下載到 img/，縮成小尺寸 WebP，並產生 img/manifest.js 讓網頁改用本地圖片。
// 用法：npm install                              （第一次使用，安裝轉檔用的 sharp）
//       node scripts/download-icons.mjs          （只處理還沒有、或還沒瘦身的圖）
//       node scripts/download-icons.mjs --force  （全部重新下載並轉檔）
// 需要 Node.js 18 以上。
import { createRequire } from 'node:module';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ELEMENTS, CHARACTERS } = createRequire(import.meta.url)(path.join(root, 'characters.js'));
const force = process.argv.includes('--force');

// 輸出尺寸：網頁上角色圖最大顯示 100px、元素圖示 28px，取兩倍讓高解析度螢幕也清楚
const SIZE = { 'img/characters': 200, 'img/elements': 64 };

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

async function isOptimized(file, size) {
    if (!file.endsWith('.webp')) return false;
    const meta = await sharp(file).metadata();
    return meta.format === 'webp' && meta.width <= size && meta.height <= size;
}

// 縮成正方形（保留透明背景）並轉成 WebP
function optimize(buffer, size) {
    return sharp(buffer)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 82, effort: 6 })
        .toBuffer();
}

async function download(url) {
    const res = await fetch(url, { headers: { Referer: 'https://wiki.hoyolab.com/' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

const manifest = {};
let failed = 0, converted = 0;
for (const job of jobs) {
    const size = SIZE[job.dir];
    const target = `${job.name}.webp`;
    const targetPath = path.join(root, job.dir, target);
    const have = existing[job.dir][job.name];
    const havePath = have && path.join(root, job.dir, have);

    try {
        if (have && !force && await isOptimized(havePath, size)) {
            manifest[job.key] = `${job.dir}/${have}`;
            continue;
        }
        // 已有舊的大圖就直接拿來轉檔，不必重新下載
        let source;
        if (have && !force) {
            source = await readFile(havePath);
        } else if (job.url) {
            source = await download(job.url);
            console.log(`下載 ${job.dir}/${job.name}`);
        } else {
            console.warn(`略過 ${job.name}：沒有圖片網址`);
            continue;
        }
        const before = source.length;
        const output = await optimize(source, size);
        await writeFile(targetPath, output);
        if (have && have !== target) await unlink(havePath);
        manifest[job.key] = `${job.dir}/${target}`;
        converted++;
        console.log(`轉檔 ${job.dir}/${target}：${Math.round(before / 1024)} KB → ${Math.round(output.length / 1024)} KB`);
    } catch (err) {
        failed++;
        // 處理失敗但原本有圖時，繼續用原本的圖
        if (have) manifest[job.key] = `${job.dir}/${have}`;
        console.error(`失敗 ${job.name}：${err.message}（${job.url}）`);
    }
}

const body = Object.entries(manifest).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
await writeFile(path.join(root, 'img/manifest.js'),
    `// 由 scripts/download-icons.mjs 自動產生，請勿手動編輯\nwindow.LOCAL_ICONS = {\n${body}\n};\n`);
console.log(`完成：${Object.keys(manifest).length} 張本地圖片，轉檔 ${converted} 張，${failed} 張失敗`);

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
