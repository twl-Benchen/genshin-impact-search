// Cloudflare Worker：𝕏 影片（video.twimg.com）代理 —— 提案，尚未部署
//
// 為什麼需要：實測 video.twimg.com 會對其他網站發出的請求回 HTTP 403，
// 瀏覽器無法直接把 𝕏 的 GIF／影片畫進 canvas（轉 GIF 需要）。
// 這個 Worker 只轉發 *.twimg.com 的媒體檔，並只允許本站使用。
//
// 用法：https://<你的 worker>.workers.dev/?url=<encodeURIComponent(影片網址)>

// 允許使用這個代理的網站（'null' 是直接雙擊開啟的 file://）
const ALLOWED_ORIGINS = [
    'https://twl-benchen.github.io',
    'https://raw.githack.com', // 分支預覽用
    'null',
];

// 只轉發這些網域，避免被當成任意網址的開放代理
const ALLOWED_HOSTS = ['video.twimg.com', 'pbs.twimg.com'];

export default {
    async fetch(request) {
        const origin = request.headers.get('Origin');
        const allowed = origin !== null && ALLOWED_ORIGINS.includes(origin);
        const cors = {
            'Access-Control-Allow-Origin': allowed ? origin : 'null',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Range',
            'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
            'Vary': 'Origin',
        };

        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: cors });
        if (!allowed) return new Response('Forbidden origin', { status: 403, headers: cors });

        let target;
        try {
            target = new URL(new URL(request.url).searchParams.get('url'));
        } catch {
            return new Response('Missing or invalid url', { status: 400, headers: cors });
        }
        if (target.protocol !== 'https:' || !ALLOWED_HOSTS.includes(target.hostname)) {
            return new Response('Host not allowed', { status: 400, headers: cors });
        }

        // 影片播放／拖動進度時瀏覽器會送 Range，原樣轉發
        const headers = {};
        const range = request.headers.get('Range');
        if (range) headers.Range = range;

        const upstream = await fetch(target.toString(), {
            method: request.method,
            headers,
            cf: { cacheEverything: true, cacheTtl: 86400 }, // 同一支影片一天內走 Cloudflare 快取
        });

        const response = new Response(upstream.body, upstream);
        for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
        response.headers.delete('Set-Cookie');
        return response;
    },
};
