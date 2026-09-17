import { UA } from "../http.js";
import { buildProxyUrl } from "./links.js";
import { upstreamRuleFor } from "./rules.js";
import { unwrapWebpMpegTs } from "./unwrap-webp-ts.js";

const CORS = { "Access-Control-Allow-Origin": "*" };

export type ProxyResult = {
  status: number;
  body: string | Buffer;
  type: string;
  headers?: Record<string, string>;
};

function buildUpstreamHeaders(playableUrl: string, embedReferer: string): Record<string, string> {
  const rule = upstreamRuleFor(playableUrl);
  const headers: Record<string, string> = { "User-Agent": UA, Accept: "*/*" };
  if (rule.refererMode === "omit") return headers;
  if (rule.refererMode === "required") {
    const referer = rule.forceReferer ?? embedReferer;
    headers.Referer = referer;
    headers.Origin = new URL(referer).origin;
    return headers;
  }
  if (embedReferer) {
    headers.Referer = embedReferer;
    try {
      headers.Origin = new URL(embedReferer).origin;
    } catch {
      /* ignore */
    }
  }
  return headers;
}

function isPlaylist(body: Buffer, targetUrl: string): boolean {
  const head = body.subarray(0, Math.min(body.length, 256)).toString("utf8");
  return head.includes("#EXTM3U") || targetUrl.includes(".m3u8");
}

function proxiedLine(path: string, baseDir: string, referer: string, origin: string): string {
  return buildProxyUrl(new URL(path, baseDir).href, referer, origin);
}

function rewritePlaylist(playlist: string, playlistUrl: URL, referer: string, origin: string): string {
  const baseDir = playlistUrl.href.slice(0, playlistUrl.href.lastIndexOf("/") + 1);
  let out = playlist
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) =>
          `URI="${proxiedLine(uri, baseDir, referer, origin)}"`,
        );
      }
      return proxiedLine(trimmed, baseDir, referer, origin);
    })
    .join("\n");
  if (/tiktokcdn/i.test(playlist) && !/#EXT-X-ENDLIST/i.test(out)) {
    out = `${out.trimEnd()}\n#EXT-X-ENDLIST\n`;
  }
  return out;
}

export async function proxyStream(query: URLSearchParams, origin: string): Promise<ProxyResult> {
  const target = query.get("url");
  const referer = query.get("referer") ?? "";
  if (!target) {
    return { status: 400, body: "url required", type: "text/plain" };
  }
  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(target);
  } catch {
    return { status: 400, body: "invalid url", type: "text/plain" };
  }
  if (upstreamUrl.protocol !== "http:" && upstreamUrl.protocol !== "https:") {
    return { status: 400, body: "unsupported protocol", type: "text/plain" };
  }
  const rule = upstreamRuleFor(target);
  try {
    const res = await fetch(target, {
      headers: buildUpstreamHeaders(target, referer),
      redirect: "follow",
    });
    const bodyBuf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get("content-type") || "";
    const mpegTs = unwrapWebpMpegTs(bodyBuf);
    if (mpegTs) {
      return {
        status: 200,
        body: mpegTs,
        type: "video/mp2t",
        headers: { ...CORS, "Cache-Control": "no-cache" },
      };
    }
    if (rule.rewritePlaylist && isPlaylist(bodyBuf, target)) {
      const text = bodyBuf.toString("utf8");
      const proxyReferer =
        rule.refererMode === "required"
          ? (rule.forceReferer ?? referer)
          : rule.refererMode === "omit"
            ? ""
            : referer;
      const body = text.startsWith("#EXTM3U")
        ? rewritePlaylist(text, upstreamUrl, proxyReferer || referer || target, origin)
        : text;
      return {
        status: res.status,
        body,
        type: "application/vnd.apple.mpegurl",
        headers: { ...CORS, "Cache-Control": "no-cache" },
      };
    }
    return {
      status: res.status,
      body: bodyBuf,
      type: type || "application/octet-stream",
      headers: { ...CORS, "Cache-Control": "no-cache" },
    };
  } catch (err) {
    return {
      status: 502,
      body: err instanceof Error ? err.message : "proxy failed",
      type: "text/plain",
      headers: CORS,
    };
  }
}
