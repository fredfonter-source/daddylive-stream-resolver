type ServerKind = "stream" | "cast" | "watch" | "plus" | "casting" | "player";

type ServerExport = {
  server: ServerKind;
  label: string;
  title: string;
  direct: string;
  live?: string;
  vlc: string;
  mpv: string;
  isHls: boolean;
  resolveMs: number;
  playbackMs?: number;
  expiresAt?: string;
};

type ServerFail = {
  server: ServerKind;
  label: string;
  error: string;
  resolveMs: number;
};

type ServerIdle = {
  server: ServerKind;
  label: string;
  idle: true;
};

type ServerRunning = {
  server: ServerKind;
  label: string;
  running: true;
};

type ServerEntry =
  | (ServerExport & { ok: true })
  | (ServerFail & { ok: false })
  | ServerIdle
  | ServerRunning;

const isIdle = (entry: ServerEntry): entry is ServerIdle => "idle" in entry;
const isRunning = (entry: ServerEntry): entry is ServerRunning => "running" in entry;

type HlsPlayer = {
  loadSource(url: string): void;
  attachMedia(el: HTMLMediaElement): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
  startLoad(startPosition?: number): void;
  recoverMediaError(): void;
  destroy(): void;
};

type HlsGlobal = {
  isSupported(): boolean;
  Events: { MANIFEST_PARSED: string; ERROR: string };
  ErrorTypes: { NETWORK_ERROR: string; MEDIA_ERROR: string };
  new (config?: Record<string, unknown>): HlsPlayer;
};

declare global {
  interface Window {
    Hls?: HlsGlobal;
  }
}

