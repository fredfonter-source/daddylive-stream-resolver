import type { ResolvedStream } from "../decrypt/types.js";
import type { ServerKind } from "../servers/kinds.js";
import { UA } from "../http.js";
import { buildProxyUrl } from "./links.js";
import { upstreamRuleFor } from "./rules.js";
import { ensureFreshSession, type LiveSession } from "./session.js";
import type { ProxyResult } from "./stream.js";
import { unwrapWebpMpegTs } from "./unwrap-webp-ts.js";

const CORS = { "Access-Control-Allow-Origin": "*" };

function upstreamHeaders(session: LiveSession, target: string): Record<string, string> {
  const rule = upstreamRuleFor(target);
  const headers: Record<string, string> = { "User-Agent": UA, Accept: "*/*" };
  if (rule.refererMode === "omit") return headers;
  if (rule.refererMode === "required") {
    const referer = rule.forceReferer ?? session.referer;
    headers.Referer = referer;
    headers.Origin = new URL(referer).origin;
    return headers;
  }
  if (session.referer) {
    headers.Referer = session.referer;
    try {
      headers.Origin = new URL(session.referer).origin;
    } catch {}
  }
  return headers;
}

function liveChildUrl(
  channelId: number,
  server: ServerKind,
  origin: string,
  child: string,
  variant?: number,
): string {
  const params = new URLSearchParams({
    channel: String(channelId),
    server,
    u: child,
  });
  if (variant != null) params.set("v", String(variant));
  return `${origin.replace(/\/$/, "")}/api/live?${params}`;
}

function rewriteLivePlaylist(
  playlist: string,
  playlistUrl: URL,
  session: LiveSession,
  origin: string,
): string {
  const baseDir = playlistUrl.href.slice(0, playlistUrl.href.lastIndexOf("/") + 1);
  const isMaster = /#EXT-X-STREAM-INF/i.test(playlist);
  let variantIdx = 0;
  if (isMaster) session.variants = [];

  let out = playlist
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_m, uri: string) => {
          const abs = new URL(uri, baseDir).href;
          return `URI="${buildProxyUrl(abs, session.referer, origin)}"`;
        });
      }
      const abs = new URL(trimmed, baseDir).href;
      if (isMaster || /\.m3u8(\?|$)/i.test(abs)) {
        const v = variantIdx++;
        if (isMaster) session.variants[v] = abs;
        return liveChildUrl(session.channelId, session.server, origin, abs, isMaster ? v : undefined);
      }
      return buildProxyUrl(abs, session.referer, origin);
    })
    .join("\n");

  if (/tiktokcdn/i.test(playlist) && !/#EXT-X-ENDLIST/i.test(out)) {
    out = `${out.trimEnd()}\n#EXT-X-ENDLIST\n`;
  }
  return out;
}

function swapToken(url: string, session: LiveSession): string {
  const token = session.meta.token;
  if (!token || !/[?&]token=/.test(url)) return url;
  return url.replace(/([?&]token=)[^&]+/, `$1${token}`);
}

async function fetchUpstream(
  target: string,
  session: LiveSession,
): Promise<{ status: number; body: Buffer; type: string }> {
  const res = await fetch(target, {
    headers: upstreamHeaders(session, target),
    redirect: "follow",
  });
  return {
    status: res.status,
    body: Buffer.from(await res.arrayBuffer()),
    type: res.headers.get("content-type") || "",
  };
}

export async function proxyLivePlaylist(
  channelId: number,
  server: ServerKind,
  origin: string,
  resolve: () => Promise<ResolvedStream>,
  childUrl?: string | null,
  variant?: number | null,
): Promise<ProxyResult> {
  let session = await ensureFreshSession(channelId, server, resolve);

  let target = session.playableUrl;
  if (variant != null && Number.isFinite(variant) && session.variants[variant]) {
    target = swapToken(session.variants[variant], session);
  } else if (childUrl) {
    target = swapToken(childUrl, session);
  }

  let upstream = await fetchUpstream(target, session);
  if (upstream.status === 401 || upstream.status === 403) {
    session = await ensureFreshSession(channelId, server, resolve, true);
    target = session.playableUrl;
    if (variant != null && session.variants[variant]) {
      target = swapToken(session.variants[variant], session);
    } else if (childUrl) {
      target = swapToken(childUrl, session);
    }
    upstream = await fetchUpstream(target, session);
  }

  if (upstream.status >= 400) {
    return {
      status: upstream.status,
      body: upstream.body,
      type: upstream.type || "text/plain",
      headers: { ...CORS, "Cache-Control": "no-store" },
    };
  }

  const text = upstream.body.toString("utf8");
  if (text.startsWith("#EXTM3U")) {
    const rewritten = rewriteLivePlaylist(text, new URL(target), session, origin);
    return {
      status: 200,
      body: rewritten,
      type: "application/vnd.apple.mpegurl",
      headers: { ...CORS, "Cache-Control": "no-cache" },
    };
  }

  const mpegTs = unwrapWebpMpegTs(upstream.body);
  if (mpegTs) {
    return {
      status: 200,
      body: mpegTs,
      type: "video/mp2t",
      headers: { ...CORS, "Cache-Control": "no-cache" },
    };
  }

  return {
    status: upstream.status,
    body: upstream.body,
    type: upstream.type || "application/octet-stream",
    headers: { ...CORS, "Cache-Control": "no-cache" },
  };
}
