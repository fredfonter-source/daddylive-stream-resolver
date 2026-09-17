import type { ResolvedStream } from "../decrypt/types.js";
import { UA } from "../http.js";
import { serverProfile } from "../servers/index.js";
import type { ServerKind } from "../servers/kinds.js";
import { needsRefresh } from "./rules.js";

export type LiveSession = {
  channelId: number;
  server: ServerKind;
  playableUrl: string;
  referer: string;
  embedUrl: string;
  meta: Record<string, string>;
  family?: string;
  variants: string[];
  updatedAt: number;
};

const REFRESH_LEAD_SEC = 45;
const sessions = new Map<string, LiveSession>();
const inflight = new Map<string, Promise<LiveSession>>();

function keyOf(channelId: number, server: ServerKind): string {
  return `${channelId}:${server}`;
}

export function livePlaylistUrl(channelId: number, server: ServerKind, origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/live.m3u8?channel=${channelId}&server=${server}`;
  }

export function streamReferer(resolved: ResolvedStream): string {
  const profile = serverProfile(resolved.server);
  if (profile.transport.refererMode === "omit") return "";
  if (profile.transport.refererMode === "required") {
    return profile.transport.refererOrigin ?? resolved.embedUrl;
  }
  return resolved.embedUrl;
}

function fromResolved(resolved: ResolvedStream): LiveSession {
  const token = resolved.playableUrl.match(/[?&]token=([^&]+)/)?.[1];
  const meta = { ...resolved.meta };
  if (token) meta.token = decodeURIComponent(token);
  return {
    channelId: resolved.channelId,
    server: resolved.server,
    playableUrl: resolved.playableUrl,
    referer: streamReferer(resolved),
    embedUrl: resolved.embedUrl,
    meta,
    family: resolved.meta.family,
    variants: [],
    updatedAt: Date.now(),
  };
}

async function refreshWideiptv(session: LiveSession): Promise<LiveSession | null> {
  const slug = session.meta.slug;
  const token = session.meta.token;
  if (!slug || !token) return null;
  const res = await fetch("https://wideiptv.top/api/refresh_token.php", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      Referer: session.embedUrl || "https://wideiptv.top/",
    },
    body: JSON.stringify({ channel: slug, current_token: token }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    success?: boolean;
    token?: string;
    expires_in?: number;
  };
  if (!data.success || !data.token) return null;
  const playableUrl = session.playableUrl.replace(/([?&]token=)[^&]+/, `$1${data.token}`);
  const expiresAt =
    typeof data.expires_in === "number"
      ? String(Math.floor(Date.now() / 1000) + data.expires_in)
      : session.meta.expiresAt;
  return {
    ...session,
    playableUrl,
    meta: {
      ...session.meta,
      token: data.token,
      ...(expiresAt ? { expiresAt } : {}),
      ...(data.expires_in != null ? { refreshMs: String(data.expires_in * 1000) } : {}),
    },
    variants: [],
    updatedAt: Date.now(),
  };
}

export async function putResolvedSession(resolved: ResolvedStream): Promise<LiveSession> {
  const session = fromResolved(resolved);
  sessions.set(keyOf(resolved.channelId, resolved.server), session);
  return session;
}

export async function ensureFreshSession(
  channelId: number,
  server: ServerKind,
  resolve: () => Promise<ResolvedStream>,
  force = false,
): Promise<LiveSession> {
  const key = keyOf(channelId, server);
  const existing = sessions.get(key);
  if (!force && existing && !needsRefresh(existing.meta, REFRESH_LEAD_SEC)) {
    return existing;
  }

  const pending = inflight.get(key);
  if (pending) return pending;

  const work = (async () => {
    const cur = sessions.get(key);
    if (cur?.family === "wideiptv") {
      const refreshed = await refreshWideiptv(cur).catch(() => null);
      if (refreshed && !needsRefresh(refreshed.meta, REFRESH_LEAD_SEC)) {
        sessions.set(key, refreshed);
        return refreshed;
      }
    }
    const session = fromResolved(await resolve());
    sessions.set(key, session);
    return session;
  })().finally(() => {
    inflight.delete(key);
  });

  inflight.set(key, work);
  return work;
}