const HLS_LIVE = {
  enableWorker: true,
  lowLatencyMode: true,
  backBufferLength: 90,
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  maxBufferSize: 60 * 1000 * 1000,
  maxBufferHole: 0.5,
  highBufferWatchdogPeriod: 2,
  nudgeOffset: 0.1,
  nudgeMaxRetry: 5,
  maxFragLookUpTolerance: 0.25,
  liveSyncDurationCount: 3,
  liveMaxLatencyDurationCount: 10,
  liveDurationInfinity: true,
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T | null;

const ui = {
  form: $<HTMLFormElement>("watch-form"),
  channel: $<HTMLInputElement>("channel"),
  title: $("stream-title"),
  video: $<HTMLVideoElement>("video"),
  error: $("error"),
  servers: $("servers"),
  playerCard: $("player-card"),
  exportCard: $("export-card"),
  timing: $("timing"),
  timingResolve: $("timing-resolve"),
  timingPlayback: $("timing-playback"),
  streamNotes: $("stream-notes"),
  noteDirect: $("note-direct"),
  exports: {
    direct: $<HTMLInputElement>("direct"),
    proxy: $<HTMLInputElement>("proxy"),
    vlc: $<HTMLInputElement>("vlc"),
    mpv: $<HTMLInputElement>("mpv"),
  },
};

const { players: PLAYER_CONFIG } = JSON.parse(
  document.getElementById("app-config")!.textContent!,
) as { players: { id: ServerKind; label: string }[] };

const PLAYER_IDS = PLAYER_CONFIG.map((player) => player.id);
const playerLabel = (server: ServerKind) =>
  PLAYER_CONFIG.find((player) => player.id === server)?.label ?? server;

const state = {
  hls: null as HlsPlayer | null,
  gen: 0,
  resolveGen: 0,
  label: "",
  channelId: 0,
  servers: [] as ServerEntry[],
  active: "" as ServerKind | "",
  clocks: {
    resolve: 0 as number,
    playback: 0 as number,
    resolveStart: 0,
    playbackStart: 0,
    expiry: 0 as number,
  },
  expiresAt: 0,
};

const fmtRemain = (sec: number) => {
  if (sec <= 0) return "expired";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${mm}m`;
  }
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

const stopExpiryClock = () => {
  if (state.clocks.expiry) {
    window.clearInterval(state.clocks.expiry);
    state.clocks.expiry = 0;
  }
  state.expiresAt = 0;
};

const paintDirectExpiry = () => {
  if (!ui.noteDirect) return;
  if (!state.expiresAt) {
    ui.noteDirect.textContent = "No expiry time found for this link";
    ui.noteDirect.classList.remove("stream-notes__text--warn");
    return;
  }
  const left = state.expiresAt - Math.floor(Date.now() / 1000);
  if (left <= 0) {
    ui.noteDirect.textContent = "Expired — use Our Live URL instead";
    ui.noteDirect.classList.add("stream-notes__text--warn");
    return;
  }
  ui.noteDirect.textContent = `Expires in ${fmtRemain(left)}`;
  ui.noteDirect.classList.toggle("stream-notes__text--warn", left <= 60);
};

const bindStreamNotes = (expiresAt?: string) => {
  stopExpiryClock();
  if (ui.streamNotes) ui.streamNotes.hidden = false;
  const unix = Number(expiresAt);
  if (Number.isFinite(unix) && unix > 0) {
    state.expiresAt = unix;
    paintDirectExpiry();
    state.clocks.expiry = window.setInterval(paintDirectExpiry, 1000);
    return;
  }
  paintDirectExpiry();
};

const clearStreamNotes = () => {
  stopExpiryClock();
  if (ui.noteDirect) {
    ui.noteDirect.textContent = "—";
    ui.noteDirect.classList.remove("stream-notes__text--warn");
  }
  if (ui.streamNotes) ui.streamNotes.hidden = true;
};

const showTiming = () => {
  if (ui.timing) ui.timing.hidden = false;
};

const setTimingValue = (kind: "resolve" | "playback", text: string) => {
  const el = kind === "resolve" ? ui.timingResolve : ui.timingPlayback;
  if (el) el.textContent = text;
};

const stopClock = (kind: "resolve" | "playback", finalMs?: number) => {
  const id = state.clocks[kind];
  if (id) {
    window.clearInterval(id);
    state.clocks[kind] = 0;
  }
  const start = kind === "resolve" ? state.clocks.resolveStart : state.clocks.playbackStart;
  const ms = finalMs ?? (start ? performance.now() - start : 0);
  setTimingValue(kind, fmtMs(ms));
  return ms;
};

const startClock = (kind: "resolve" | "playback") => {
  stopClock(kind, 0);
  const started = performance.now();
  if (kind === "resolve") state.clocks.resolveStart = started;
  else state.clocks.playbackStart = started;
  setTimingValue(kind, fmtMs(0));
  showTiming();
  state.clocks[kind] = window.setInterval(() => {
    setTimingValue(kind, fmtMs(performance.now() - started));
  }, 50);
};

const clearTiming = () => {
  stopClock("resolve", 0);
  stopClock("playback", 0);
  setTimingValue("resolve", "—");
  setTimingValue("playback", "—");
  if (ui.timing) ui.timing.hidden = true;
  state.clocks.resolveStart = 0;
  state.clocks.playbackStart = 0;
};

const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`);

const parseChannelInput = (raw: string): number | null => {
  const id = Number(raw.trim());
  return Number.isFinite(id) && id >= 1 ? id : null;
};

const shortError = (message: string) => (message.length <= 40 ? message : `${message.slice(0, 37)}…`);

const showError = (message: string) => {
  if (!ui.error) return;
  ui.error.textContent = message;
  ui.error.hidden = false;
};

const hideError = () => {
  if (ui.error) ui.error.hidden = true;
};

const stopPlayback = () => {
  state.gen += 1;
  if (state.clocks.playback) stopClock("playback");
  state.hls?.destroy();
  state.hls = null;
  if (!ui.video) return;
  ui.video.pause();
  ui.video.removeAttribute("src");
  ui.video.load();
};

const playUrl = (entry: ServerExport) =>
  entry.isHls ? entry.live || entry.direct : entry.direct;

const playStream = async (src: string, isHls: boolean): Promise<number> => {
  if (!ui.video) throw new Error("video missing");
  const id = ++state.gen;
  startClock("playback");
  state.hls?.destroy();
  state.hls = null;
  ui.video.pause();
  ui.video.removeAttribute("src");
  ui.video.load();
  const live = () => id === state.gen;
  const Hls = window.Hls;
  try {
    if (isHls && Hls?.isSupported()) {
      state.hls = new Hls(HLS_LIVE);
      state.hls.loadSource(src);
      state.hls.attachMedia(ui.video);
      await new Promise<void>((resolve, reject) => {
        state.hls!.on(Hls.Events.MANIFEST_PARSED, () => resolve());
        state.hls!.on(Hls.Events.ERROR, (_, detail) => {
          const err = detail as { fatal?: boolean; type?: string };
          if (!err.fatal || !state.hls || !Hls) return;
          if (err.type === Hls.ErrorTypes.NETWORK_ERROR) {
            state.hls.startLoad();
            return;
          }
          if (err.type === Hls.ErrorTypes.MEDIA_ERROR) {
            state.hls.recoverMediaError();
            return;
          }
          reject(new Error("playback failed"));
        });
      });
      if (!live()) return stopClock("playback");
      await ui.video.play();
      return stopClock("playback");
    }
    if (isHls && ui.video.canPlayType("application/vnd.apple.mpegurl")) {
      ui.video.src = src;
      if (!live()) return stopClock("playback");
      await ui.video.play();
      return stopClock("playback");
    }
    ui.video.src = src;
    await new Promise<void>((resolve, reject) => {
      const video = ui.video!;
      const done = () => {
        video.removeEventListener("loadedmetadata", onReady);
        video.removeEventListener("error", onErr);
      };
      const onReady = () => {
        done();
        resolve();
      };
      const onErr = () => {
        done();
        reject(new Error("playback failed"));
      };
      video.addEventListener("loadedmetadata", onReady);
      video.addEventListener("error", onErr);
      if (video.readyState >= 1) onReady();
    });
    if (!live()) return stopClock("playback");
    await ui.video.play();
    return stopClock("playback");
  } catch (err) {
    stopClock("playback");
    throw err;
  }
};

const bindExports = (entry: ServerExport) => {
  ui.exports.direct!.value = entry.direct;
  ui.exports.proxy!.value = entry.live ?? "";
  ui.exports.vlc!.value = entry.vlc;
  ui.exports.mpv!.value = entry.mpv;
  if (ui.exportCard) ui.exportCard.hidden = false;
  bindStreamNotes(entry.expiresAt);
};

const paintServers = () => {
  if (!ui.servers) return;
  const sorted = [...state.servers].sort(
    (a, b) => PLAYER_IDS.indexOf(a.server) - PLAYER_IDS.indexOf(b.server),
  );
  ui.servers.innerHTML = sorted
    .map((entry) => {
      const name = entry.label;
      if (isIdle(entry)) {
        return `<button type="button" class="badge" data-server="${entry.server}"><span class="badge__name">${name}</span></button>`;
      }
      if (isRunning(entry)) {
        return `<button type="button" class="badge badge--running" data-server="${entry.server}" disabled><span class="badge__name">${name}</span></button>`;
      }
      const active = entry.server === state.active ? " badge--active" : "";
      if (!entry.ok) {
        return `<button type="button" class="badge badge--fail${active}" data-server="${entry.server}" title="${entry.error.replace(/"/g, "&quot;")}"><span class="badge__name">${name}</span><span class="badge__tag">${shortError(entry.error)}</span></button>`;
      }
      return `<button type="button" class="badge${active}" data-server="${entry.server}"><span class="badge__name">${name}</span></button>`;
    })
    .join("");
};

const resetBadges = () => {
  state.servers = PLAYER_IDS.map((server) => ({
    server,
    label: playerLabel(server),
    idle: true as const,
  }));
  state.active = "";
  paintServers();
};

const upsertServer = (entry: ServerEntry) => {
  const idx = state.servers.findIndex((item) => item.server === entry.server);
  if (idx >= 0) state.servers[idx] = entry;
  else state.servers.push(entry);
};

const selectServer = async (server: ServerKind) => {
  const channelId = parseChannelInput(ui.channel?.value ?? "");
  if (!channelId) {
    showError("enter a valid channel ID");
    return;
  }
  if (ui.channel) ui.channel.value = String(channelId);
  state.channelId = channelId;
  hideError();
  stopPlayback();
  clearTiming();
  clearStreamNotes();
  if (ui.playerCard) ui.playerCard.hidden = false;

  const reqId = ++state.resolveGen;
  state.active = server;
  for (const entry of state.servers) {
    if (entry.server !== server && isRunning(entry)) {
      upsertServer({ server: entry.server, label: entry.label, idle: true });
    }
  }
  upsertServer({ server, label: playerLabel(server), running: true });
  paintServers();
  if (ui.title) ui.title.textContent = `${state.label || `Channel ${channelId}`} · ${playerLabel(server)}`;
  startClock("resolve");
  setTimingValue("playback", "—");

  const live = () => reqId === state.resolveGen;

  try {
    const res = await fetch(`/api/resolve?channel=${channelId}&server=${server}`);
    const data = (await res.json()) as ServerExport & { error?: string; resolveMs?: number };
    if (!live()) return;
    const resolveMs = stopClock("resolve");
    if (!res.ok || data.error || !data.direct) {
      upsertServer({
        server,
        label: data.label ?? playerLabel(server),
        error: data.error ?? "resolve failed",
        resolveMs: data.resolveMs ?? resolveMs,
        ok: false,
      });
      paintServers();
      clearStreamNotes();
      if (ui.exportCard) ui.exportCard.hidden = true;
      showError(data.error ?? "resolve failed");
      return;
    }
    if (data.title) {
      const name = data.title.split(" · ")[0];
      if (name) state.label = name;
    }
    bindExports(data);
    try {
      const playbackMs = await playStream(playUrl(data), data.isHls);
      if (!live()) return;
      upsertServer({ ...data, resolveMs, playbackMs, ok: true });
      paintServers();
      hideError();
    } catch {
      if (!live()) return;
      upsertServer({ ...data, resolveMs, ok: true });
      paintServers();
      showError("playback failed");
    }
  } catch {
    if (!live()) return;
    stopClock("resolve");
    upsertServer({
      server,
      label: playerLabel(server),
      error: "resolve failed",
      resolveMs: 0,
      ok: false,
    });
    paintServers();
    clearTiming();
    clearStreamNotes();
    if (ui.exportCard) ui.exportCard.hidden = true;
    showError("resolve failed");
  }
};

document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const id = btn.dataset.copy;
    const input = id ? $<HTMLInputElement>(id) : null;
    if (!input?.value) return;
    await navigator.clipboard.writeText(input.value);
    const label = btn.textContent;
    btn.textContent = "Copied";
    btn.classList.add("ok");
    setTimeout(() => {
      btn.textContent = label;
      btn.classList.remove("ok");
    }, 1200);
  });
});

ui.servers?.addEventListener("click", (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-server]");
  if (!btn?.dataset.server || btn.disabled) return;
  void selectServer(btn.dataset.server as ServerKind);
});

ui.channel?.addEventListener("change", () => {
  stopPlayback();
  state.resolveGen += 1;
  state.label = "";
  state.active = "";
  if (ui.playerCard) ui.playerCard.hidden = true;
  if (ui.exportCard) ui.exportCard.hidden = true;
  clearTiming();
  clearStreamNotes();
  hideError();
  resetBadges();
});

ui.form?.addEventListener("submit", (event) => {
  event.preventDefault();
});

resetBadges();
