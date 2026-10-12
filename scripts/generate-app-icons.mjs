// 產生 PWA／主畫面圖示（img/app-icon-*.png）。改了圖示設計後執行：node scripts/generate-app-icons.mjs
// 風格與首頁右上角齒輪一致：深藍底、金色圓環與菱形、中間米金色四角星
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// maskable 圖示的重要內容要在中間 80% 的安全範圍內（半徑 204.8），這裡最外圍約 190
const art = `
    <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#4A5366" />
            <stop offset="1" stop-color="#2B3142" />
        </linearGradient>
    </defs>
    <circle cx="256" cy="256" r="150" fill="none" stroke="#D3BC8E" stroke-width="10" />
    <circle cx="256" cy="256" r="126" fill="none" stroke="#D3BC8E" stroke-opacity="0.35" stroke-width="4" />
    <g fill="#D3BC8E">
        <path d="M256 66 L271 86 L256 106 L241 86 Z" />
        <path d="M256 406 L271 426 L256 446 L241 426 Z" />
        <path d="M66 256 L86 241 L106 256 L86 271 Z" />
        <path d="M406 256 L426 241 L446 256 L426 271 Z" />
    </g>
    <path fill="#FFE6B2" d="M256 158 L279 233 L354 256 L279 279 L256 354 L233 279 L158 256 L233 233 Z" />`;

// any：圓角方形（四角透明）；maskable 與 apple-touch-icon：滿版底色，由系統自己裁形狀
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="url(#bg)" />${art}</svg>`;
const fullBleed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="url(#bg)" />${art}</svg>`;

const outputs = [
    ['img/app-icon-192.png', rounded, 192],
    ['img/app-icon-512.png', rounded, 512],
    ['img/app-icon-maskable-512.png', fullBleed, 512],
    ['img/apple-touch-icon.png', fullBleed, 180],
];

for (const [file, svg, size] of outputs) {
    await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(root, file));
    console.log(`${file}（${size}×${size}）`);
}
