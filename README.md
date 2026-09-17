# DaddyLive Stream Resolver

Turn [dlive.sx](https://dlive.sx/) (DaddyLive / DLHD) player pages into direct **HLS** (`.m3u8`) or **WebM** links. The app fetches a channel by ID, decrypts the embed in pure TypeScript, plays the live stream in the browser with [hls.js](https://github.com/video-dev/hls.js/), and can copy ready **VLC** or **MPV** commands. Signed tokens refresh on a stable live URL so a shared link keeps working after the raw CDN URL expires.

---

## Table of Contents

1. [What This Project Does](#what-this-project-does)
2. [Quick Start](#quick-start)
3. [Web UI](#web-ui)
4. [Players](#players)
5. [Export Links](#export-links)
6. [Architecture](#architecture)
7. [Project Layout](#project-layout)
8. [HTTP API](#http-api)
9. [Library API](#library-api)
10. [Configuration](#configuration)
11. [Development](#development)
12. [Limits](#limits)
13. [Disclaimer](#disclaimer)

---

## What This Project Does

DaddyLive exposes several player servers per channel. Each server wraps the real stream in a different embed. This project:

1. Loads the player page for one server and one channel ID.
2. Follows the embed chain until the HTML holds a playable marker.
3. Decrypts that HTML offline (no network inside the decrypt layer).
4. Returns a direct stream URL, plus a stable **Our Live URL** that rewrites playlists, sends the right referer, refreshes tokens when needed, and unwraps special segment wrappers when they appear.

You watch in the page, or paste a command into VLC or MPV. There is no homepage channel scrape: you already know the numeric channel ID from dlive.sx.

---

## Quick Start

### Requirements

- Node.js 20 or newer
- npm

### Run

```bash
git clone https://github.com/sharoon7171/daddylive-stream-resolver.git
cd daddylive-stream-resolver
npm install
npm start
```

Open `http://localhost:3000`. Set `PORT` if you need another port.

`npm start` rebuilds TypeScript into `dist/` and serves the API plus the web UI from there.

---

## Web UI

The home page is one flow.

1. Enter a **channel ID** (for example `46`).
2. Click a **PLAYER** badge.
3. Wait for resolve time and first playback time next to the title.
4. Watch in the built-in player, or copy an export row below.

Only one server resolves at a time. Switching badges cancels the previous run’s UI updates. Notes under the video show how long the direct link lasts and remind you that **Our Live URL** is what the page actually plays for HLS.

---

## Players

Six DaddyLive player routes are wired. Each maps to a path like `/{server}/stream-{id}.php` on dlive.sx.

| Badge | Server ID | Path |
| --- | --- | --- |
| PLAYER 1 | `stream` | `/stream/stream-{id}.php` |
| PLAYER 2 | `cast` | `/cast/stream-{id}.php` |
| PLAYER 3 | `watch` | `/watch/stream-{id}.php` |
| PLAYER 4 | `plus` | `/plus/stream-{id}.php` |
| PLAYER 5 | `casting` | `/casting/stream-{id}.php` |
| PLAYER 6 | `player` | `/player/stream-{id}.php` |

Not every channel exposes every embed. If a page has no iframe, resolve fails with a clear error for that badge only.

Embed families the decrypt layer knows include tiestep (`_econfig`), epiembeds (XOR arrays), wideiptv, cdnlivetv, daddy3, hub / livelive24 WebM, and related hop pages (wikisport, blogger-player). Transport rules per server live under `src/servers/` (referer required, optional, or omitted; whether VLC/MPV get the direct CDN URL or Our Live URL; optional browser User-Agent for tools).

---

## Export Links

After a successful resolve, the export card shows four fields.

| Field | Meaning |
| --- | --- |
| **Our Live URL** | `/api/live?channel=…&server=…` — stable share link; refreshes tokens and rewrites HLS through this app |
| **Direct URL** | Upstream `.m3u8` or WebM from the embed — often time-signed and will expire |
| **VLC** | Shell line with optional `--http-referrer` and `--http-user-agent` |
| **MPV** | Shell line with optional `--referrer`, `--user-agent`, and a media title |

Which URL the VLC/MPV lines use depends on the server profile: some CDNs play with a direct link and headers; others need Our Live URL so the proxy can fix referer, User-Agent, or wrapped segments.

---

## Architecture

Two layers stay separate on purpose.

### Decrypt (pure)

`src/decrypt/` only reads HTML strings. It never calls `fetch`. You can unit-test extractors against saved pages. Output is a `ResolvedStream`: channel ID, server, embed URL, playable URL, MIME type, and small metadata (family, expiry, tokens when present).

### Live path (network)

`src/api/` and `src/http.ts` load watch/player pages and walk iframe hops. After decrypt, `src/proxy/` serves:

- **Proxy** — one-shot fetch of a URL with the right headers; rewrites `.m3u8` lines back through `/api/proxy`; unwraps WebP polyglot segments into MPEG-TS when needed.
- **Live session** — remembers the last resolve per `channel:server`, refreshes wideiptv tokens early, and re-resolves when the signed URL is about to die.
- **Live playlist** — entry point for the browser player and for tool commands that must go through this host.

```text
channel ID + server
        │
        ▼
  fetch player page ──► embed chain ──► HTML
                                           │
                                           ▼
                                    decrypt (pure)
                                           │
                                           ▼
                              direct URL + session
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
              hls.js player    /api/live URL     VLC / MPV
              (via live)       (share / tools)   (direct or live)
```

---

## Project Layout

```text
src/
  api/          HTTP server, resolve + live handlers, embed fetch chain
  channels/     watch.php and player page URL builders
  decrypt/      crypto helpers + embed extractors (no fetch)
  proxy/        playlist rewrite, live session, links, WebP→TS unwrap
  servers/      six player profiles (referer / tools behavior)
  web/          HTML shell, CSS, browser app (hls.js)
  config.ts     DLHD_BASE
  http.ts       shared User-Agent and HTML fetch
  index.ts      public library exports
```

Build output goes to `dist/`.

---

## HTTP API

All routes are `GET`.

### `GET /api/resolve?channel={id}&server={kind}`

Resolves one player. JSON includes `direct`, `live`, `vlc`, `mpv`, `isHls`, `resolveMs`, and optional `expiresAt`. On failure: `502` with `{ error, server, label, resolveMs }`.

`server` must be one of: `stream`, `cast`, `watch`, `plus`, `casting`, `player`.

### `GET /api/live?channel={id}&server={kind}`

Stable HLS playlist for the browser (and for tools when the profile is not direct-playable). Optional `u` and `v` query params follow rewritten child playlists and variants. Keeps the session fresh and unwraps segments when they arrive as WebP-wrapped MPEG-TS.

### `GET /api/proxy?url={upstream}&referer={embed}`

Fetches one upstream URL with browser-like headers. Playlists are rewritten so every media line points back here. Used by live rewrite and by older one-shot proxy flows.

### Static

`/`, `/style.css`, and `/app.js` serve the UI.

---

## Library API

Package name: `daddylive-stream-resolver`. Main entry: `src/index.ts` (built as `dist/index.js`).

```typescript
import {
  resolveFromHtml,
  extractPlayableFromHtml,
  extractEmbedUrl,
  PLAYERS,
  PLAYER_IDS,
  buildProxyUrl,
  buildVlcCommand,
  buildMpvCommand,
  livePlaylistUrl,
  serverProfile,
} from "daddylive-stream-resolver";
```

### `ResolvedStream`

```typescript
type ResolvedStream = {
  channelId: number;
  server: ServerKind;
  embedUrl: string;
  playableUrl: string;
  mimeType: "application/x-mpegURL" | "video/webm";
  meta: Record<string, string>;
};
```

### Offline vs live

| Goal | Call |
| --- | --- |
| Decrypt saved HTML | `extractPlayableFromHtml(html)` or `resolveFromHtml(html, ctx)` |
| Build watch / player URLs | `watchUrl(id)`, `playerPageUrl(server, id)` |
| Build tool strings | `buildVlcCommand`, `buildMpvCommand` |
| Build proxy or live URLs | `buildProxyUrl`, `livePlaylistUrl` |

Live HTTP resolve used by the server lives in `src/api/resolve.ts` (`resolveLive`, `handleResolveOne`) and is started with `npm start`, not as a separate published binary.

---

## Configuration

| Variable | Default | Role |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port |
| `DLHD_BASE` | `https://dlive.sx` | Origin for watch and player page URLs |

No other runtime packages are required; TypeScript and `@types/node` are devDependencies only.

---

## Development

```bash
npm run typecheck
npm run build
npm start
```

- `typecheck` — `tsc --noEmit`
- `build` — compile to `dist/` and copy `style.css`
- `start` — free the port, build, run `node dist/api/index.js`

Match the style of nearby files: ESM, strict TypeScript, small modules, no comments in application code unless you ask for them.

---

## Limits

- A channel may omit some player iframes; that is a site gap, not a silent success.
- Direct CDN links are often signed. Prefer **Our Live URL** for long sessions and sharing.
- PLAYER 1 tools need a browser User-Agent on the direct path; the export command includes it when that profile asks for it.
- PLAYER 4 segments may arrive as WebP files that actually contain MPEG-TS; the live/proxy path unwraps them. Playing the raw TikTok-looking URL in MPV without this app will fail.
- Some upstream playlists are short static loops rather than a moving live edge; the proxy may mark those with `#EXT-X-ENDLIST` so the player does not buffer forever waiting for new media.

---

## Disclaimer

This project is for educational purposes only. It shows how live stream pages, HLS links, and related decrypt steps can be studied in code.

Respect copyright holders, the terms of any site you visit, and the laws where you live. Do not use this work to access or share content you are not allowed to use. The authors take no responsibility for how others use this code.
