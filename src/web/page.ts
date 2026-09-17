import { DLHD_BASE } from "../config.js";
import { PLAYERS } from "../servers/kinds.js";

const SITE_TITLE = "DaddyLive Stream Resolver";
const SITE_HOST = DLHD_BASE.replace(/^https?:\/\//, "");
const SITE_DESC = `Resolve ${SITE_HOST} player servers into direct HLS links. Play in the browser with automatic token refresh, or export for VLC and MPV.`;

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderPage(): string {
  const config = JSON.stringify({ players: PLAYERS }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="${esc(SITE_DESC)}">
<meta name="robots" content="index,follow">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(SITE_TITLE)}">
<meta property="og:description" content="${esc(SITE_DESC)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(SITE_TITLE)}">
<meta name="twitter:description" content="${esc(SITE_DESC)}">
<title>${esc(SITE_TITLE)}</title>
<link rel="stylesheet" href="/style.css">
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js"></script>
</head>
<body>
<main class="app">
<header class="top">
<div class="top__brand">
<h1 class="top__title">DaddyLive</h1>
<p class="top__product">Stream Resolver</p>
</div>
<p class="top__desc">
Resolve <a href="${esc(DLHD_BASE)}/" target="_blank" rel="noopener noreferrer">${esc(SITE_HOST)}</a> player servers into direct HLS links. Play here with automatic token refresh, or export for VLC and MPV.
</p>
</header>

<section class="card" aria-labelledby="channel-heading">
<h2 id="channel-heading" class="visually-hidden">Channel</h2>
<form id="watch-form">
<label class="resolve__field">
<span class="resolve__label">Channel ID</span>
<input id="channel" type="number" min="1" inputmode="numeric" autocomplete="off" value="46" required>
</label>
</form>
<p id="error" class="msg--err" hidden role="alert"></p>
</section>

<section class="stack" aria-live="polite">
<article class="card" id="servers-card">
<h2 class="section-title">Servers</h2>
<div id="servers" class="servers" role="group" aria-label="Available servers"></div>
</article>

<article class="card" id="player-card" hidden>
<div class="stream-head">
<h2 id="stream-title" class="stream-title">Stream</h2>
<dl id="timing" class="timing" hidden>
<div class="timing__item">
<dt class="timing__label">Resolve</dt>
<dd id="timing-resolve" class="timing__value">—</dd>
</div>
<div class="timing__item">
<dt class="timing__label">First playback</dt>
<dd id="timing-playback" class="timing__value">—</dd>
</div>
</dl>
</div>
<div class="player">
<video id="video" controls playsinline></video>
</div>
<ul id="stream-notes" class="stream-notes" hidden>
<li>
<span class="stream-notes__label">Direct link</span>
<span id="note-direct" class="stream-notes__text">—</span>
</li>
<li>
<span class="stream-notes__label">Our Live URL</span>
<span class="stream-notes__text">Refreshes on its own — this is what plays here</span>
</li>
</ul>
</article>

<article class="card" id="export-card" hidden>
<h2 class="section-title">Export</h2>
<ul class="exports">
<li id="proxy-row">
<div class="export__meta">
<span class="export__name">Our Live URL</span>
<span class="export__hint">Share this — keeps working</span>
</div>
<div class="export__row">
<input id="proxy" readonly aria-label="Stable live stream URL">
<button type="button" data-copy="proxy">Copy</button>
</div>
</li>
<li>
<div class="export__meta">
<span class="export__name">Direct URL</span>
<span class="export__hint">Raw link — expires (see time under player)</span>
</div>
<div class="export__row">
<input id="direct" readonly aria-label="Direct stream URL">
<button type="button" data-copy="direct">Copy</button>
</div>
</li>
<li>
<div class="export__meta">
<span class="export__name">VLC</span>
<span class="export__hint">Open in VLC</span>
</div>
<div class="export__row">
<input id="vlc" readonly aria-label="VLC command">
<button type="button" data-copy="vlc">Copy</button>
</div>
</li>
<li>
<div class="export__meta">
<span class="export__name">MPV</span>
<span class="export__hint">Open in MPV</span>
</div>
<div class="export__row">
<input id="mpv" readonly aria-label="MPV command">
<button type="button" data-copy="mpv">Copy</button>
</div>
</li>
</ul>
</article>
</section>
</main>
<script type="application/json" id="app-config">${config}</script>
<script type="module" src="/app.js"></script>
</body>
</html>`;
}
