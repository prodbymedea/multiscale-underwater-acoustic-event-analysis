const SHOT_FALLBACK = ["whales_humpback", "whales_orca"];

/* ---------------------------------------------------------------------------
 * Asset resolver
 *
 * The frontend is intentionally pure-static (no Vite, no npm, no backend).
 * It must work under at least these `python -m http.server` modes:
 *
 *   A) From the repo root            (URL: /site/)
 *      python -m http.server 8000
 *      → relative "../output/foo"    resolves to /output/foo  ✓
 *      → relative "output/foo"       resolves to /site/output/foo (committed
 *                                     symlink site/output → ../output) ✓
 *
 *   B) From inside site/             (URL: /)
 *      python -m http.server 8000 --directory site
 *      → relative "../output/foo"    Python's SimpleHTTPRequestHandler strips
 *                                     ".." segments → resolves to /output/foo;
 *                                     served via committed symlink site/output ✓
 *      → relative "output/foo"       resolves directly via the symlink       ✓
 *
 * Any path is therefore probed against an ordered list of bases. The first
 * successful base for a given asset *kind* is locked in for subsequent loads
 * (so we don't keep retrying ".." paths once we know they work).
 *
 * Diagnostics for every probe land on:
 *   - console.debug for successes,
 *   - console.warn for fallbacks,
 *   - console.error for total failures,
 *   - window.assetDiagnostics → { attempts, lockedBases, failures, summary() }
 * ------------------------------------------------------------------------- */
const ASSET_BASE_CANDIDATES = {
  /* Full pipeline outputs (gitignored). */
  output: ["../output", "./output", "output", "./data"],
  /* Small JSON samples committed for fallback rendering. */
  samples: ["../output_samples", "./output_samples", "output_samples"]
};

const assetResolver = {
  lockedBases: { output: null, samples: null },
  attempts: [],
  failures: [],
  summary() {
    return {
      lockedBases: { ...this.lockedBases },
      attempts: this.attempts.slice(),
      failures: this.failures.slice()
    };
  }
};
if (typeof window !== "undefined") {
  window.assetDiagnostics = assetResolver;
}

function _assetCandidates(kind) {
  const list = ASSET_BASE_CANDIDATES[kind];
  if (!list) {
    throw new Error(`Unknown asset kind: ${kind}`);
  }
  const locked = assetResolver.lockedBases[kind];
  if (!locked) {
    return list.slice();
  }
  return [locked, ...list.filter((b) => b !== locked)];
}

function _normalizeRel(rel) {
  if (!rel) {
    return "";
  }
  let r = String(rel).trim();
  while (r.startsWith("/")) {
    r = r.slice(1);
  }
  return r.replace(/^\.\//, "");
}

function _recordAttempt(kind, base, rel, ok, detail) {
  const entry = { kind, base, rel, url: `${base}/${rel}`, ok, detail, t: Date.now() };
  assetResolver.attempts.push(entry);
  if (ok) {
    if (!assetResolver.lockedBases[kind]) {
      assetResolver.lockedBases[kind] = base;
      console.info(`[asset:${kind}] base locked → ${base} (via ${rel})`);
    }
    console.debug(`[asset:${kind}] ${entry.url} OK`);
  } else {
    console.debug(`[asset:${kind}] ${entry.url} fail (${detail})`);
  }
}

async function _probeJson(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function _probeArrayBuffer(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

/**
 * Try to load `relPath` against every candidate base for `kind` and return
 * the first successful payload, plus the URL/base used.
 *
 * Always returns an object — never throws. Callers decide whether `null`
 * data is fatal for their panel and surface a readable error.
 */
async function loadAssetJson(kind, relPath) {
  const rel = _normalizeRel(relPath);
  const tried = [];
  for (const base of _assetCandidates(kind)) {
    const url = `${base}/${rel}`;
    try {
      const data = await _probeJson(url);
      _recordAttempt(kind, base, rel, true, "json");
      return { data, url, base, tried };
    } catch (err) {
      const detail = String((err && err.message) || err);
      _recordAttempt(kind, base, rel, false, detail);
      tried.push({ url, error: detail });
    }
  }
  const failure = { kind, rel, tried };
  assetResolver.failures.push(failure);
  console.warn(`[asset:${kind}] all candidates failed for ${rel}`, tried);
  return { data: null, url: null, base: null, tried };
}

async function loadAssetNpz(kind, relPath) {
  const rel = _normalizeRel(relPath);
  const tried = [];
  for (const base of _assetCandidates(kind)) {
    const url = `${base}/${rel}`;
    try {
      const ab = await _probeArrayBuffer(url);
      const npz = unzipNpzToArrays(ab);
      _recordAttempt(kind, base, rel, true, "npz");
      return { npz, url, base, tried };
    } catch (err) {
      const detail = String((err && err.message) || err);
      _recordAttempt(kind, base, rel, false, detail);
      tried.push({ url, error: detail });
    }
  }
  const failure = { kind, rel, tried };
  assetResolver.failures.push(failure);
  console.warn(`[asset:${kind}] all candidates failed for ${rel}`, tried);
  return { npz: null, url: null, base: null, tried };
}

/** Back-compat shims so existing code keeps working unchanged. */
const OUTPUT_BASE_CANDIDATES = ASSET_BASE_CANDIDATES.output;
const SAMPLE_BASE_CANDIDATES = ASSET_BASE_CANDIDATES.samples;

const MAP_TIMELINE_PLAY_SPEED_S = 120;
const TRACK_PALETTE = ["#72f6ff", "#ff9f1c", "#9cff57", "#ffe66d", "#c9a0ff", "#ff7a59"];

const state = {
  indexSource: null,
  manifestSource: null,
  shotOptions: [],
  selectedShotId: null,
  selectedManifest: null,
  shotBundle: null,
  eventCount: null,
  dasViewMode: "waterfall",
  shotLoadSeq: 0,
  dasWaterfallCache: {},
  dasWaterfallLoading: {},
  playing: false,
  cursorTime: 0,
  selchCursorKey: null,
  selchCursorTime: 0,
  hover: {
    das: null,
    hydro: null,
    map: null,
    mapNode: null
  },
  geometry: {
    das: null,
    hydro: null,
    map: null,
    selch: null
  },
  mapTimeline: {
    mode: "full",
    time: 0,
    playing: false,
    extent: {
      start: 0,
      end: 30
    }
  },
  hoverFrame: 0,
  hoverEvent: null,
  hoverTarget: null,
  draggingTarget: null,
  mapPointerDown: null,
  mapViewport: {
    zoom: 1,
    targetZoom: 1,
    offsetX: 0,
    offsetY: 0
  },
  mainRenderFrame: 0,
  mapRenderFrame: 0,
  mapZoomFrame: 0,
  mapZoomActive: false,
  mapPanFrame: 0,
  mapPanDX: 0,
  mapPanDY: 0,
  mapPanLastRenderTs: 0,
  mapTimelinePlayFrame: 0,
  mapTimelineLastTickMs: 0,
  lastStatusMessage: null
};

const el = {
  shotSelect: document.getElementById("shot-select"),
  startInput: document.getElementById("interval-start"),
  endInput: document.getElementById("interval-end"),
  intervalApplyBtn: document.getElementById("interval-apply"),
  intervalResetBtn: document.getElementById("interval-reset"),
  playBtn: document.getElementById("play-btn"),
  pauseBtn: document.getElementById("pause-btn"),
  playbackStatus: document.getElementById("playback-status"),
  dataStatus: document.getElementById("data-status"),
  metaShot: document.getElementById("meta-shot"),
  metaTimeRange: document.getElementById("meta-time-range"),
  metaRecommended: document.getElementById("meta-recommended"),
  metaCurrentInterval: document.getElementById("meta-current-interval"),
  metaEventCount: document.getElementById("meta-event-count"),
  metaActiveEvent: document.getElementById("meta-active-event"),
  metaGroundTruth: document.getElementById("meta-ground-truth"),
  dasHeading: document.getElementById("das-heading"),
  dasModeActivity: document.getElementById("das-mode-activity"),
  dasModeWaterfall: document.getElementById("das-mode-waterfall"),
  dasCanvas: document.getElementById("das-canvas"),
  dasCaption: document.getElementById("das-caption"),
  hydroSvg: document.getElementById("hydro-svg"),
  hydroCaption: document.getElementById("hydro-caption"),
  mapSvg: document.getElementById("map-svg"),
  mapCaption: document.getElementById("map-caption"),
  mapControls: document.getElementById("map-controls"),
  mapModeFull: document.getElementById("map-mode-full"),
  mapModeTime: document.getElementById("map-mode-time"),
  mapTimePlay: document.getElementById("map-time-play"),
  mapTimeSlider: document.getElementById("map-time-slider"),
  mapTimeValue: document.getElementById("map-time-value"),
  mapTimeNote: document.getElementById("map-time-note"),
  mapSummaryShot: document.getElementById("map-summary-shot"),
  mapSummaryEvents: document.getElementById("map-summary-events"),
  mapSummaryInterval: document.getElementById("map-summary-interval"),
  mapSummaryChannel: document.getElementById("map-summary-channel"),
  mapSummaryDistance: document.getElementById("map-summary-distance"),
  mapSummaryBand: document.getElementById("map-summary-band"),
  mapSummarySource: document.getElementById("map-summary-source"),
  mapSummaryHint: document.getElementById("map-summary-hint"),
  mapSnapEvent: document.getElementById("map-snap-event"),
  mapSnapDepth: document.getElementById("map-snap-depth"),
  mapSnapSourceX: document.getElementById("map-snap-source-x"),
  mapSnapSourceY: document.getElementById("map-snap-source-y"),
  mapSnapTracks: document.getElementById("map-snap-tracks"),
  mapSnapRecorders: document.getElementById("map-snap-recorders"),
  mapSnapMode: document.getElementById("map-snap-mode"),
  mapLegendPanel: document.getElementById("map-legend-panel"),
  mapChannelChipsWrap: document.getElementById("map-channel-chips-wrap"),
  mapChannelChips: document.getElementById("map-channel-chips"),
  mapZoomIn: document.getElementById("map-zoom-in"),
  mapZoomOut: document.getElementById("map-zoom-out"),
  mapView: document.getElementById("map-view"),
  eventNav: document.getElementById("event-nav"),
  hoverTooltip: document.getElementById("hover-tooltip"),
  selchUnavailable: document.getElementById("selch-unavailable"),
  selchContent: document.getElementById("selch-content"),
  selchSubtitle: document.getElementById("selch-subtitle"),
  selchSpecCanvas: document.getElementById("selch-spec-canvas"),
  selchBandCanvas: document.getElementById("selch-band-canvas"),
  selchWaveCanvas: document.getElementById("selch-wave-canvas"),
  selchCaption: document.getElementById("selch-caption"),
  selchChannelWrap: document.getElementById("selch-channel-wrap"),
  selchChannelSelect: document.getElementById("selch-channel-select"),
  selchAudioWrap: document.getElementById("selch-audio-wrap"),
  selchAudioHint: document.getElementById("selch-audio-hint"),
  selchPlayDasAudio: document.getElementById("selch-play-das-audio"),
  selchPlaySourceAudio: document.getElementById("selch-play-source-audio"),
  selchStopAudio: document.getElementById("selch-stop-audio"),
  selchAudioScrubber: document.getElementById("selch-audio-scrubber"),
  selchAudioScrubberTime: document.getElementById("selch-audio-scrubber-time")
};

/** Selected-channel demo audio: stop before shot/channel change. */
let selchDemoAudioSource = null;
let selchDemoAudioState = null;

function stopSelchDemoAudio(options = {}) {
  const { silent = false } = options;
  if (selchDemoAudioState?.frame) {
    cancelAnimationFrame(selchDemoAudioState.frame);
  }
  selchDemoAudioState = null;
  if (!selchDemoAudioSource) {
    return;
  }
  try {
    selchDemoAudioSource.stop(0);
  } catch (_) {
    /* already stopped */
  }
  try {
    selchDemoAudioSource.disconnect();
  } catch (_) {
    /* ignore */
  }
  selchDemoAudioSource = null;
  if (!silent) {
    updateDataStatus("Selected-channel audio stopped.");
  }
}

function getSharedAudioContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) {
    return null;
  }
  if (!getSharedAudioContext._ctx) {
    getSharedAudioContext._ctx = new AC();
  }
  const ctx = getSharedAudioContext._ctx;
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  return ctx;
}

function getSelectedChannelDasAudioPayload(sc) {
  const ba = sc?.bandpassAudio;
  let t = ba?.t;
  let y = ba?.y;
  let fs = Number.isFinite(ba?.fs) ? ba.fs : sc?.signalFs;
  let label = "band-pass DAS";
  if (!y?.length) {
    t = sc?.signal?.t;
    y = sc?.signal?.y;
    label = "median-centered DAS (wideband)";
  }
  if (!t?.length || !y?.length || t.length !== y.length || !Number.isFinite(fs) || fs <= 0) {
    return null;
  }
  return {
    t,
    y,
    fs,
    label,
    timeStart: Number(t[0]),
    timeEnd: Number(t[t.length - 1]),
    duration: y.length / fs
  };
}

function tickSelchDasPlaybackCursor() {
  const playback = selchDemoAudioState;
  if (!playback?.ctx) {
    return;
  }
  const elapsed = playback.ctx.currentTime - playback.ctxStartedAt;
  const nextTime = Math.min(playback.endTime, playback.startTime + Math.max(0, elapsed));
  state.selchCursorTime = nextTime;
  renderSelectedChannelPanel();
  renderHydroPanel();
  if (nextTime >= playback.endTime - 0.005) {
    finishSelchDasPlayback();
    return;
  }
  playback.frame = requestAnimationFrame(tickSelchDasPlaybackCursor);
}

function finishSelchDasPlayback() {
  const playback = selchDemoAudioState;
  if (!playback) {
    return;
  }
  const resetTime = Number(playback.resetTime);
  const label = playback.label;
  stopSelchDemoAudio({ silent: true });
  if (Number.isFinite(resetTime)) {
    state.selchCursorTime = resetTime;
    renderSelectedChannelPanel();
    renderHydroPanel();
  }
  updateDataStatus(`Finished ${label}; cursor reset to start.`);
}

function syncSelchAudioScrubber(sc = state.shotBundle?.selectedChannel) {
  if (!el.selchAudioScrubber) {
    return;
  }
  const range = getSelectedChannelFullTimeRange(sc);
  const rawCursor = Number.isFinite(state.selchCursorTime) ? state.selchCursorTime : range.start;
  const cursor = clamp(rawCursor, range.start, range.end);
  el.selchAudioScrubber.min = range.start.toFixed(3);
  el.selchAudioScrubber.max = range.end.toFixed(3);
  el.selchAudioScrubber.step = "0.01";
  el.selchAudioScrubber.value = cursor.toFixed(3);
  if (el.selchAudioScrubberTime) {
    el.selchAudioScrubberTime.textContent = `${cursor.toFixed(2)} s`;
  }
}

function startSelchDasPlayback() {
  const sc = state.shotBundle?.selectedChannel;
  if (!sc?.available) {
    return;
  }
  stopSelchDemoAudio({ silent: true });
  const ctx = getSharedAudioContext();
  if (!ctx) {
    updateDataStatus("Web Audio API not available in this browser.");
    return;
  }
  const audio = getSelectedChannelDasAudioPayload(sc);
  if (!audio) {
    updateDataStatus("No DAS waveform available for audio.");
    return;
  }
  const rawStartTime = Number.isFinite(state.selchCursorTime) ? state.selchCursorTime : audio.timeStart;
  const cursorStartTime = clamp(rawStartTime, audio.timeStart, audio.timeEnd);
  const startTime = cursorStartTime >= audio.timeEnd - 0.005 ? audio.timeStart : cursorStartTime;
  const endTime = audio.timeEnd;
  state.selchCursorTime = startTime;
  renderSelectedChannelPanel();
  renderHydroPanel();

  const { y, fs, label } = audio;
  const n = y.length;
  const buf = ctx.createBuffer(1, n, fs);
  const ch = buf.getChannelData(0);
  let mx = 0;
  for (let i = 0; i < n; i++) {
    mx = Math.max(mx, Math.abs(y[i]));
  }
  const gain = mx > 0 ? 0.88 / mx : 1;
  for (let i = 0; i < n; i++) {
    ch[i] = y[i] * gain;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  selchDemoAudioSource = src;
  const offset = clamp(startTime - audio.timeStart, 0, Math.max(0, buf.duration - 0.001));
  const duration = Math.max(0.01, Math.min(endTime - startTime, buf.duration - offset));
  const playbackEnd = Math.min(endTime, startTime + duration);
  selchDemoAudioState = {
    ctx,
    ctxStartedAt: ctx.currentTime,
    startTime,
    endTime: playbackEnd,
    label,
    resetTime: audio.timeStart,
    frame: 0
  };
  src.onended = () => {
    selchDemoAudioSource = null;
    if (selchDemoAudioState) {
      finishSelchDasPlayback();
    }
  };
  src.start(0, offset, duration);
  tickSelchDasPlaybackCursor();
  updateDataStatus(`Playing ${label} from ${startTime.toFixed(2)} s to ${playbackEnd.toFixed(2)} s.`);
}

function getSourceAudioCompare() {
  const b = state.shotBundle;
  return b?.sourceAudioCompare || b?.orcaAudioCompare || null;
}

async function playSelchSourceReference() {
  const sac = getSourceAudioCompare();
  const rel = sac?.doc?.source_wav_playback_file || sac?.doc?.source_wav_file;
  if (!rel || !sac.baseDir) {
    updateDataStatus("Source reference audio not loaded (re-run build_selected_channel_bundle for this shot).");
    return;
  }
  stopSelchDemoAudio();
  const ctx = getSharedAudioContext();
  if (!ctx) {
    updateDataStatus("Web Audio API not available in this browser.");
    return;
  }
  try {
    const url = `${sac.baseDir}/${rel}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const arr = await res.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(arr.slice(0));
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(ctx.destination);
    selchDemoAudioSource = src;
    src.onended = () => {
      selchDemoAudioSource = null;
    };
    src.start(0);
    updateDataStatus("Playing source reference segment (demo)…");
  } catch (error) {
    updateDataStatus(`Source playback failed: ${summarizeError(error)}`);
  }
}

function updateDataStatus(message) {
  if (state.lastStatusMessage === message) {
    return;
  }
  state.lastStatusMessage = message;
  if (el.dataStatus) {
    el.dataStatus.textContent = message;
  }
}

function formatSeconds(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `${value.toFixed(2)} s`;
}

function parseNumeric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resetMapViewport() {
  if (state.mapZoomFrame) {
    cancelAnimationFrame(state.mapZoomFrame);
    state.mapZoomFrame = 0;
  }
  state.mapZoomActive = false;
  state.mapViewport.zoom = 1;
  state.mapViewport.targetZoom = 1;
  state.mapViewport.offsetX = 0;
  state.mapViewport.offsetY = 0;
}

function scheduleMapRender() {
  if (state.mapRenderFrame) {
    return;
  }
  state.mapRenderFrame = requestAnimationFrame(() => {
    state.mapRenderFrame = 0;
    if (state.shotBundle) {
      renderMapPanel();
    }
  });
}

function scheduleMainRender() {
  if (state.mainRenderFrame) {
    return;
  }
  state.mainRenderFrame = requestAnimationFrame(() => {
    state.mainRenderFrame = 0;
    if (state.shotBundle) {
      renderAllPanels();
    }
  });
}

function animateMapZoom() {
  if (state.mapZoomFrame) {
    state.mapZoomActive = true;
    return;
  }

  state.mapZoomActive = true;
  let frameCount = 0;
  const tick = () => {
    state.mapZoomFrame = 0;
    const current = state.mapViewport.zoom;
    const target = state.mapViewport.targetZoom;
    const next = current + (target - current) * 0.62;
    frameCount += 1;

    if (Math.abs(next - target) < 0.01 || frameCount >= 3) {
      state.mapViewport.zoom = target;
      state.mapZoomActive = false;
      scheduleMapRender();
      return;
    }

    state.mapViewport.zoom = next;
    scheduleMapRender();
    state.mapZoomFrame = requestAnimationFrame(tick);
  };

  state.mapZoomFrame = requestAnimationFrame(tick);
}

function scheduleMapPanApply() {
  if (state.mapPanFrame) {
    return;
  }

  state.mapPanFrame = requestAnimationFrame(() => {
    state.mapPanFrame = 0;
    const nowTs = typeof performance !== "undefined" ? performance.now() : Date.now();

    const geo = state.geometry.map;
    if (!geo) {
      state.mapPanDX = 0;
      state.mapPanDY = 0;
      return;
    }

    const dx = state.mapPanDX;
    const dy = state.mapPanDY;
    state.mapPanDX = 0;
    state.mapPanDY = 0;

    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
      return;
    }

    // Keep drag responsive by limiting expensive full-map rerenders to ~40 FPS.
    if (state.draggingTarget === "map" && nowTs - state.mapPanLastRenderTs < 25) {
      state.mapPanDX += dx;
      state.mapPanDY += dy;
      scheduleMapPanApply();
      return;
    }

    state.mapViewport.offsetX = clamp(
      state.mapViewport.offsetX - (dx / Math.max(1, geo.plotW)) / state.mapViewport.zoom,
      -0.5,
      0.5
    );
    state.mapViewport.offsetY = clamp(
      state.mapViewport.offsetY + (dy / Math.max(1, geo.plotH)) / state.mapViewport.zoom,
      -0.5,
      0.5
    );
    state.mapPanLastRenderTs = nowTs;
    scheduleMapRender();

    if (Math.abs(state.mapPanDX) > 0.01 || Math.abs(state.mapPanDY) > 0.01) {
      scheduleMapPanApply();
    }
  });
}

function summarizeError(error) {
  if (!error) {
    return "unknown error";
  }
  return error.message || String(error);
}

function showTooltip(title, body, clientX, clientY) {
  const tip = el.hoverTooltip;
  tip.innerHTML = `<div class="title">${title}</div><p class="body">${body}</p>`;
  tip.classList.toggle("tooltip-source", String(title || "").toLowerCase().includes("source"));
  tip.classList.add("visible");
  tip.setAttribute("aria-hidden", "false");

  requestAnimationFrame(() => {
    const margin = 14;
    const left = Math.min(clientX + 16, window.innerWidth - tip.offsetWidth - margin);
    const top = Math.min(clientY + 16, window.innerHeight - tip.offsetHeight - margin);
    tip.style.left = `${Math.max(margin, left)}px`;
    tip.style.top = `${Math.max(margin, top)}px`;
  });
}

function hideTooltip() {
  const tip = el.hoverTooltip;
  tip.classList.remove("visible");
  tip.setAttribute("aria-hidden", "true");
}

function clearMapHoverState() {
  const prevNode = state.hover.mapNode;
  if (prevNode && prevNode.classList) {
    prevNode.classList.remove("is-hovered");
  }
  state.hover.mapNode = null;
  state.hover.map = null;
  hideTooltip();
}

function scheduleHoverTooltip(target, event, compute) {
  state.hoverTarget = target;
  state.hoverEvent = event;

  if (state.hoverFrame) {
    return;
  }

  state.hoverFrame = requestAnimationFrame(() => {
    state.hoverFrame = 0;
    if (state.hoverTarget !== target || !state.hoverEvent) {
      return;
    }
    compute(state.hoverEvent);
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchArrayBuffer(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.arrayBuffer();
}

function getNumpyDescrInfo(descrRaw) {
  const descr = String(descrRaw || "").trim();
  if (!descr) {
    return null;
  }
  const map = {
    "<f4": { bytes: 4, kind: "f32" },
    float32: { bytes: 4, kind: "f32" },
    "<f8": { bytes: 8, kind: "f64" },
    float64: { bytes: 8, kind: "f64" },
    "<i4": { bytes: 4, kind: "i32" },
    int32: { bytes: 4, kind: "i32" },
    "<i2": { bytes: 2, kind: "i16" },
    int16: { bytes: 2, kind: "i16" },
    "<u2": { bytes: 2, kind: "u16" },
    uint16: { bytes: 2, kind: "u16" },
    "|u1": { bytes: 1, kind: "u8" },
    uint8: { bytes: 1, kind: "u8" },
    "|i1": { bytes: 1, kind: "i8" },
    int8: { bytes: 1, kind: "i8" },
    "|b1": { bytes: 1, kind: "u8" },
    bool: { bytes: 1, kind: "u8" },
    "?": { bytes: 1, kind: "u8" }
  };
  if (map[descr]) {
    return { ...map[descr], descr, bigEndian: false };
  }
  if (descr.startsWith(">f4")) {
    return { bytes: 4, kind: "f32be", descr, bigEndian: true };
  }
  if (descr.startsWith(">f8")) {
    return { bytes: 8, kind: "f64be", descr, bigEndian: true };
  }
  return null;
}

function shouldSkipNumpyDescr(descr) {
  const d = String(descr || "");
  return /^[|<]U\d/.test(d) || /^[|<]S\d/.test(d) || d.includes("object") || d === "|O8";
}

function parseNpyArrayBuffer(buffer) {
  const u8 = new Uint8Array(buffer);
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3], u8[4], u8[5]);
  if (magic !== "\x93NUMPY") {
    throw new Error("Invalid NPY file");
  }
  const major = u8[6];
  let headerLen;
  let headerOffset;
  if (major === 1) {
    headerLen = u8[8] | (u8[9] << 8);
    headerOffset = 10;
  } else if (major === 2) {
    const dv0 = new DataView(buffer);
    headerLen = dv0.getUint32(8, true);
    headerOffset = 12;
  } else {
    throw new Error(`Unsupported NPY version ${major}.${u8[7]}`);
  }

  const headerStr = new TextDecoder("latin1").decode(u8.subarray(headerOffset, headerOffset + headerLen));
  const descrMatch = headerStr.match(/'descr':\s*'((?:\\'|[^'])*)'|"descr":\s*"((?:\\"|[^"])*)"/);
  const descrRaw = descrMatch ? descrMatch[1] || descrMatch[2] : null;
  const descr = descrRaw ? descrRaw.replace(/\\'/g, "'") : null;
  if (!descr) {
    throw new Error("NPY missing descr");
  }
  if (shouldSkipNumpyDescr(descr)) {
    return { skipped: true, descr };
  }

  const shapeMatch = headerStr.match(/'shape':\s*\(([^)]*)\)/);
  const inner = shapeMatch ? shapeMatch[1].trim() : "";
  let shape = [];
  if (inner) {
    shape = inner
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((x) => Number.parseInt(x, 10))
      .filter((n) => Number.isFinite(n));
  }
  let nElems = 1;
  for (const dim of shape) {
    nElems *= dim;
  }

  const fortran = /'fortran_order':\s*True/.test(headerStr);
  let dataOffset = headerOffset + headerLen;
  while (dataOffset % 16 !== 0) {
    dataOffset += 1;
  }

  const info = getNumpyDescrInfo(descr);
  if (!info) {
    throw new Error(`Unsupported NPY dtype ${descr}`);
  }
  if (dataOffset + nElems * info.bytes > buffer.byteLength) {
    throw new Error("NPY payload exceeds buffer");
  }

  const dv = new DataView(buffer);

  function readBigF32(idx) {
    return dv.getFloat32(dataOffset + idx * 4, false);
  }
  function readBigF64(idx) {
    return dv.getFloat64(dataOffset + idx * 8, false);
  }

  let data;
  if (!info.bigEndian && info.kind === "f32") {
    data = new Float32Array(buffer, dataOffset, nElems);
  } else if (!info.bigEndian && info.kind === "f64") {
    data = new Float64Array(buffer, dataOffset, nElems);
  } else if (!info.bigEndian && info.kind === "i32") {
    data = new Int32Array(buffer, dataOffset, nElems);
  } else if (!info.bigEndian && info.kind === "i16") {
    data = new Int16Array(buffer, dataOffset, nElems);
  } else if (!info.bigEndian && info.kind === "u16") {
    data = new Uint16Array(buffer, dataOffset, nElems);
  } else if (!info.bigEndian && info.kind === "u8") {
    data = new Uint8Array(buffer, dataOffset, nElems);
  } else if (!info.bigEndian && info.kind === "i8") {
    data = new Int8Array(buffer, dataOffset, nElems);
  } else if (info.kind === "f32be") {
    data = new Float32Array(nElems);
    for (let i = 0; i < nElems; i += 1) {
      data[i] = readBigF32(i);
    }
  } else if (info.kind === "f64be") {
    data = new Float64Array(nElems);
    for (let i = 0; i < nElems; i += 1) {
      data[i] = readBigF64(i);
    }
  } else {
    throw new Error(`Unhandled NPY layout ${descr}`);
  }

  return { data, shape, descr, fortran };
}

function unzipNpzToArrays(arrayBuffer) {
  const lib = typeof fflate !== "undefined" ? fflate : globalThis.fflate;
  if (!lib || typeof lib.unzipSync !== "function") {
    throw new Error("fflate.unzipSync is not available");
  }
  const bytes = new Uint8Array(arrayBuffer);
  const entries = lib.unzipSync(bytes);
  const out = {};
  for (const name of Object.keys(entries || {})) {
    if (!name.toLowerCase().endsWith(".npy")) {
      continue;
    }
    const key = name.replace(/\.npy$/i, "");
    const zbuf = entries[name];
    const ab = zbuf.buffer.slice(zbuf.byteOffset, zbuf.byteOffset + zbuf.byteLength);
    let parsed;
    try {
      parsed = parseNpyArrayBuffer(ab);
    } catch (_) {
      continue;
    }
    if (parsed.skipped) {
      continue;
    }
    out[key] = parsed;
  }
  return out;
}

async function fetchNpz(url) {
  const ab = await fetchArrayBuffer(url);
  return unzipNpzToArrays(ab);
}

function manifestRelativeFetchUrls(baseDir, relPath) {
  if (!relPath || typeof relPath !== "string") {
    return [];
  }
  const trimmed = relPath.trim().replace(/^\.\//, "");
  const urls = [];
  urls.push(`${baseDir}/${trimmed}`);
  if (trimmed.startsWith("output/") || trimmed.includes("output/shots/")) {
    const slashIdx = trimmed.lastIndexOf("/");
    const baseName = slashIdx >= 0 ? trimmed.slice(slashIdx + 1) : trimmed;
    const alt = `${baseDir}/${baseName}`;
    if (alt !== urls[0]) {
      urls.push(alt);
    }
  }
  return urls;
}

async function fetchNpzFromManifestPaths(baseDir, relPath) {
  const urls = manifestRelativeFetchUrls(baseDir, relPath);
  for (const url of urls) {
    try {
      return await fetchNpz(url);
    } catch (_) {
      // try next candidate
    }
  }
  return null;
}

async function fetchJsonFromManifestPaths(baseDir, relPath) {
  const urls = manifestRelativeFetchUrls(baseDir, relPath);
  for (const url of urls) {
    try {
      return await fetchJson(url);
    } catch (_) {
      // try next candidate
    }
  }
  return null;
}

function buildDasActivityFromNpz(npz) {
  if (!npz) {
    return null;
  }
  const am = npz.activity_map;
  const tw = npz.t_windows_s;
  const dist = npz.distances_m;
  if (!am?.data || !tw?.data || !dist?.data) {
    return null;
  }
  const shape = am.shape;
  if (shape.length !== 2) {
    return null;
  }
  const nt = shape[0];
  const nd = shape[1];
  if (tw.data.length !== nt || dist.data.length !== nd) {
    return null;
  }
  const act = am.data;
  const fortran = !!am.fortran;
  const matrix = [];
  for (let i = 0; i < nt; i += 1) {
    const row = new Array(nd);
    for (let j = 0; j < nd; j += 1) {
      row[j] = fortran ? act[j * nt + i] : act[i * nd + j];
    }
    matrix.push(row);
  }
  return {
    axes: {
      t_s: Array.from(tw.data),
      distances_m: Array.from(dist.data)
    },
    activity_01: matrix
  };
}

function buildDasWaterfallFromNpz(npz) {
  if (!npz) {
    return null;
  }
  const wf = npz.data || npz.preprocessed_preview || npz.raw_preview;
  const t = npz.t_s;
  const ch = npz.channel_indices || npz.preview_cols;
  if (!wf?.data || !t?.data || !ch?.data || wf.shape?.length !== 2) {
    return null;
  }

  const shape = wf.shape;
  const nt = t.data.length;
  const nc = ch.data.length;
  let orientation = null;
  if (shape[0] === nt && shape[1] === nc) {
    orientation = "time_channel";
  } else if (shape[0] === nc && shape[1] === nt) {
    orientation = "channel_time";
  } else {
    return null;
  }

  const distances = npz.distances_m?.data && npz.distances_m.data.length === nc
    ? Array.from(npz.distances_m.data)
    : null;
  let fsHz = Number(npz.fs_hz?.data?.[0] ?? npz.sample_rate_hz?.data?.[0]);
  if (!Number.isFinite(fsHz) && nt > 1) {
    const dt = Number(t.data[1]) - Number(t.data[0]);
    fsHz = dt > 0 ? 1 / dt : null;
  }

  const payload = {
    axes: {
      t_s: Array.from(t.data),
      channel_indices: Array.from(ch.data),
      sample_indices: npz.sample_indices?.data ? Array.from(npz.sample_indices.data) : null,
      distances_m: distances
    },
    data: wf.data,
    shape,
    fortran: !!wf.fortran,
    orientation,
    fsHz,
    sourceKey: npz.data ? "data" : (npz.preprocessed_preview ? "preprocessed_preview" : "raw_preview"),
    amplitudeUnits: npz.data ? "native DAS counts" : (npz.preprocessed_preview ? "robust-normalized amplitude" : "DAS amplitude"),
    colorScale: null
  };

  console.info(
    `[das-waterfall] loaded shape=${shape.join("x")} orientation=${orientation} source=${payload.sourceKey}`
  );
  console.info(
    `[das-waterfall] t_s ${payload.axes.t_s[0]}..${payload.axes.t_s[payload.axes.t_s.length - 1]}, ` +
    `channels ${payload.axes.channel_indices[0]}..${payload.axes.channel_indices[payload.axes.channel_indices.length - 1]}, fs≈${fsHz?.toFixed?.(2) || "unknown"} Hz`
  );
  return payload;
}

function buildHydroActivityFromNpz(npz, scoreMetadata) {
  if (!npz) {
    return null;
  }
  const t = npz.t_s?.data;
  const raw = npz.raw_score?.data;
  if (!t || !raw || t.length !== raw.length) {
    return null;
  }
  const thresholdDb = Number(scoreMetadata?.detector?.threshold_db);
  const hydro = {
    t_s: Array.from(t),
    score_db: Array.from(raw),
    normalization: {}
  };
  if (Number.isFinite(thresholdDb)) {
    hydro.normalization.threshold_db = thresholdDb;
  }
  return hydro;
}

async function attachMainPanelsFromNpzFallback(manifest, manifestUrl, bundle) {
  const baseDir = getBaseDir(manifestUrl);
  const files = manifest?.files || {};

  if (!bundle.dasActivity) {
    const rel = files.das_activity_map_file || files.das_activity_map;
    const npz =
      (rel && (await fetchNpzFromManifestPaths(baseDir, rel))) ||
      (await fetchNpzFromManifestPaths(baseDir, "das_activity_map.npz"));
    const built = buildDasActivityFromNpz(npz);
    if (built) {
      bundle.dasActivity = built;
    }
  }

  if (!bundle.hydroActivity) {
    const rel = files.hydrophone_score_file || files.hydrophone_event_score;
    const npz =
      (rel && (await fetchNpzFromManifestPaths(baseDir, rel))) ||
      (await fetchNpzFromManifestPaths(baseDir, "hydrophone_event_score.npz"));
    if (npz) {
      const metaRel = files.hydrophone_score_metadata_file || files.hydrophone_event_score_metadata;
      let scoreMeta =
        (metaRel && (await fetchJsonFromManifestPaths(baseDir, metaRel))) ||
        (await fetchJsonFromManifestPaths(baseDir, "hydrophone_event_score_metadata.json"));
      const built = buildHydroActivityFromNpz(npz, scoreMeta);
      if (built) {
        bundle.hydroActivity = built;
      }
    }
  }

  if (Array.isArray(bundle.missingCompatibilityFiles)) {
    const hasDas = Boolean(bundle.dasActivity?.axes?.t_s?.length && bundle.dasActivity?.activity_01?.length);
    const hasHydro = Boolean(bundle.hydroActivity?.t_s?.length && bundle.hydroActivity?.score_db?.length);
    bundle.missingCompatibilityFiles = bundle.missingCompatibilityFiles.filter((line) => {
      if (hasDas && line.startsWith("das_activity:")) {
        return false;
      }
      if (hasHydro && line.startsWith("hydrophone_activity:")) {
        return false;
      }
      return true;
    });
  }
}

function renderDasStatusMessage(message, caption = message) {
  const { ctx, width, height } = getCanvasSize(el.dasCanvas, 404);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "rgba(8, 15, 31, 0.88)";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#9fb3d9";
  ctx.font = "14px Space Grotesk";
  ctx.fillText(message, 20, 34);
  if (el.dasCaption) {
    el.dasCaption.textContent = caption;
  }
  state.geometry.das = null;
}

async function ensureDasWaterfallLoaded() {
  const bundle = state.shotBundle;
  const manifest = state.selectedManifest;
  const manifestUrl = state.manifestSource;
  const shotId = state.selectedShotId;
  if (!bundle || !manifest || !manifestUrl || !shotId) {
    return null;
  }
  if (bundle.dasWaterfall) {
    return bundle.dasWaterfall;
  }
  const files = manifest.files || {};
  const rel = files.das_waterfall_preview || files.das_preprocessed_preview || files.das_preprocessed_preview_file || "das_waterfall_preview.npz";
  const cacheKey = `${shotId}|${rel}`;
  if (state.dasWaterfallCache[cacheKey]) {
    bundle.dasWaterfall = state.dasWaterfallCache[cacheKey];
    return bundle.dasWaterfall;
  }
  if (state.dasWaterfallLoading[cacheKey]) {
    return state.dasWaterfallLoading[cacheKey];
  }

  const loadSeq = state.shotLoadSeq;
  const baseDir = getBaseDir(manifestUrl);
  state.dasWaterfallLoading[cacheKey] = (async () => {
    try {
      const npz =
        (rel && (await fetchNpzFromManifestPaths(baseDir, rel))) ||
        (await fetchNpzFromManifestPaths(baseDir, "das_waterfall_preview.npz")) ||
        (await fetchNpzFromManifestPaths(baseDir, "das_preprocessed_preview.npz"));
      const built = buildDasWaterfallFromNpz(npz);
      if (!built) {
        throw new Error("Waterfall NPZ is missing data/t_s/channel_indices.");
      }
      state.dasWaterfallCache[cacheKey] = built;
      if (state.shotLoadSeq === loadSeq && state.selectedShotId === shotId && state.shotBundle === bundle) {
        bundle.dasWaterfall = built;
        if (state.dasViewMode === "waterfall") {
          renderDasPanel();
        }
      }
      return built;
    } catch (error) {
      if (state.shotLoadSeq === loadSeq && state.selectedShotId === shotId && state.dasViewMode === "waterfall") {
        renderDasStatusMessage("Waterfall preview not available. Run backend export.");
        updateDataStatus(`Waterfall load failed for ${shotId}: ${summarizeError(error)}`);
      }
      return null;
    } finally {
      delete state.dasWaterfallLoading[cacheKey];
    }
  })();

  return state.dasWaterfallLoading[cacheKey];
}

function scheduleDasWaterfallPrefetch() {
  const loadSeq = state.shotLoadSeq;
  const shotId = state.selectedShotId;
  const run = () => {
    if (state.shotLoadSeq !== loadSeq || state.selectedShotId !== shotId || !state.shotBundle) {
      return;
    }
    ensureDasWaterfallLoaded();
  };
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: 2500 });
  } else {
    setTimeout(run, 700);
  }
}

function lowerBoundSorted(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function upperBoundSorted(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function spectrogramValue(sxx, nf, nt, fi, ti, fortran) {
  const fiCl = clamp(Math.floor(fi), 0, nf - 1);
  const tiCl = clamp(Math.floor(ti), 0, nt - 1);
  if (!fortran) {
    return sxx[fiCl * nt + tiCl];
  }
  return sxx[tiCl * nf + fiCl];
}

function colorForSpecDbRgb(db, vmin, vmax) {
  const span = Math.max(1e-6, vmax - vmin);
  const v = clamp((db - vmin) / span, 0, 1);
  const stops = [
    [6, 12, 24],
    [0, 96, 255],
    [0, 214, 255],
    [76, 255, 184]
  ];
  const scaled = v * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const p = stops[idx];
  const q = stops[idx + 1];
  const r = Math.round(p[0] + (q[0] - p[0]) * frac);
  const g = Math.round(p[1] + (q[1] - p[1]) * frac);
  const b = Math.round(p[2] + (q[2] - p[2]) * frac);
  return [r, g, b];
}

function quantileFromSorted(sortedValues, q) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
    return null;
  }
  const qq = clamp(q, 0, 1);
  const idx = qq * (sortedValues.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) {
    return sortedValues[lo];
  }
  const frac = idx - lo;
  return sortedValues[lo] * (1 - frac) + sortedValues[hi] * frac;
}

async function tryLoadJsonFromCandidates(relativePath, baseCandidates) {
  /* Map legacy base lists back to the resolver's asset kinds so probes are
   * logged consistently and the locked base is reused. */
  let kind = null;
  if (baseCandidates === ASSET_BASE_CANDIDATES.output || baseCandidates === OUTPUT_BASE_CANDIDATES) {
    kind = "output";
  } else if (baseCandidates === ASSET_BASE_CANDIDATES.samples || baseCandidates === SAMPLE_BASE_CANDIDATES) {
    kind = "samples";
  }
  if (kind) {
    const res = await loadAssetJson(kind, relativePath);
    return { data: res.data, url: res.url, tried: res.tried };
  }
  /* Untracked base list: probe directly without locking. */
  const tried = [];
  for (const base of baseCandidates) {
    const url = `${base}/${_normalizeRel(relativePath)}`;
    try {
      const data = await _probeJson(url);
      return { data, url, tried };
    } catch (err) {
      tried.push({ url, error: String((err && err.message) || err) });
    }
  }
  return { data: null, url: null, tried };
}

async function tryLoadJsonFromUrls(urls) {
  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      return { data, url };
    } catch (_) {
      // Continue trying other candidates.
    }
  }
  return { data: null, url: null };
}

function parseIndexToShotOptions(indexData, indexUrl) {
  const shotSet = new Set();
  const options = [];

  function pushShot(shotId, manifestPath) {
    if (!shotId || shotSet.has(shotId)) {
      return;
    }
    shotSet.add(shotId);
    options.push({ shotId, manifestPath: manifestPath || null });
  }

  if (Array.isArray(indexData)) {
    indexData.forEach((item) => {
      if (typeof item === "string") {
        pushShot(item, null);
      } else if (item && typeof item === "object") {
        pushShot(item.shot_id || item.id, item.manifest || item.manifest_path || item.path);
      }
    });
  }

  if (indexData && typeof indexData === "object") {
    const arraysToScan = [indexData.shots, indexData.items];
    arraysToScan.forEach((arr) => {
      if (!Array.isArray(arr)) {
        return;
      }
      arr.forEach((item) => {
        if (typeof item === "string") {
          pushShot(item, null);
        } else if (item && typeof item === "object") {
          pushShot(item.shot_id || item.id, item.manifest || item.manifest_path || item.path);
        }
      });
    });

    if (indexData.by_shot && typeof indexData.by_shot === "object") {
      Object.entries(indexData.by_shot).forEach(([shotId, value]) => {
        if (value && typeof value === "object") {
          pushShot(shotId, value.manifest || value.manifest_path || value.path);
        } else {
          pushShot(shotId, null);
        }
      });
    }
  }

  if (options.length === 0) {
    SHOT_FALLBACK.forEach((shotId) => pushShot(shotId, null));
  }

  state.indexSource = indexUrl;
  return options;
}

function renderShotOptions() {
  el.shotSelect.innerHTML = "";
  state.shotOptions.forEach((option) => {
    const node = document.createElement("option");
    node.value = option.shotId;
    node.textContent = option.shotId;
    el.shotSelect.appendChild(node);
  });
}

function getTimeExtentFromShotBundle(bundle) {
  const avail = state.selectedManifest?.available_time_range_s;
  if (Array.isArray(avail) && avail.length >= 2 && Number.isFinite(avail[0]) && Number.isFinite(avail[1]) && avail[1] > avail[0]) {
    return { start: avail[0], end: avail[1] };
  }
  const manifestRange = state.selectedManifest?.time_extent_s;
  if (manifestRange && Number.isFinite(manifestRange.start) && Number.isFinite(manifestRange.end)) {
    return { start: manifestRange.start, end: manifestRange.end };
  }

  const dasTimes = bundle?.dasActivity?.axes?.t_s;
  if (Array.isArray(dasTimes) && dasTimes.length > 1) {
    return { start: dasTimes[0], end: dasTimes[dasTimes.length - 1] };
  }

  const hydroTimes = bundle?.hydroActivity?.t_s;
  if (Array.isArray(hydroTimes) && hydroTimes.length > 1) {
    return { start: hydroTimes[0], end: hydroTimes[hydroTimes.length - 1] };
  }

  const sourceDuration = bundle?.shotMetadata?.source?.duration_s;
  if (Number.isFinite(sourceDuration)) {
    return { start: 0, end: sourceDuration };
  }

  const dasInfo = bundle?.shotMetadata?.das;
  if (dasInfo && Number.isFinite(dasInfo.n_samples) && Number.isFinite(dasInfo.fs_hz) && dasInfo.fs_hz > 0) {
    return { start: 0, end: dasInfo.n_samples / dasInfo.fs_hz };
  }

  return { start: 0, end: 30 };
}

function getMapTimelineExtentFromSituation(bundle) {
  const tracks = bundle?.situation?.boat_tracks?.tracks;
  let start = Infinity;
  let end = -Infinity;

  Object.values(tracks || {}).forEach((trackPoints) => {
    if (!Array.isArray(trackPoints)) {
      return;
    }
    trackPoints.forEach((pt) => {
      const time = Number(pt?.t);
      if (!Number.isFinite(time)) {
        return;
      }
      if (time < start) start = time;
      if (time > end) end = time;
    });
  });

  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return { start, end };
  }

  const fiberPoints = bundle?.situation?.fiber_track?.segments?.all;
  start = Infinity;
  end = -Infinity;
  if (Array.isArray(fiberPoints)) {
    fiberPoints.forEach((pt) => {
      const time = Number(pt?.t);
      if (!Number.isFinite(time)) {
        return;
      }
      if (time < start) start = time;
      if (time > end) end = time;
    });
  }

  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return { start, end };
  }

  return { start: 0, end: 30 };
}

function syncMapTimelineControls() {
  const extent = state.mapTimeline.extent || getMapTimelineExtentFromSituation(state.shotBundle);
  const hasExtent = Number.isFinite(extent.start) && Number.isFinite(extent.end) && extent.end > extent.start;
  const normalizedTime = clamp(Number.isFinite(state.mapTimeline.time) ? state.mapTimeline.time : extent.start, extent.start, extent.end);

  if (el.mapModeFull) {
    el.mapModeFull.setAttribute("aria-pressed", String(state.mapTimeline.mode === "full"));
  }
  if (el.mapModeTime) {
    el.mapModeTime.setAttribute("aria-pressed", String(state.mapTimeline.mode === "time"));
  }
  if (el.mapTimeSlider) {
    el.mapTimeSlider.min = extent.start.toFixed(2);
    el.mapTimeSlider.max = extent.end.toFixed(2);
    el.mapTimeSlider.step = hasExtent ? Math.max(0.05, (extent.end - extent.start) / 420).toFixed(3) : "0.1";
    el.mapTimeSlider.value = normalizedTime.toFixed(2);
    el.mapTimeSlider.disabled = !state.shotBundle || state.mapTimeline.mode !== "time" || !hasExtent;
  }
  if (el.mapTimePlay) {
    el.mapTimePlay.setAttribute("aria-pressed", String(state.mapTimeline.playing));
    el.mapTimePlay.textContent = state.mapTimeline.playing ? "Pause timeline" : "Play timeline";
    el.mapTimePlay.hidden = state.mapTimeline.mode !== "time";
    el.mapTimePlay.disabled = !state.shotBundle || !hasExtent || state.mapTimeline.mode !== "time";
  }
  if (el.mapTimeValue) {
    el.mapTimeValue.textContent = state.mapTimeline.mode === "full"
      ? "Full map"
      : `Map time ${formatSeconds(normalizedTime)}`;
  }
  if (el.mapTimeNote) {
    el.mapTimeNote.textContent = state.mapTimeline.mode === "full"
      ? ""
      : "Situation timeline only";
  }
  updateMapSnapshotPanel();
}

function resetMapTimelineForShot() {
  stopMapTimelinePlayback();
  const extent = getMapTimelineExtentFromSituation(state.shotBundle);
  state.mapTimeline.extent = extent;
  state.mapTimeline.mode = "full";
  state.mapTimeline.time = extent.start;
  syncMapTimelineControls();
}

function stopMapTimelinePlayback() {
  state.mapTimeline.playing = false;
  state.mapTimelineLastTickMs = 0;
  if (state.mapTimelinePlayFrame) {
    cancelAnimationFrame(state.mapTimelinePlayFrame);
    state.mapTimelinePlayFrame = 0;
  }
}

function startMapTimelinePlayback() {
  const extent = state.mapTimeline.extent || getMapTimelineExtentFromSituation(state.shotBundle);
  if (!Number.isFinite(extent.start) || !Number.isFinite(extent.end) || extent.end <= extent.start) {
    return;
  }

  state.mapTimeline.mode = "time";
  if (state.mapTimeline.time >= extent.end - 1e-6) {
    state.mapTimeline.time = extent.start;
  }
  state.mapTimeline.playing = true;
  state.mapTimelineLastTickMs = 0;

  const tick = (timestampMs) => {
    if (!state.mapTimeline.playing) {
      state.mapTimelinePlayFrame = 0;
      return;
    }

    if (!state.mapTimelineLastTickMs) {
      state.mapTimelineLastTickMs = timestampMs;
    }
    const dtSec = Math.max(0, (timestampMs - state.mapTimelineLastTickMs) / 1000);
    state.mapTimelineLastTickMs = timestampMs;

    const currExtent = state.mapTimeline.extent || getMapTimelineExtentFromSituation(state.shotBundle);
    const nextTime = state.mapTimeline.time + dtSec * MAP_TIMELINE_PLAY_SPEED_S;

    if (nextTime >= currExtent.end) {
      state.mapTimeline.time = currExtent.end;
      stopMapTimelinePlayback();
      syncMapTimelineControls();
      scheduleMapRender();
      return;
    }

    state.mapTimeline.time = nextTime;
    syncMapTimelineControls();
    scheduleMapRender();
    state.mapTimelinePlayFrame = requestAnimationFrame(tick);
  };

  syncMapTimelineControls();
  scheduleMapRender();
  state.mapTimelinePlayFrame = requestAnimationFrame(tick);
}

function toggleMapTimelinePlayback() {
  if (state.mapTimeline.playing) {
    stopMapTimelinePlayback();
    syncMapTimelineControls();
    return;
  }
  startMapTimelinePlayback();
}

function setMapTimelineMode(mode) {
  if (mode !== "full" && mode !== "time") {
    return;
  }
  if (mode === "full") {
    stopMapTimelinePlayback();
  }
  state.mapTimeline.mode = mode;
  syncMapTimelineControls();
  scheduleMapRender();
}

function setMapTimelineTime(timeValue) {
  const extent = state.mapTimeline.extent || getMapTimelineExtentFromSituation(state.shotBundle);
  state.mapTimeline.time = clamp(timeValue, extent.start, extent.end);
  syncMapTimelineControls();
  scheduleMapRender();
}

function clampIntervalToTimeRange(start, end, timeExtent) {
  const safeStart = clamp(start, timeExtent.start, timeExtent.end);
  const safeEnd = clamp(end, safeStart, timeExtent.end);
  return { start: safeStart, end: safeEnd };
}

function getRecommendedInterval() {
  const rec = state.selectedManifest?.recommended_default_interval_s;
  const timeExtent = getTimeExtentFromShotBundle(state.shotBundle);
  if (Array.isArray(rec) && rec.length >= 2 && Number.isFinite(rec[0]) && Number.isFinite(rec[1])) {
    return clampIntervalToTimeRange(rec[0], rec[1], timeExtent);
  }
  const defaults = state.selectedManifest?.viewer_defaults;
  const duration = defaults?.interval_duration_s;

  if (Number.isFinite(duration)) {
    return {
      start: timeExtent.start,
      end: Math.min(timeExtent.start + duration, timeExtent.end)
    };
  }

  const fallbackDuration = Math.min(30, Math.max(4, timeExtent.end - timeExtent.start));
  return {
    start: timeExtent.start,
    end: Math.min(timeExtent.start + fallbackDuration, timeExtent.end)
  };
}

function getCurrentInterval() {
  const timeExtent = getTimeExtentFromShotBundle(state.shotBundle);
  const rawStart = parseNumeric(el.startInput.value) ?? timeExtent.start;
  const rawEnd = parseNumeric(el.endInput.value) ?? Math.min(timeExtent.start + 30, timeExtent.end);
  return clampIntervalToTimeRange(rawStart, rawEnd, timeExtent);
}

function syncIntervalInputs(interval) {
  el.startInput.value = interval.start.toFixed(2);
  el.endInput.value = interval.end.toFixed(2);
}

function syncCursorToInterval() {
  const interval = getCurrentInterval();
  state.cursorTime = clamp(state.cursorTime, interval.start, interval.end);
}

function updateCurrentIntervalLabel() {
  const interval = getCurrentInterval();
  if (el.metaCurrentInterval) {
    el.metaCurrentInterval.textContent = `${formatSeconds(interval.start)} to ${formatSeconds(interval.end)}`;
  }
  updateMapShotSummary();
}

function getSelectedChannelSummary() {
  const sc = state.shotBundle?.selectedChannel;
  if (!sc?.available) {
    return {
      channel: "Unavailable",
      distance: "-",
      band: "-"
    };
  }

  const previewCol = Number(sc.activePreviewCol ?? sc.meta?.selected_preview_col ?? sc.manifestDemo?.preview_column ?? sc.manifestDemo?.default_preview_col);
  const entry = Number.isFinite(previewCol) ? sc.entryByCol?.[String(previewCol)] : null;
  const raw = Number(entry?.raw_das_channel_index ?? sc.meta?.selected_raw_channel ?? sc.manifestDemo?.raw_das_channel);
  const distance = Number(entry?.distance_m ?? sc.meta?.selected_distance_m);
  const parts = [];

  if (Number.isFinite(previewCol)) {
    parts.push(`preview ${previewCol}`);
  }
  if (Number.isFinite(raw)) {
    parts.push(`raw ${raw}`);
  }

  return {
    channel: parts.length ? parts.join(" / ") : (sc.meta?.selected_channel_label || "Loaded"),
    distance: Number.isFinite(distance) ? `${distance.toFixed(1)} m along cable` : "-",
    band: Array.isArray(sc.band?.bandHz) && Number.isFinite(sc.band.bandHz[0]) && Number.isFinite(sc.band.bandHz[1])
      ? `${sc.band.bandHz[0].toFixed(0)}-${sc.band.bandHz[1].toFixed(0)} Hz`
      : "-"
  };
}

function renderMapChannelChips(sc) {
  if (!el.mapChannelChipsWrap || !el.mapChannelChips) {
    return;
  }
  el.mapChannelChips.innerHTML = "";
  if (!sc?.available || !sc.multiChannel || !sc.entryByCol) {
    el.mapChannelChipsWrap.hidden = true;
    return;
  }

  const channels = Object.values(sc.entryByCol)
    .filter((entry) => Number.isFinite(Number(entry?.preview_col)))
    .sort((a, b) => Number(a.preview_col) - Number(b.preview_col));
  if (!channels.length) {
    el.mapChannelChipsWrap.hidden = true;
    return;
  }

  channels.forEach((entry) => {
    const previewCol = Number(entry.preview_col);
    const raw = Number(entry.raw_das_channel_index);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "map-channel-chip";
    chip.setAttribute("role", "listitem");
    chip.textContent = Number.isFinite(raw) ? `p${previewCol} / ${raw}` : `p${previewCol}`;
    if (Number(sc.activePreviewCol) === previewCol) {
      chip.classList.add("active");
    }
    chip.addEventListener("click", () => {
      void switchSelectedChannelToPreviewCol(previewCol);
    });
    el.mapChannelChips.appendChild(chip);
  });
  el.mapChannelChipsWrap.hidden = false;
}

function updateMapShotSummary() {
  if (!el.mapSummaryChannel || !el.mapSummaryDistance || !el.mapSummaryHint) {
    return;
  }

  const shotId = state.selectedManifest?.shot_id || state.selectedShotId || "-";
  const interval = getCurrentInterval();
  const sourceGt = getSourceGroundTruth();
  const selectedChannel = getSelectedChannelSummary();
  const sc = state.shotBundle?.selectedChannel;

if (el.mapSummaryShot) {
    el.mapSummaryShot.textContent = shotId;
  }
  if (el.mapSummaryEvents) {
    const intervalEventCount = getEventsForInterval(interval).length;
    const totalEventCount = getEventList().length;
    el.mapSummaryEvents.textContent = Number.isFinite(totalEventCount)
      ? `${intervalEventCount}/${totalEventCount} in interval`
      : "Events unknown";
  }
  if (el.mapSummaryInterval) {
    el.mapSummaryInterval.textContent = `${formatSeconds(interval.start)} - ${formatSeconds(interval.end)}`;
  }
  el.mapSummaryChannel.textContent = selectedChannel.channel;
  el.mapSummaryDistance.textContent = selectedChannel.distance;
  if (el.mapSummaryBand) {
    el.mapSummaryBand.textContent = selectedChannel.band;
  }
  if (el.mapSummarySource) {
    el.mapSummarySource.textContent = sourceGt.available ? "Source available" : "No source";
  }
  el.mapSummaryHint.textContent = sc?.available && sc.multiChannel
    ? "Choose an exported DAS channel."
    : "Selected-channel export is fixed for this shot.";
  renderMapChannelChips(sc);
}

function updateMapSnapshotPanel() {
  if (!el.mapSnapEvent) {
    return;
  }
  const source = getSourceGroundTruth();
  const tracks = state.shotBundle?.situation?.boat_tracks?.tracks || {};
  const recorders = state.shotBundle?.recordersSummary || {};
  const trackCount = Object.values(tracks).filter((pts) => Array.isArray(pts) && pts.length > 1).length;
  const recorderCount = Object.keys(recorders).length;
  const mapTime = state.mapTimeline.mode === "time"
    ? formatSeconds(Number(state.mapTimeline.time || 0))
    : "Full extent";

  el.mapSnapEvent.textContent = mapTime;
  el.mapSnapDepth.textContent = source.available && Number.isFinite(source.depth) ? `${source.depth.toFixed(1)} m` : "-";
  el.mapSnapSourceX.textContent = source.available && Number.isFinite(source.x) && Number.isFinite(source.y)
    ? `${source.x.toFixed(1)} / ${source.y.toFixed(1)}`
    : "-";
  el.mapSnapTracks.textContent = String(trackCount);
  el.mapSnapRecorders.textContent = String(recorderCount);
}

function updatePlaybackLabel() {
  el.playbackStatus.textContent = "";
}

function setPlayback(playing) {
  state.playing = playing;
  updatePlaybackLabel();
}

function getEventList() {
  const eventsPayload = state.shotBundle?.events;
  if (!eventsPayload) {
    return [];
  }
  if (Array.isArray(eventsPayload.events)) {
    return eventsPayload.events.map((event, idx) => ({
      event_id: event.event_id || `${state.selectedShotId || "event"}_${idx + 1}`,
      start_time_s: Number(event.start_time_s),
      end_time_s: Number(event.end_time_s),
      duration_s: Number(event.duration_s),
      score: Number(event.score)
    })).filter((event) => Number.isFinite(event.start_time_s) && Number.isFinite(event.end_time_s));
  }
  return [];
}

function getActiveEvent(cursorTime = state.cursorTime) {
  const events = getEventList();
  return events.find((event) => cursorTime >= event.start_time_s && cursorTime <= event.end_time_s) || null;
}

function renderActiveEventLabel() {
  const active = getActiveEvent();
  if (!el.metaActiveEvent) {
    return;
  }
  if (!active) {
    el.metaActiveEvent.textContent = "None";
    return;
  }
  el.metaActiveEvent.textContent = `${active.event_id} (${active.start_time_s.toFixed(2)}-${active.end_time_s.toFixed(2)} s)`;
}

function getSourceGroundTruth() {
  const manifestSource = state.selectedManifest?.source_ground_truth;
  if (manifestSource?.available) {
    const x = Number(
      manifestSource.position_xy_m?.[0] ??
      manifestSource.x
    );
    const y = Number(
      manifestSource.position_xy_m?.[1] ??
      manifestSource.y
    );
    const depth = Number(manifestSource.depth_m);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return {
        available: true,
        x,
        y,
        depth
      };
    }
  }

  const source = state.shotBundle?.shotMetadata?.source;
  const sourceX = Number(source?.pos_x_m);
  const sourceY = Number(source?.pos_y_m);
  if (source && Number.isFinite(sourceX) && Number.isFinite(sourceY)) {
    return {
      available: true,
      x: sourceX,
      y: sourceY,
      depth: Number(source.depth_m)
    };
  }

  return { available: false };
}

function renderManifestMetadata() {
  const shotId = state.selectedManifest?.shot_id || state.selectedShotId;
  const timeExtent = getTimeExtentFromShotBundle(state.shotBundle);
  const recommended = getRecommendedInterval();
  const sourceGt = getSourceGroundTruth();

  if (el.metaShot) el.metaShot.textContent = shotId || "-";
  if (el.metaTimeRange) el.metaTimeRange.textContent = `${formatSeconds(timeExtent.start)} to ${formatSeconds(timeExtent.end)}`;
  if (el.metaRecommended) el.metaRecommended.textContent = `${formatSeconds(recommended.start)} to ${formatSeconds(recommended.end)}`;
  if (el.metaEventCount) el.metaEventCount.textContent = Number.isFinite(state.eventCount) ? String(state.eventCount) : "Unknown";
  if (el.metaGroundTruth) el.metaGroundTruth.textContent = sourceGt.available ? "Available" : "Not available";
  renderActiveEventLabel();

  updateCurrentIntervalLabel();
}

function getCanvasSize(canvas, fallbackHeight) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.floor(canvas.clientWidth || 0));
  const height = Math.max(180, Math.floor(canvas.clientHeight || fallbackHeight));
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width, height };
}

function colorForDas(value) {
  const v = Math.pow(clamp(Number(value) || 0, 0, 1), 0.68);
  const stops = [
    [6, 12, 24],
    [0, 96, 255],
    [0, 214, 255],
    [76, 255, 184],
    [255, 224, 96],
    [255, 84, 210]
  ];
  const scaled = v * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const a = stops[idx];
  const b = stops[idx + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * frac);
  const g = Math.round(a[1] + (b[1] - a[1]) * frac);
  const bch = Math.round(a[2] + (b[2] - a[2]) * frac);
  return `rgb(${r}, ${g}, ${bch})`;
}

function syncDasModeControls() {
  const mode = "waterfall";
  state.dasViewMode = "waterfall";
  if (el.dasHeading) {
    el.dasHeading.textContent = `DAS Waterfall — ${shotSpeciesLabel()}`;
  }
  if (el.dasModeActivity) {
    el.dasModeActivity.classList.toggle("active", mode === "activity");
    el.dasModeActivity.setAttribute("aria-pressed", mode === "activity" ? "true" : "false");
  }
  if (el.dasModeWaterfall) {
    el.dasModeWaterfall.classList.toggle("active", mode === "waterfall");
    el.dasModeWaterfall.setAttribute("aria-pressed", mode === "waterfall" ? "true" : "false");
  }
}

function setDasViewMode(mode) {
  state.dasViewMode = mode === "waterfall" ? "waterfall" : "activity";
  renderDasPanel();
}

function renderDasPanel() {
  syncDasModeControls();
  if (state.dasViewMode === "waterfall") {
    if (!state.shotBundle?.dasWaterfall) {
      renderDasStatusMessage("Loading DAS waterfall preview...", "Loading raw DAS waterfall preview...");
      ensureDasWaterfallLoaded();
      return;
    }
    renderDasWaterfallPanel();
    return;
  }
  renderDasActivityPanel();
}

function getWaterfallValue(wf, timeIndex, channelIndex) {
  const [a, b] = wf.shape;
  if (wf.orientation === "time_channel") {
    return wf.fortran
      ? wf.data[channelIndex * a + timeIndex]
      : wf.data[timeIndex * b + channelIndex];
  }
  return wf.fortran
    ? wf.data[timeIndex * a + channelIndex]
    : wf.data[channelIndex * b + timeIndex];
}

const DAS_WATERFALL_PALETTE_NAME = "darkSeismic";
const DAS_WATERFALL_PALETTES = {
  darkSeismic: {
    stops: [
      [-1.0, [0, 188, 255]],
      [-0.68, [0, 125, 255]],
      [-0.32, [10, 60, 180]],
      [-0.14, [35, 15, 70]],
      [0.0, [35, 15, 70]],
      [0.14, [35, 15, 70]],
      [0.34, [255, 0, 60]],
      [0.70, [255, 80, 40]],
      [1.0, [255, 200, 180]]
    ]
  },
  deepOceanCoral: {
    mode: "magnitude",
    stops: [
      [0.0, [4, 17, 31]],
      [0.2, [11, 38, 56]],
      [0.4, [21, 94, 117]],
      [0.6, [45, 212, 191]],
      [0.82, [251, 113, 133]],
      [1.0, [255, 228, 230]]
    ]
  },
  coralDepth: {
    mode: "magnitude",
    stops: [
      [0.0, [4, 17, 31]],
      [0.18, [18, 50, 74]],
      [0.38, [64, 56, 92]],
      [0.58, [151, 73, 92]],
      [0.78, [238, 119, 94]],
      [1.0, [255, 232, 214]]
    ]
  },
  oceanViolet: {
    mode: "magnitude",
    stops: [
      [0.0, [4, 17, 31]],
      [0.22, [18, 50, 74]],
      [0.45, [30, 91, 137]],
      [0.68, [139, 92, 246]],
      [0.86, [216, 180, 254]],
      [1.0, [245, 239, 255]]
    ]
  },
  oceanEmission: {
    mode: "magnitude",
    stops: [
      [0.0, [5, 11, 20]],
      [0.2, [10, 29, 51]],
      [0.4, [18, 78, 120]],
      [0.6, [31, 163, 201]],
      [0.8, [99, 230, 255]],
      [1.0, [178, 107, 255]]
    ]
  },
  magmaEnergy: {
    mode: "magnitude",
    stops: [
      [0.0, [2, 4, 20]],
      [0.18, [31, 12, 72]],
      [0.38, [91, 25, 103]],
      [0.58, [181, 54, 84]],
      [0.78, [251, 135, 60]],
      [1.0, [252, 253, 191]]
    ]
  },
  activityNeon: {
    stops: [
      [-1.0, [2, 10, 30]],
      [-0.62, [0, 77, 220]],
      [-0.25, [0, 221, 255]],
      [0.0, [108, 255, 230]],
      [0.22, [156, 255, 87]],
      [0.55, [255, 230, 109]],
      [1.0, [255, 79, 216]]
    ]
  },
  siteGlow: {
    negative: [35, 122, 236],
    zero: [216, 232, 255],
    positive: [255, 79, 216]
  },
  darkRelief: {
    negative: [17, 80, 184],
    zero: [190, 246, 255],
    positive: [255, 132, 86]
  },
  midnightRelief: {
    stops: [
      [-1.0, [4, 16, 44]],
      [-0.62, [14, 94, 214]],
      [-0.28, [54, 218, 255]],
      [0.0, [9, 22, 42]],
      [0.30, [255, 198, 92]],
      [0.68, [255, 111, 127]],
      [1.0, [255, 79, 216]]
    ]
  },
  teacherPlum: {
    negative: [34, 74, 196],
    zero: [75, 28, 104],
    positive: [218, 58, 70]
  },
  lakeFire: {
    stops: [
      [-1.0, [7, 38, 99]],
      [-0.62, [20, 112, 204]],
      [-0.28, [101, 232, 255]],
      [0.0, [8, 15, 31]],
      [0.28, [255, 194, 88]],
      [0.62, [255, 111, 91]],
      [1.0, [255, 77, 136]]
    ]
  },
  teacherClean: {
    negative: [34, 74, 196],
    zero: [229, 247, 255],
    positive: [218, 58, 70]
  },
  teacherCoral: {
    negative: [34, 74, 196],
    zero: [232, 221, 246],
    positive: [255, 88, 124]
  }
};

function getDasWaterfallPalette() {
  return DAS_WATERFALL_PALETTES[DAS_WATERFALL_PALETTE_NAME] || DAS_WATERFALL_PALETTES.teacherCoral;
}

function colorForDasWaterfall(value, limit) {
  if (!Number.isFinite(value) || !Number.isFinite(limit) || limit <= 0) {
    return [12, 20, 36, 255];
  }
  const palette = getDasWaterfallPalette();
  const signedX = clamp(value / limit, -1, 1);
  const x = palette.mode === "magnitude" ? Math.abs(signedX) : signedX;
  if (Array.isArray(palette.stops)) {
    const stops = palette.stops;
    for (let i = 0; i < stops.length - 1; i += 1) {
      const [x0, c0] = stops[i];
      const [x1, c1] = stops[i + 1];
      if (x >= x0 && x <= x1) {
        const f = (x - x0) / Math.max(1e-9, x1 - x0);
        return [
          Math.round(c0[0] + (c1[0] - c0[0]) * f),
          Math.round(c0[1] + (c1[1] - c0[1]) * f),
          Math.round(c0[2] + (c1[2] - c0[2]) * f),
          255
        ];
      }
    }
    const c = x < 0 ? stops[0][1] : stops[stops.length - 1][1];
    return [c[0], c[1], c[2], 255];
  }
  if (x < 0) {
    const f = x + 1;
    const a = palette.negative;
    const b = palette.zero;
    return [
      Math.round(a[0] + (b[0] - a[0]) * f),
      Math.round(a[1] + (b[1] - a[1]) * f),
      Math.round(a[2] + (b[2] - a[2]) * f),
      255
    ];
  }
  const f = x;
  const a = palette.zero;
  const b = palette.positive;
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
    255
  ];
}

function formatWaterfallAxisNumber(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return Math.abs(value) >= 1000 ? String(Math.round(value)) : Number(value).toFixed(0);
}

function roundWaterfallLimit(value, wf) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  const step = wf?.sourceKey === "data" ? 50 : 0.25;
  return Math.max(step, Math.ceil(value / step) * step);
}

function buildWaterfallColorLookup(limit) {
  const lim = Math.max(1, Math.round(limit));
  const lookup = new Array(lim * 2 + 1);
  for (let v = -lim; v <= lim; v += 1) {
    lookup[v + lim] = colorForDasWaterfall(v, lim);
  }
  return { lim, lookup };
}

function lookupWaterfallColor(value, colorLookup) {
  const v = Math.round(clamp(Number(value) || 0, -colorLookup.lim, colorLookup.lim));
  return colorLookup.lookup[v + colorLookup.lim];
}

function drawDasEventShading(ctx, pad, plotW, plotH, interval) {
  const events = getEventList();
  ctx.save();
  for (const ev of events) {
    if (ev.end_time_s < interval.start || ev.start_time_s > interval.end) {
      continue;
    }
    const x0 = pad.left + ((Math.max(ev.start_time_s, interval.start) - interval.start) / Math.max(1e-9, interval.end - interval.start)) * plotW;
    const x1 = pad.left + ((Math.min(ev.end_time_s, interval.end) - interval.start) / Math.max(1e-9, interval.end - interval.start)) * plotW;
    ctx.fillStyle = "rgba(255, 230, 109, 0.10)";
    ctx.fillRect(x0, pad.top, Math.max(1, x1 - x0), plotH);
  }
  ctx.restore();
}

function shotSpeciesLabel() {
  if (state.selectedShotId === "whales_orca") return "Orca";
  if (state.selectedShotId === "whales_humpback") return "Humpback";
  return state.selectedShotId || "Shot";
}

function renderDasWaterfallPanel() {
  const { ctx, width, height } = getCanvasSize(el.dasCanvas, 404);
  ctx.clearRect(0, 0, width, height);

  const wf = state.shotBundle?.dasWaterfall;
  const interval = getCurrentInterval();

  ctx.fillStyle = "rgba(8, 15, 31, 0.88)";
  ctx.fillRect(0, 0, width, height);

  if (!wf?.data || !Array.isArray(wf.axes?.t_s) || !Array.isArray(wf.axes?.channel_indices)) {
    ctx.fillStyle = "#9fb3d9";
    ctx.font = "14px Space Grotesk";
    ctx.fillText("Waterfall preview not available. Run backend export.", 20, 34);
    el.dasCaption.textContent = "Waterfall preview not available. Run backend export.";
    state.geometry.das = null;
    return;
  }

  const t = wf.axes.t_s;
  const channels = wf.axes.channel_indices;
  const sampleIndices = Array.isArray(wf.axes.sample_indices) ? wf.axes.sample_indices : null;
  const pad = { left: 62, right: 104, top: 12, bottom: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const viewInterval = { start: t[0], end: t[t.length - 1] };
  const i0 = 0;
  const i1 = t.length - 1;

  if (i1 < i0) {
    ctx.fillStyle = "#9fb3d9";
    ctx.font = "14px Space Grotesk";
    ctx.fillText("Selected interval has no DAS waterfall samples.", 20, 34);
    el.dasCaption.textContent = `No DAS waterfall samples in ${interval.start.toFixed(2)}-${interval.end.toFixed(2)} s.`;
    state.geometry.das = null;
    return;
  }

  const nRows = channels.length;
  const nRawCols = i1 - i0 + 1;
  const renderCols = Math.max(1, Math.min(Math.floor(plotW), nRawCols));
  const renderRows = Math.max(1, Math.min(Math.floor(plotH), nRows));
  const timeIndices = [];
  for (let col = 0; col < renderCols; col += 1) {
    const idx = i0 + Math.floor((col / Math.max(1, renderCols - 1)) * (nRawCols - 1));
    timeIndices.push(idx);
  }

  const renderKey = `${wf.sourceKey}|${wf.shape.join("x")}|${renderCols}x${renderRows}|${DAS_WATERFALL_PALETTE_NAME}`;
  let limit;
  let offscreen;
  if (wf.renderCache?.key === renderKey) {
    limit = wf.renderCache.limit;
    offscreen = wf.renderCache.offscreen;
    wf.colorScale = wf.renderCache.colorScale;
  } else {
    const samples = [];
    const rowStep = Math.max(1, Math.floor(nRows / 160));
    const sampleColStep = Math.max(1, Math.floor(renderCols / 700));
    for (let c = 0; c < renderCols; c += sampleColStep) {
      for (let row = 0; row < nRows; row += rowStep) {
        const v = getWaterfallValue(wf, timeIndices[Math.min(c, timeIndices.length - 1)], row);
        if (Number.isFinite(v)) samples.push(v);
      }
    }
    samples.sort((a, b) => a - b);
    const pLow = wf.sourceKey === "data" ? 0.10 : 0.05;
    const pHigh = wf.sourceKey === "data" ? 0.90 : 0.95;
    const qLo = quantileFromSorted(samples, pLow);
    const qHi = quantileFromSorted(samples, pHigh);
    limit = roundWaterfallLimit(Math.max(Math.abs(qLo || 0), Math.abs(qHi || 0), 1e-6), wf);
    const colorScale = { mode: "symmetric_percentile", pLow: pLow * 100, pHigh: pHigh * 100, vmin: -limit, vmax: limit };
    wf.colorScale = colorScale;
    console.info(`[das-waterfall] color scale p${String(Math.round(pLow * 100)).padStart(2, "0")}=${Number(qLo).toFixed(4)} p${Math.round(pHigh * 100)}=${Number(qHi).toFixed(4)} clip=±${limit.toFixed(4)}`);

    const colorLookup = buildWaterfallColorLookup(limit);
    const image = ctx.createImageData(renderCols, renderRows);
    for (let pxRow = 0; pxRow < renderRows; pxRow += 1) {
      const row0 = Math.floor((pxRow / renderRows) * nRows);
      const row1 = Math.max(row0 + 1, Math.floor(((pxRow + 1) / renderRows) * nRows));
      for (let pxCol = 0; pxCol < renderCols; pxCol += 1) {
        const t0 = i0 + Math.floor((pxCol / renderCols) * nRawCols);
        const t1 = Math.max(t0 + 1, i0 + Math.floor(((pxCol + 1) / renderCols) * nRawCols));
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;
        let count = 0;
        for (let ti = t0; ti < t1; ti += 1) {
          for (let row = row0; row < row1; row += 1) {
            const rgba = lookupWaterfallColor(getWaterfallValue(wf, ti, row), colorLookup);
            rSum += rgba[0];
            gSum += rgba[1];
            bSum += rgba[2];
            count += 1;
          }
        }
        const off = (pxRow * renderCols + pxCol) * 4;
        const denom = Math.max(1, count);
        image.data[off] = Math.round(rSum / denom);
        image.data[off + 1] = Math.round(gSum / denom);
        image.data[off + 2] = Math.round(bSum / denom);
        image.data[off + 3] = 255;
      }
    }

    offscreen = document.createElement("canvas");
    offscreen.width = renderCols;
    offscreen.height = renderRows;
    offscreen.getContext("2d").putImageData(image, 0, 0);
    wf.renderCache = { key: renderKey, limit, offscreen, colorScale };
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(offscreen, pad.left, pad.top, plotW, plotH);
  drawDasEventShading(ctx, pad, plotW, plotH, viewInterval);

  const selected = getSelectedChannelSummary();
  const rawMatch = String(selected.channel || "").match(/raw\s+(-?\d+)/);
  const selectedRaw = rawMatch ? Number(rawMatch[1]) : null;
  const selectedRow = Number.isFinite(selectedRaw) ? channels.findIndex((v) => Number(v) === selectedRaw) : -1;
  if (selectedRow >= 0) {
    const y = pad.top + (selectedRow + 0.5) / nRows * plotH;
    ctx.strokeStyle = "rgba(255, 230, 109, 0.92)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
  }

  if (state.cursorTime >= viewInterval.start && state.cursorTime <= viewInterval.end) {
    const cursorNorm = (state.cursorTime - viewInterval.start) / Math.max(0.0001, viewInterval.end - viewInterval.start);
    const cursorX = pad.left + clamp(cursorNorm, 0, 1) * plotW;
    ctx.strokeStyle = "rgba(255, 230, 109, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorX, pad.top);
    ctx.lineTo(cursorX, pad.top + plotH);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(114, 246, 255, 0.35)";
  ctx.strokeRect(pad.left, pad.top, plotW, plotH);

  const barX = pad.left + plotW + 22;
  const barW = 12;
  const barH = Math.min(180, plotH);
  const barY = pad.top + (plotH - barH) / 2;
  const grad = ctx.createLinearGradient(0, barY + barH, 0, barY);
  const palette = getDasWaterfallPalette();
  if (Array.isArray(palette.stops) && palette.mode === "magnitude") {
    for (const [pos, c] of palette.stops) {
      grad.addColorStop(pos, `rgb(${c[0]}, ${c[1]}, ${c[2]})`);
    }
  } else if (Array.isArray(palette.stops)) {
    for (const [pos, c] of palette.stops) {
      grad.addColorStop((pos + 1) / 2, `rgb(${c[0]}, ${c[1]}, ${c[2]})`);
    }
  } else {
    grad.addColorStop(0, `rgb(${palette.negative[0]}, ${palette.negative[1]}, ${palette.negative[2]})`);
    grad.addColorStop(0.5, `rgb(${palette.zero[0]}, ${palette.zero[1]}, ${palette.zero[2]})`);
    grad.addColorStop(1, `rgb(${palette.positive[0]}, ${palette.positive[1]}, ${palette.positive[2]})`);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(barX, barY, barW, barH);
  ctx.strokeStyle = "rgba(212, 227, 255, 0.55)";
  ctx.strokeRect(barX, barY, barW, barH);

  ctx.fillStyle = "#d4e3ff";
  ctx.font = "11px Space Grotesk";
  const sampleOrigin = sampleIndices ? Number(sampleIndices[timeIndices[0]]) : null;
  const axisStart = sampleIndices ? 0 : interval.start;
  const axisEnd = sampleIndices
    ? Number(sampleIndices[timeIndices[timeIndices.length - 1]]) - sampleOrigin
    : interval.end;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  let xTicks = [];
  if (sampleIndices && axisEnd >= 10000) {
    const step = axisEnd >= 25000 ? 5000 : 2500;
    for (let v = 0; v <= axisEnd; v += step) {
      xTicks.push(v);
    }
  } else {
    const xTickCount = 5;
    for (let k = 0; k < xTickCount; k += 1) {
      const frac = xTickCount === 1 ? 0 : k / (xTickCount - 1);
      xTicks.push(axisStart + (axisEnd - axisStart) * frac);
    }
  }
  for (const v of xTicks) {
    const frac = (v - axisStart) / Math.max(1e-9, axisEnd - axisStart);
    const x = pad.left + clamp(frac, 0, 1) * plotW;
    ctx.fillText(formatWaterfallAxisNumber(v), x, pad.top + plotH + 8);
  }
  ctx.fillText(sampleIndices ? "Time Sample Index" : "Time (s)", pad.left + plotW / 2, height - 14);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const barTicks = palette.mode === "magnitude"
    ? [0, limit / 4, limit / 2, (3 * limit) / 4, limit]
    : [-limit, -limit / 2, 0, limit / 2, limit];
  ctx.font = "10px Space Grotesk";
  for (const tick of barTicks) {
    const y = palette.mode === "magnitude"
      ? barY + (1 - tick / Math.max(1e-9, limit)) * barH
      : barY + (1 - (tick + limit) / (2 * limit)) * barH;
    ctx.strokeStyle = "rgba(212, 227, 255, 0.72)";
    ctx.beginPath();
    ctx.moveTo(barX + barW, y);
    ctx.lineTo(barX + barW + 5, y);
    ctx.stroke();
    const prefix = palette.mode !== "magnitude" && tick > 0 ? "+" : "";
    ctx.fillText(`${prefix}${formatWaterfallAxisNumber(tick)}`, barX + barW + 9, y + 3);
  }
  ctx.save();
  ctx.translate(barX + barW + 46, barY + barH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("Amplitude", 0, 0);
  ctx.restore();

  ctx.font = "11px Space Grotesk";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const yTicks = [0, 200, 400, 600, 800, channels[channels.length - 1]].filter((v, idx, arr) => arr.indexOf(v) === idx);
  for (const tick of yTicks) {
    const rowIdx = channels.findIndex((v) => Number(v) >= tick);
    const idx = rowIdx >= 0 ? rowIdx : channels.length - 1;
    const y = pad.top + (idx / Math.max(1, nRows - 1)) * plotH;
    ctx.fillText(String(tick), pad.left - 10, y);
  }
  ctx.save();
  ctx.translate(22, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("Channel Index", 0, 0);
  ctx.restore();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  state.geometry.das = {
    mode: "waterfall",
    t,
    distances: wf.axes.distances_m || channels,
    channels,
    matrix: null,
    waterfall: wf,
    timeIndices,
    sampleIndices,
    sampleOrigin,
    interval: viewInterval,
    pad,
    plotW,
    plotH,
    width,
    height,
    colorLimit: limit
  };
  el.dasCaption.textContent =
    `Overview of ${nRows} DAS channels for ${shotSpeciesLabel()} from ${viewInterval.start.toFixed(2)}-${viewInterval.end.toFixed(2)} s. ` +
    "Brighter colors mark stronger changes in the fiber signal; use this panel for context, then inspect or listen to one channel in Selected DAS Channel.";
}

function renderDasActivityPanel() {
  const { ctx, width, height } = getCanvasSize(el.dasCanvas, 404);
  ctx.clearRect(0, 0, width, height);

  const das = state.shotBundle?.dasActivity;
  const t = das?.axes?.t_s;
  const distances = das?.axes?.distances_m;
  const matrix = das?.activity_01;
  const interval = getCurrentInterval();

  ctx.fillStyle = "rgba(8, 15, 31, 0.88)";
  ctx.fillRect(0, 0, width, height);

  if (!Array.isArray(t) || !Array.isArray(distances) || !Array.isArray(matrix) || matrix.length === 0) {
    ctx.fillStyle = "#9fb3d9";
    ctx.font = "14px Space Grotesk";
    ctx.fillText("DAS activity map is unavailable for this shot (metadata-only mode).", 20, 34);
    el.dasCaption.textContent = `Interval ${interval.start.toFixed(2)}-${interval.end.toFixed(2)} s is synchronized; DAS heatmap unavailable for current shot bundle.`;
    return;
  }

  const pad = { left: 24, right: 8, top: 6, bottom: 12 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const selectedIndices = [];
  for (let i = 0; i < t.length; i += 1) {
    if (t[i] >= interval.start && t[i] <= interval.end) {
      selectedIndices.push(i);
    }
  }

  if (selectedIndices.length === 0) {
    ctx.fillStyle = "#9fb3d9";
    ctx.font = "14px Space Grotesk";
    ctx.fillText("Selected interval has no DAS samples.", 20, 34);
    el.dasCaption.textContent = `No DAS bins in ${interval.start.toFixed(2)}-${interval.end.toFixed(2)} s.`;
    return;
  }

  const maxCols = Math.max(140, Math.min(520, Math.floor(plotW * 1.3)));
  const colStep = Math.max(1, Math.floor(selectedIndices.length / maxCols));
  const timeIndices = [];
  for (let c = 0; c < selectedIndices.length; c += colStep) {
    timeIndices.push(selectedIndices[c]);
  }
  const nRows = distances.length;
  const nCols = timeIndices.length;
  const cellW = plotW / Math.max(1, nCols);
  const cellH = plotH / Math.max(1, nRows);

  state.geometry.das = { mode: "activity", t, distances, matrix, timeIndices, interval, pad, plotW, plotH, width, height };

  for (let row = 0; row < nRows; row += 1) {
    for (let col = 0; col < nCols; col += 1) {
      const timeIndex = timeIndices[col];
      const rowData = matrix[timeIndex];
      if (!Array.isArray(rowData)) {
        continue;
      }
      const value = rowData[row] || 0;
      ctx.fillStyle = colorForDas(value);
      ctx.fillRect(
        pad.left + col * cellW,
        pad.top + (nRows - row - 1) * cellH,
        Math.ceil(cellW) + 1,
        Math.ceil(cellH) + 1
      );
    }
  }

  const cursorNorm = (state.cursorTime - interval.start) / Math.max(0.0001, interval.end - interval.start);
  const cursorX = pad.left + clamp(cursorNorm, 0, 1) * plotW;

  ctx.strokeStyle = "rgba(114, 246, 255, 0.35)";
  ctx.strokeRect(pad.left, pad.top, plotW, plotH);
  ctx.strokeStyle = "rgba(255, 230, 109, 0.95)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cursorX, pad.top);
  ctx.lineTo(cursorX, pad.top + plotH);
  ctx.stroke();

  ctx.fillStyle = "#d4e3ff";
  ctx.font = "11px Space Grotesk";
  ctx.fillText(`${interval.start.toFixed(2)} s`, pad.left, height - 4);
  ctx.fillText(`${interval.end.toFixed(2)} s`, pad.left + plotW - 54, height - 4);
  ctx.save();
  ctx.translate(10, pad.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Fiber distance", 0, 0);
  ctx.restore();
  ctx.fillText("Time", pad.left + plotW / 2 - 10, height - 4);

  el.dasCaption.textContent = `DAS synchronized interval: ${interval.start.toFixed(2)}-${interval.end.toFixed(2)} s, cursor ${state.cursorTime.toFixed(2)} s, ${nRows} channels.`;
}

function renderHydroPanel() {
  const hydro = state.shotBundle?.hydroActivity;
  const width = Math.max(640, Math.floor(el.hydroSvg.clientWidth || 1200));
  const height = Math.max(220, Math.floor(el.hydroSvg.clientHeight || 300));
  el.hydroSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  el.hydroSvg.setAttribute("preserveAspectRatio", "none");

  if (!Array.isArray(hydro?.t_s) || !Array.isArray(hydro?.score_db) || hydro.t_s.length < 2) {
    const selectedRange = getSelectedChannelFullTimeRange(state.shotBundle?.selectedChannel);
    const fallbackExtent = getTimeExtentFromShotBundle(state.shotBundle);
    const timeExtent = {
      start: Number.isFinite(selectedRange.start) ? selectedRange.start : fallbackExtent.start,
      end: Number.isFinite(selectedRange.end) ? selectedRange.end : fallbackExtent.end
    };
    const padL = 80;
    const plotW = width - 120;
    const plotY = 70;
    const plotH = Math.max(90, height - 160);

    el.hydroSvg.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" fill="rgba(8,15,31,0.86)"></rect>
      <rect x="${padL}" y="${plotY}" width="${plotW}" height="${plotH}" fill="rgba(8,15,31,0.55)" stroke="rgba(114,246,255,0.25)"></rect>
      <text x="92" y="52" fill="#9fb3d9" font-size="14">Hydrophone reference is unavailable.</text>
      <text x="90" y="${Math.max(0, height - 22)}" fill="#9fb3d9" font-size="13">${timeExtent.start.toFixed(2)} s</text>
      <text x="${Math.max(90, width - 90)}" y="${Math.max(0, height - 22)}" fill="#9fb3d9" font-size="13">${timeExtent.end.toFixed(2)} s</text>
    `;

    el.hydroCaption.textContent = "Hydrophone reference is unavailable for this shot.";
    return;
  }

  const t = hydro.t_s;
  const y = hydro.score_db;
  const threshold = Number(hydro?.normalization?.threshold_db);
  const hydroStart = t[0];
  const hydroEnd = t[t.length - 1];
  const selectedRange = getSelectedChannelFullTimeRange(state.shotBundle?.selectedChannel);
  const timeStart = Math.max(hydroStart, Number.isFinite(selectedRange.start) ? selectedRange.start : hydroStart);
  const timeEnd = Math.min(hydroEnd, Number.isFinite(selectedRange.end) ? selectedRange.end : hydroEnd);
  const i0 = clamp(lowerBoundSorted(t, timeStart), 0, t.length - 1);
  const i1 = clamp(upperBoundSorted(t, timeEnd) - 1, i0, t.length - 1);
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = i0; i <= i1; i += 1) {
    const v = y[i];
    if (!Number.isFinite(v)) continue;
    yMin = Math.min(yMin, v);
    yMax = Math.max(yMax, v);
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = Math.min(...y);
    yMax = Math.max(...y);
  }
  yMin -= 0.8;
  yMax += 0.8;

  const pad = { l: 72, r: 24, t: 18, b: 34 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;

  const xScale = (x) => pad.l + ((x - timeStart) / Math.max(0.001, timeEnd - timeStart)) * plotW;
  const yScale = (v) => pad.t + (1 - (v - yMin) / Math.max(0.001, yMax - yMin)) * plotH;

  state.geometry.hydro = { t, y, threshold, timeStart, timeEnd, yMin, yMax, pad, plotW, plotH, xScale, yScale };

  const pathParts = [];
  for (let i = i0; i <= i1; i += 1) {
    const marker = i === i0 ? "M" : "L";
    pathParts.push(`${marker}${xScale(t[i]).toFixed(2)},${yScale(y[i]).toFixed(2)}`);
  }
  const path = pathParts.join(" ");

  const thresholdLine = Number.isFinite(threshold)
    ? `<line x1="${pad.l}" y1="${yScale(threshold).toFixed(2)}" x2="${width - pad.r}" y2="${yScale(threshold).toFixed(2)}" stroke="rgba(255,107,135,0.85)" stroke-dasharray="6 5" stroke-width="1.8"></line>`
    : "";

  el.hydroSvg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="rgba(8,15,31,0.88)"></rect>
    <rect x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}" fill="rgba(8,15,31,0.52)" stroke="rgba(114,246,255,0.2)"></rect>
    ${thresholdLine}
    <path d="${path}" fill="none" stroke="rgba(114,246,255,0.28)" stroke-width="6"></path>
    <path d="${path}" fill="none" stroke="#72f6ff" stroke-width="2.75"></path>
    <line x1="${pad.l}" y1="${pad.t + plotH}" x2="${width - pad.r}" y2="${pad.t + plotH}" stroke="rgba(159,179,217,0.7)" stroke-width="1"></line>
    <text x="${pad.l}" y="${height - 10}" fill="#9fb3d9" font-size="13">${timeStart.toFixed(2)} s</text>
    <text x="${width - pad.r - 62}" y="${height - 10}" fill="#9fb3d9" font-size="13">${timeEnd.toFixed(2)} s</text>
    <text x="16" y="${pad.t + 14}" fill="#9fb3d9" font-size="13">dB</text>
  `;

  el.hydroCaption.textContent = `Reference activity from the hydrophone/source recording, shown in the same time window as the selected DAS channel (${timeStart.toFixed(2)}-${timeEnd.toFixed(2)} s). Play DAS uses the selected fiber channel, not this graph.`;
}

function buildSituationPoints(recorders, sourcePoint, xScale, yScale) {
  const parts = [];
  recorders.forEach((rec) => {
    const cx = xScale(rec.x);
    const cy = yScale(rec.y);
    parts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="10.5" fill="rgba(114,246,255,0.2)"></circle>`);
    parts.push(`<circle class="map-interactive-point map-point-recorder" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="5.7" fill="#72f6ff" stroke="rgba(226,236,255,0.86)" stroke-width="1.3" data-tooltip-title="Recorder Station" data-tooltip-body="Type: Recorder station<br>Name: ${rec.name}<br>Coordinates (E, N): ${rec.x.toFixed(1)} m, ${rec.y.toFixed(1)} m"></circle>`);
  });

  if (sourcePoint) {
    const cx = xScale(sourcePoint.x);
    const cy = yScale(sourcePoint.y);
    const sourceName = state.selectedShotId === "whales_orca"
      ? "Orca"
      : (state.selectedShotId === "whales_humpback" ? "Humpback" : "Source");
    const diamond = [
      `${cx.toFixed(2)},${(cy - 8).toFixed(2)}`,
      `${(cx + 8).toFixed(2)},${cy.toFixed(2)}`,
      `${cx.toFixed(2)},${(cy + 8).toFixed(2)}`,
      `${(cx - 8).toFixed(2)},${cy.toFixed(2)}`
    ].join(" ");
    parts.push(`<circle class="map-point-source-glow" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="12.2" fill="rgba(255,122,89,0.18)"></circle>`);
    parts.push(`<polygon class="map-interactive-point map-point-source" points="${diamond}" fill="#ff7a59" stroke="rgba(255,244,224,0.96)" stroke-width="1.7" data-tooltip-title="${sourceName} source" data-tooltip-body="Type: acoustic playback source<br>Label: ${sourceName}<br>Coordinates (E, N): ${sourcePoint.x.toFixed(1)} m, ${sourcePoint.y.toFixed(1)} m${Number.isFinite(sourcePoint.depth) ? `<br>Depth: ${sourcePoint.depth.toFixed(1)} m` : ""}"></polygon>`);
    parts.push(`<text class="map-point-source-label" x="${(cx + 14).toFixed(2)}" y="${(cy - 6).toFixed(2)}" fill="#ffd9c6" font-size="11" font-family="sans-serif">${sourceName}</text>`);
  }

  return parts.join("");
}

function buildMapTimeOverlays(tracks, xScale, yScale, mapTime) {
  const parts = [];
  let k = 0;
  for (const [trackName, item] of Object.entries(tracks || {})) {
    const seqs = Array.isArray(item) ? [item] : Object.values(item || {}).filter(Array.isArray);
    for (const seq of seqs.slice(0, 1)) {
      if (!seq || seq.length < 2) continue;
      const finiteSeq = seq.filter((pt) => Number.isFinite(pt?.x) && Number.isFinite(pt?.y));
      const visible = finiteSeq.filter((pt) => Number.isFinite(pt?.t) && pt.t <= mapTime);
      const color = TRACK_PALETTE[k % TRACK_PALETTE.length];
      k += 1;
      const currentPoint = visible.length ? visible[visible.length - 1] : finiteSeq[0];
      if (!currentPoint || !Number.isFinite(currentPoint.x) || !Number.isFinite(currentPoint.y)) {
        continue;
      }
      const x = xScale(currentPoint.x);
      const y = yScale(currentPoint.y);
      parts.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="14" fill="${color}" opacity="0.24"></circle>`);
      parts.push(`<circle class="map-interactive-point map-point-boatcue" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="5.2" fill="${color}" opacity="0.72" stroke="rgba(226,236,255,0.7)" stroke-width="1.1" data-tooltip-title="Boat Position Cue" data-tooltip-body="Type: Independent track marker<br>Track: ${trackName}<br>Coordinates (E, N): ${currentPoint.x.toFixed(1)} m, ${currentPoint.y.toFixed(1)} m${Number.isFinite(currentPoint.t) ? `<br>Map time: ${currentPoint.t.toFixed(2)} s` : ""}"></circle>`);
    }
  }

  return parts.join("");
}

function buildTrackPointMarkers(tracks, xScale, yScale) {
  const parts = [];
  let trackIndex = 0;

  for (const [trackName, item] of Object.entries(tracks || {})) {
    const seqs = Array.isArray(item) ? [item] : Object.values(item || {}).filter(Array.isArray);
    for (const seq of seqs.slice(0, 1)) {
      const finiteSeq = seq.filter((pt) => Number.isFinite(pt?.x) && Number.isFinite(pt?.y));
      if (finiteSeq.length < 2) {
        continue;
      }

      const color = TRACK_PALETTE[trackIndex % TRACK_PALETTE.length];
      trackIndex += 1;
      const endPoint = finiteSeq[finiteSeq.length - 1];
      if (!endPoint || !Number.isFinite(endPoint.x) || !Number.isFinite(endPoint.y)) {
        continue;
      }

      parts.push(`<circle cx="${xScale(endPoint.x).toFixed(2)}" cy="${yScale(endPoint.y).toFixed(2)}" r="11" fill="${color}" opacity="0.12"></circle>`);
      parts.push(`<circle class="map-interactive-point map-point-boatcue" cx="${xScale(endPoint.x).toFixed(2)}" cy="${yScale(endPoint.y).toFixed(2)}" r="5.2" fill="${color}" opacity="0.68" stroke="rgba(226,236,255,0.68)" stroke-width="1.1" data-tooltip-title="Final Boat Position" data-tooltip-body="Type: End position<br>Track: ${trackName}<br>Coordinates (E, N): ${endPoint.x.toFixed(1)} m, ${endPoint.y.toFixed(1)} m${Number.isFinite(endPoint.t) ? `<br>Track time: ${endPoint.t.toFixed(2)} s` : ""}"></circle>`);
    }
  }

  return parts.join("");
}

function buildLegend(tracks, palette, legendX, legendY, includeFiber = true) {
  const names = Object.keys(tracks || {});
  const items = includeFiber ? [{ name: "Fiber", color: "#ff4fd8" }] : [];
  names.slice(0, 5).forEach((name, idx) => items.push({ name, color: palette[idx % palette.length] }));
  const legendW = 184;
  const markerRows = 2;
  const legendH = Math.max(74, 24 + items.length * 18 + 18 + markerRows * 16);

  const parts = [
    `<rect x="${legendX.toFixed(1)}" y="${legendY.toFixed(1)}" width="${legendW}" height="${legendH}" rx="12" fill="rgba(11,23,43,0.86)" stroke="rgba(114,246,255,0.24)"></rect>`,
    `<text x="${(legendX + 10).toFixed(1)}" y="${(legendY + 14).toFixed(1)}" fill="#9fb3d9" font-size="11">Map layers</text>`
  ];

  items.forEach((item, idx) => {
    const y = legendY + 24 + idx * 18;
    parts.push(`<line x1="${(legendX + 12).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(legendX + 34).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${item.color}" stroke-width="2.4"></line>`);
    parts.push(`<text x="${(legendX + 42).toFixed(1)}" y="${(y + 4).toFixed(1)}" fill="#d4e3ff" font-size="11">${item.name}</text>`);
  });

  const markerHeadY = legendY + 24 + items.length * 18 + 6;
  parts.push(`<text x="${(legendX + 10).toFixed(1)}" y="${markerHeadY.toFixed(1)}" fill="#9fb3d9" font-size="11">Markers</text>`);
  const sourceLegendName = state.selectedShotId === "whales_orca"
    ? "Orca"
    : (state.selectedShotId === "whales_humpback" ? "Humpback" : "Source");
  const sourceY = markerHeadY + 12;
  parts.push(`<polygon points="${(legendX + 18).toFixed(1)},${(sourceY - 5).toFixed(1)} ${(legendX + 23).toFixed(1)},${sourceY.toFixed(1)} ${(legendX + 18).toFixed(1)},${(sourceY + 5).toFixed(1)} ${(legendX + 13).toFixed(1)},${sourceY.toFixed(1)}" fill="#ff7a59" stroke="#ffd9c6" stroke-width="1"></polygon>`);
  parts.push(`<text x="${(legendX + 42).toFixed(1)}" y="${(sourceY + 4).toFixed(1)}" fill="#d4e3ff" font-size="11">${sourceLegendName}</text>`);
  const selectedY = sourceY + 16;
  parts.push(`<circle cx="${(legendX + 18).toFixed(1)}" cy="${selectedY.toFixed(1)}" r="5.2" fill="none" stroke="#ff6f7f" stroke-width="1.8"></circle>`);
  parts.push(`<circle cx="${(legendX + 18).toFixed(1)}" cy="${selectedY.toFixed(1)}" r="2.3" fill="#ff6f7f"></circle>`);
  parts.push(`<text x="${(legendX + 42).toFixed(1)}" y="${(selectedY + 4).toFixed(1)}" fill="#d4e3ff" font-size="11">Selected channel</text>`);

  return parts.join("");
}

function renderMapLegendPanel(tracks, includeFiber = true, includePoints = true) {
  if (!el.mapLegendPanel) {
    return;
  }
  const names = Object.keys(tracks || {});
  const items = includeFiber ? [{ name: "Fiber", color: "#ff4fd8" }] : [];
  names.slice(0, 5).forEach((name, idx) => items.push({ name, color: TRACK_PALETTE[idx % TRACK_PALETTE.length] }));
  const sourceLegendName = state.selectedShotId === "whales_orca"
    ? "Orca"
    : (state.selectedShotId === "whales_humpback" ? "Humpback" : "Source");

  const layerHtml = items.map((item) => (
    `<div class="map-legend-row"><span class="map-legend-swatch" style="background:${item.color};"></span><span>${item.name}</span></div>`
  )).join("");
 const markerHtml = includePoints
    ? [
      `<div class="map-legend-row"><span class="map-legend-diamond"></span><span>${sourceLegendName}</span></div>`,
      `<div class="map-legend-row"><span class="map-legend-selected"><span></span></span><span>Selected channel</span></div>`
    ].join("")
    : "";
  el.mapLegendPanel.innerHTML = `
    <div class="map-legend-title">Map layers</div>
    ${layerHtml}
    <div class="map-legend-title map-legend-title-markers">Markers</div>
    ${markerHtml}
  `;
}

function renderMapPanel() {
  const source = getSourceGroundTruth();
  const recorderSummary = state.shotBundle?.recordersSummary;
  const situation = state.shotBundle?.situation;
  const mapTimelineExtent = getMapTimelineExtentFromSituation(state.shotBundle);
  state.mapTimeline.extent = mapTimelineExtent;
  const recorders = [];

  const width = Math.max(640, Math.floor(el.mapSvg.clientWidth || 1200));
  const height = Math.max(420, Math.floor(el.mapSvg.clientHeight || 560));
  const pad = { l: 48, r: 48, t: 26, b: 28 };
  const legendReserve = 28;
  const plotW = Math.max(120, width - pad.l - pad.r - legendReserve);
  const plotH = Math.max(120, height - pad.t - pad.b);

  el.mapSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  el.mapSvg.setAttribute("preserveAspectRatio", "none");

  if (recorderSummary && typeof recorderSummary === "object") {
    Object.entries(recorderSummary).forEach(([name, payload]) => {
      const x = payload?.attrs?.["Position X (m)"];
      const y = payload?.attrs?.["Position Y (m)"];
      if (Number.isFinite(x) && Number.isFinite(y)) {
        recorders.push({ name, x, y, attrs: payload?.attrs || {} });
      }
    });
  }

  const bathy = situation?.bathymetry;
  const grid = bathy?.depth_grid || [];
  let xCoords = Array.isArray(bathy?.x_coords) ? bathy.x_coords : [];
  let yCoords = Array.isArray(bathy?.y_coords) ? bathy.y_coords : [];
  const bathyAttrs = bathy?.attrs || {};

  if ((!xCoords.length || !yCoords.length) && grid.length && Array.isArray(grid[0]) && grid[0].length) {
    const xmin = Number(bathyAttrs["X min"]);
    const xmax = Number(bathyAttrs["X max"]);
    const ymin = Number(bathyAttrs["Y min"]);
    const ymax = Number(bathyAttrs["Y max"]);
    if ([xmin, xmax, ymin, ymax].every((v) => Number.isFinite(v))) {
      xCoords = Array.from({ length: grid[0].length }, (_, i) => xmin + (i * (xmax - xmin)) / Math.max(1, grid[0].length - 1));
      yCoords = Array.from({ length: grid.length }, (_, i) => ymin + (i * (ymax - ymin)) / Math.max(1, grid.length - 1));
    }
  }

  const fiberAll = situation?.fiber_track?.segments?.all;
  const boatTracks = situation?.boat_tracks?.tracks;
  const trackItems = Object.entries(boatTracks || {})
    .filter(([, pts]) => Array.isArray(pts) && pts.length > 1)
    .map(([name, pts]) => ({ name, points: pts }));
  const mapTimelineMode = state.mapTimeline.mode === "time" ? "time" : "full";
  const mapTimelineTime = clamp(Number.isFinite(state.mapTimeline.time) ? state.mapTimeline.time : mapTimelineExtent.start, mapTimelineExtent.start, mapTimelineExtent.end);
  const isMapDragging = state.draggingTarget === "map";
  const isMapZooming = !!state.mapZoomActive;

  const sourcePoint = (source.available && Number.isFinite(source.x) && Number.isFinite(source.y))
    ? { x: source.x, y: source.y, depth: source.depth }
    : null;

  const extentCandidates = [];
  const pushPoint = (x, y) => {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      extentCandidates.push({ x, y });
    }
  };

  const decimatePoints = (pts, maxPoints) => {
    if (!Array.isArray(pts) || pts.length <= maxPoints) {
      return pts || [];
    }
    const step = Math.max(1, Math.ceil(pts.length / maxPoints));
    const reduced = [];
    for (let i = 0; i < pts.length; i += step) {
      reduced.push(pts[i]);
    }
    const last = pts[pts.length - 1];
    if (reduced[reduced.length - 1] !== last) {
      reduced.push(last);
    }
    return reduced;
  };

  if (xCoords.length && yCoords.length) {
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let i = 0; i < xCoords.length; i += 1) {
      const x = xCoords[i];
      if (!Number.isFinite(x)) {
        continue;
      }
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
    }
    for (let i = 0; i < yCoords.length; i += 1) {
      const y = yCoords[i];
      if (!Number.isFinite(y)) {
        continue;
      }
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    pushPoint(xMin, yMin);
    pushPoint(xMax, yMax);
  }
  (Array.isArray(fiberAll) ? fiberAll : []).forEach((pt) => pushPoint(pt?.x, pt?.y));
  trackItems.forEach((track) => track.points.forEach((pt) => pushPoint(pt?.x, pt?.y)));
  recorders.forEach((rec) => pushPoint(rec.x, rec.y));
  if (sourcePoint) {
    pushPoint(sourcePoint.x, sourcePoint.y);
  }

  if (!extentCandidates.length) {
    el.mapSvg.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" fill="rgba(6,12,24,0.96)"></rect>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#9fb3d9" font-size="15">Spatial data unavailable for this shot.</text>
    `;
    el.mapCaption.textContent = "Map data not available for this shot.";
    return;
  }

  let minX0 = Infinity;
  let maxX0 = -Infinity;
  let minY0 = Infinity;
  let maxY0 = -Infinity;

  // Prefer bathymetry bounds for default framing so the map occupies
  // the full panel instead of shrinking around sparse outlier tracks.
  if (xCoords.length && yCoords.length) {
    for (let i = 0; i < xCoords.length; i += 1) {
      const x = xCoords[i];
      if (!Number.isFinite(x)) {
        continue;
      }
      if (x < minX0) minX0 = x;
      if (x > maxX0) maxX0 = x;
    }
    for (let i = 0; i < yCoords.length; i += 1) {
      const y = yCoords[i];
      if (!Number.isFinite(y)) {
        continue;
      }
      if (y < minY0) minY0 = y;
      if (y > maxY0) maxY0 = y;
    }
  } else {
    for (let i = 0; i < extentCandidates.length; i += 1) {
      const p = extentCandidates[i];
      if (p.x < minX0) minX0 = p.x;
      if (p.x > maxX0) maxX0 = p.x;
      if (p.y < minY0) minY0 = p.y;
      if (p.y > maxY0) maxY0 = p.y;
    }
  }

  if (!Number.isFinite(minX0) || !Number.isFinite(maxX0) || !Number.isFinite(minY0) || !Number.isFinite(maxY0)) {
    for (let i = 0; i < extentCandidates.length; i += 1) {
      const p = extentCandidates[i];
      if (p.x < minX0) minX0 = p.x;
      if (p.x > maxX0) maxX0 = p.x;
      if (p.y < minY0) minY0 = p.y;
      if (p.y > maxY0) maxY0 = p.y;
    }
  }

  const xPad = Math.max(2, (maxX0 - minX0) * 0.025);
  const yPad = Math.max(2, (maxY0 - minY0) * 0.025);
  const minX = minX0 - xPad;
  const maxX = maxX0 + xPad;
  const minY = minY0 - yPad;
  const maxY = maxY0 + yPad;

  const baseRangeX = Math.max(0.0001, maxX - minX);
  const baseRangeY = Math.max(0.0001, maxY - minY);
  const zoom = clamp(state.mapViewport.zoom, 1, 8);
  const centerX = (minX + maxX) * 0.5 + state.mapViewport.offsetX * baseRangeX;
  const centerY = (minY + maxY) * 0.5 + state.mapViewport.offsetY * baseRangeY;
  const viewRangeX = baseRangeX / zoom;
  const viewRangeY = baseRangeY / zoom;
  const viewMinX = centerX - viewRangeX * 0.5;
  const viewMaxX = centerX + viewRangeX * 0.5;
  const viewMinY = centerY - viewRangeY * 0.5;
  const viewMaxY = centerY + viewRangeY * 0.5;

  const xScale = (x) => pad.l + ((x - viewMinX) / Math.max(0.0001, viewMaxX - viewMinX)) * plotW;
  const yScale = (y) => pad.t + (1 - ((y - viewMinY) / Math.max(0.0001, viewMaxY - viewMinY))) * plotH;

  const getMapLayerEnabled = (layerName) => {
    const btn = el.mapControls?.querySelector(`[data-layer="${layerName}"]`);
    return !btn || btn.getAttribute("aria-pressed") !== "false";
  };

  const showBathymetry = getMapLayerEnabled("bathymetry");
  const showFiber = getMapLayerEnabled("fiber");
  const showTracks = getMapLayerEnabled("tracks");
  const showPoints = getMapLayerEnabled("points");
  const fiberSelectionPoints = Array.isArray(fiberAll)
    ? fiberAll.filter((pt) => Number.isFinite(pt?.x) && Number.isFinite(pt?.y)).map((pt) => ({ x: Number(pt.x), y: Number(pt.y) }))
    : [];
  let fiberSelection = null;
  if (fiberSelectionPoints.length > 1) {
    const cumLen = [0];
    let totalLen = 0;
    for (let i = 1; i < fiberSelectionPoints.length; i += 1) {
      const a = fiberSelectionPoints[i - 1];
      const b = fiberSelectionPoints[i];
      totalLen += Math.hypot(b.x - a.x, b.y - a.y);
      cumLen.push(totalLen);
    }
    fiberSelection = {
      points: fiberSelectionPoints,
      cumLen,
      totalLen
    };
  }

  const bathyColor = (depth, minDepth, maxDepth) => {
    if (!Number.isFinite(depth)) {
      return "rgba(236,240,244,0.03)";
    }
    const norm = clamp((depth - minDepth) / Math.max(0.0001, maxDepth - minDepth), 0, 1);
    const inv = 1 - norm;
    const alpha = 0.04 + 0.19 * Math.pow(inv, 1.25);
    const r = Math.round(224 + 22 * inv);
    const g = Math.round(229 + 14 * inv);
    const b = Math.round(236 + 10 * inv);
    return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  };

  const buildDataDrivenBathymetry = (rasterGrid, rasterXCoords, rasterYCoords) => {
    if (!Array.isArray(rasterGrid) || !Array.isArray(rasterXCoords) || !Array.isArray(rasterYCoords) || !rasterGrid.length || rasterXCoords.length < 2 || rasterYCoords.length < 2) {
      return "";
    }

    let minDepth = Infinity;
    let maxDepth = -Infinity;
    for (let yi = 0; yi < rasterGrid.length; yi += 1) {
      const row = rasterGrid[yi];
      if (!Array.isArray(row)) {
        continue;
      }
      for (let xi = 0; xi < row.length; xi += 1) {
        const depth = row[xi];
        if (!Number.isFinite(depth)) {
          continue;
        }
        if (depth < minDepth) minDepth = depth;
        if (depth > maxDepth) maxDepth = depth;
      }
    }

    if (!Number.isFinite(minDepth) || !Number.isFinite(maxDepth)) {
      return "";
    }

    const targetCols = 46;
    const targetRows = 30;
    const stepX = Math.max(1, Math.floor((rasterXCoords.length - 1) / targetCols));
    const stepY = Math.max(1, Math.floor((rasterYCoords.length - 1) / targetRows));
    const parts = [];

    for (let yi = 0; yi < rasterYCoords.length - 1; yi += stepY) {
      const yi1 = Math.min(rasterYCoords.length - 1, yi + stepY);
      const y0 = rasterYCoords[yi];
      const y1 = rasterYCoords[yi1];
      const yMin = Math.min(y0, y1);
      const yMax = Math.max(y0, y1);
      if (yMax < viewMinY || yMin > viewMaxY) {
        continue;
      }

      const row = rasterGrid[yi] || [];
      for (let xi = 0; xi < rasterXCoords.length - 1; xi += stepX) {
        const xi1 = Math.min(rasterXCoords.length - 1, xi + stepX);
        const x0 = rasterXCoords[xi];
        const x1 = rasterXCoords[xi1];
        const xMin = Math.min(x0, x1);
        const xMax = Math.max(x0, x1);
        if (xMax < viewMinX || xMin > viewMaxX) {
          continue;
        }

        const depth = row[xi];
        if (!Number.isFinite(depth)) {
          continue;
        }

        const left = xScale(xMin);
        const right = xScale(xMax);
        const top = yScale(yMax);
        const bottom = yScale(yMin);
        const rectX = Math.min(left, right);
        const rectY = Math.min(top, bottom);
        const rectW = Math.max(0.8, Math.abs(right - left));
        const rectH = Math.max(0.8, Math.abs(bottom - top));

        parts.push(`<rect x="${rectX.toFixed(2)}" y="${rectY.toFixed(2)}" width="${rectW.toFixed(2)}" height="${rectH.toFixed(2)}" fill="${bathyColor(depth, minDepth, maxDepth)}"></rect>`);
      }
    }

    return parts.join("");
  };

  const clipId = "map-plot-clip";
  const parts = [
    `<rect x="0" y="0" width="${width}" height="${height}" fill="rgba(5,11,23,0.97)"></rect>`,
    `<rect x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}" fill="rgba(8,15,31,0.45)" stroke="rgba(197,223,255,0.18)"></rect>`,
    `<defs><clipPath id="${clipId}"><rect x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}"></rect></clipPath></defs>`
  ];
  const mapParts = [];

  if (showBathymetry && Array.isArray(grid) && grid.length && xCoords.length && yCoords.length) {
    mapParts.push(`<rect x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}" fill="rgba(235,239,244,0.042)"></rect>`);
    mapParts.push(buildDataDrivenBathymetry(grid, xCoords, yCoords));
  }

  if (showFiber && Array.isArray(fiberAll) && fiberAll.length > 1) {
    const fiberPts = decimatePoints(
      fiberAll.filter((pt) => Number.isFinite(pt?.x) && Number.isFinite(pt?.y)),
      isMapDragging ? 180 : (isMapZooming ? 240 : (zoom <= 1.6 ? 360 : 900))
    );
    for (let i = 1; i < fiberPts.length; i += 1) {
      const prev = fiberPts[i - 1];
      const curr = fiberPts[i];
      mapParts.push(`<line x1="${xScale(prev.x).toFixed(2)}" y1="${yScale(prev.y).toFixed(2)}" x2="${xScale(curr.x).toFixed(2)}" y2="${yScale(curr.y).toFixed(2)}" stroke="rgba(255,79,216,0.34)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"></line>`);
    }
  }

  const sc = state.shotBundle?.selectedChannel;
  // Prepare selected-channel marker parts but do not push them yet so they render on top of other layers.
  let _selectedChannelParts = null;
  if (showPoints && fiberSelection && sc?.available && sc.multiChannel && Number.isFinite(sc.activePreviewCol)) {
    const entry = sc.entryByCol?.[String(sc.activePreviewCol)];
    const stats = getSelectedChannelsDistanceStats(sc);
    const activeDistance = Number(entry?.distance_m);
    if (entry && stats && Number.isFinite(activeDistance) && stats.max > stats.min + 1e-9) {
      const frac = clamp((activeDistance - stats.min) / (stats.max - stats.min), 0, 1);
      const markerPt = pointOnFiberAtFraction(fiberSelection, frac);
      if (markerPt) {
        const mx = xScale(markerPt.x);
        const my = yScale(markerPt.y);
        const body = `Type: Selected-channel marker<br>Preview col: ${entry.preview_col}<br>Raw channel: ${entry.raw_das_channel_index}<br>Distance: ${activeDistance.toFixed(1)} m`;
        _selectedChannelParts = [];
        // soft active hotspot with a subtle pulse
        _selectedChannelParts.push(`<circle class="map-point-selected-channel-glow" cx="${mx.toFixed(2)}" cy="${my.toFixed(2)}" r="17.2" fill="rgba(255,111,127,0.16)"></circle>`);
        _selectedChannelParts.push(`<circle class="map-point-selected-channel-ring" cx="${mx.toFixed(2)}" cy="${my.toFixed(2)}" r="11.4" fill="none" stroke="#ff6f7f" stroke-width="2.5"></circle>`);
        _selectedChannelParts.push(`<circle class="map-point-selected-channel-center" cx="${mx.toFixed(2)}" cy="${my.toFixed(2)}" r="4.7" fill="#ff6f7f" stroke="rgba(255,214,221,0.42)" stroke-width="0.7"></circle>`);
        // invisible hit area keeps tooltip easy to trigger without adding visual weight
        _selectedChannelParts.push(`<circle class="map-interactive-point map-point-selected-channel" cx="${mx.toFixed(2)}" cy="${my.toFixed(2)}" r="7.6" fill="rgba(255,255,255,0.001)" data-tooltip-title="Selected DAS channel" data-tooltip-body="${body}"></circle>`);
      }
    }
  }

  if (showTracks) {
    trackItems.forEach((track, idx) => {
      const color = TRACK_PALETTE[idx % TRACK_PALETTE.length];
      const rawPoints = mapTimelineMode === "time"
        ? track.points.filter((pt) => Number.isFinite(pt?.x) && Number.isFinite(pt?.y) && Number.isFinite(pt?.t) && pt.t <= mapTimelineTime)
        : track.points.filter((pt) => Number.isFinite(pt?.x) && Number.isFinite(pt?.y));
      const pts = decimatePoints(rawPoints, isMapDragging ? 130 : (isMapZooming ? 170 : (zoom <= 1.6 ? 260 : 700)));
      for (let i = 1; i < pts.length; i += 1) {
        const prev = pts[i - 1];
        const curr = pts[i];
        const body = `Type: Vessel trajectory<br>Track: ${track.name}<br>Coordinates (E, N): ${curr.x.toFixed(1)} m, ${curr.y.toFixed(1)} m${Number.isFinite(curr.t) ? `<br>Track time: ${curr.t.toFixed(2)} s` : ""}`;
        mapParts.push(`<line class="map-interactive-line map-track-segment" x1="${xScale(prev.x).toFixed(2)}" y1="${yScale(prev.y).toFixed(2)}" x2="${xScale(curr.x).toFixed(2)}" y2="${yScale(curr.y).toFixed(2)}" stroke="${color}" stroke-width="1.9" opacity="0.44" data-tooltip-title="Boat Trajectory" data-tooltip-body="${body}"></line>`);
      }
    });
  }

  if (showFiber && Array.isArray(fiberAll) && fiberAll.length > 1) {
    const fiberPtsTop = decimatePoints(
      fiberAll.filter((pt) => Number.isFinite(pt?.x) && Number.isFinite(pt?.y)),
      isMapDragging ? 210 : (isMapZooming ? 280 : (zoom <= 1.6 ? 420 : 980))
    );
    for (let i = 1; i < fiberPtsTop.length; i += 1) {
      const prev = fiberPtsTop[i - 1];
      const curr = fiberPtsTop[i];
      mapParts.push(`<line x1="${xScale(prev.x).toFixed(2)}" y1="${yScale(prev.y).toFixed(2)}" x2="${xScale(curr.x).toFixed(2)}" y2="${yScale(curr.y).toFixed(2)}" stroke="rgba(255,79,216,0.22)" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round"></line>`);
      mapParts.push(`<line x1="${xScale(prev.x).toFixed(2)}" y1="${yScale(prev.y).toFixed(2)}" x2="${xScale(curr.x).toFixed(2)}" y2="${yScale(curr.y).toFixed(2)}" stroke="rgba(255,122,228,0.97)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"></line>`);
    }
  }

  if (showTracks && showPoints && mapTimelineMode === "full") {
    mapParts.push(buildTrackPointMarkers(boatTracks || {}, xScale, yScale));
  }

  const points = showPoints ? buildSituationPoints(recorders, sourcePoint, xScale, yScale) : "";
const overlays = (mapTimelineMode === "time" && showPoints)
    ? buildMapTimeOverlays(showTracks ? (boatTracks || {}) : {}, xScale, yScale, mapTimelineTime)
    : "";
  renderMapLegendPanel(showTracks ? (boatTracks || {}) : {}, showFiber, showPoints);

  // Render points (recorders, source) and overlays first
  mapParts.push(points);
  mapParts.push(overlays);
  // Then render selected-channel marker parts on top for visibility
  if (Array.isArray(_selectedChannelParts)) {
    for (const p of _selectedChannelParts) mapParts.push(p);
  }
  parts.push(`<g clip-path="url(#${clipId})">${mapParts.join("")}</g>`);

  state.geometry.map = {
    pad,
    plotW,
    plotH,
    baseRangeX,
    baseRangeY,
    baseCenterX: (minX + maxX) * 0.5,
    baseCenterY: (minY + maxY) * 0.5,
    viewMinX,
    viewMaxX,
    viewMinY,
    viewMaxY,
    fiberSelection
  };

  el.mapSvg.innerHTML = parts.join("");
  attachMapHoverHandlers();
  syncMapTimelineControls();
}

function attachMapHoverHandlers() {
  if (!el.mapSvg || el.mapSvg.dataset.hoverBound === "true") return;

  el.mapSvg.addEventListener("mousemove", (event) => {
    if (state.draggingTarget === "map") {
      const prevNode = state.hover.mapNode;
      if (prevNode && prevNode.classList) {
        prevNode.classList.remove("is-hovered");
      }
      state.hover.mapNode = null;
      hideTooltip();
      return;
    }
    const hoverNode = event.target && event.target.closest ? event.target.closest("[data-tooltip-title]") : null;
    if (!hoverNode) {
      clearMapHoverState();
      return;
    }

    if (state.hover.mapNode !== hoverNode) {
      if (state.hover.mapNode && state.hover.mapNode.classList) {
        state.hover.mapNode.classList.remove("is-hovered");
      }
      state.hover.mapNode = hoverNode;
      if (state.hover.mapNode.classList) {
        state.hover.mapNode.classList.add("is-hovered");
      }
    }

    const title = hoverNode.getAttribute("data-tooltip-title") || "Map";
    const body = hoverNode.getAttribute("data-tooltip-body") || "";
    showTooltip(title, body, event.clientX, event.clientY);
  }, { passive: true });

  el.mapSvg.addEventListener("mouseleave", () => {
    clearMapHoverState();
  }, { passive: true });

  el.mapSvg.dataset.hoverBound = "true";
}

function bindMapControlHandlers() {
  if (!el.mapControls) return;

  el.mapControls.addEventListener("click", (event) => {
    const btn = event.target && event.target.closest ? event.target.closest(".map-toggle") : null;
    if (!btn) {
      return;
    }

    const action = btn.getAttribute("data-action");

    if (action === "reset-view") {
      resetMapViewport();
      state.draggingTarget = null;
      el.mapControls.querySelectorAll("[data-layer]").forEach((layerBtn) => {
        layerBtn.setAttribute("aria-pressed", "true");
      });
      if (el.mapSvg) {
        el.mapSvg.style.cursor = "grab";
      }
      clearMapHoverState();
      scheduleMapRender();
      return;
    }

    const currentState = btn.getAttribute("aria-pressed") === "true";
    btn.setAttribute("aria-pressed", String(!currentState));
    scheduleMapRender();
  });
}

function bindMapTimelineHandlers() {
  if (el.mapModeFull) {
    el.mapModeFull.addEventListener("click", () => setMapTimelineMode("full"));
  }
  if (el.mapModeTime) {
    el.mapModeTime.addEventListener("click", () => setMapTimelineMode("time"));
  }
  if (el.mapTimePlay) {
    el.mapTimePlay.addEventListener("click", () => {
      if (state.mapTimeline.mode !== "time") {
        state.mapTimeline.mode = "time";
      }
      toggleMapTimelinePlayback();
    });
  }
  if (el.mapTimeSlider) {
    el.mapTimeSlider.addEventListener("input", (event) => {
      const next = parseNumeric(event.target.value);
      if (next == null) {
        return;
      }
      stopMapTimelinePlayback();
      if (state.mapTimeline.mode !== "time") {
        state.mapTimeline.mode = "time";
      }
      setMapTimelineTime(next);
    }, { passive: true });
  }
}

function zoomMapAtClientPoint(clientX, clientY, multiplier) {
  if (!state.shotBundle || !el.mapSvg) {
    return;
  }

  const geo = state.geometry.map;
  if (!geo) {
    const fallbackTarget = Number.isFinite(state.mapViewport.targetZoom) ? state.mapViewport.targetZoom : state.mapViewport.zoom;
    state.mapViewport.targetZoom = clamp(fallbackTarget * multiplier, 1, 8);
    animateMapZoom();
    return;
  }

  const rect = el.mapSvg.getBoundingClientRect();
  const sx = clamp((clientX - rect.left - geo.pad.l) / Math.max(1, geo.plotW), 0, 1);
  const sy = clamp((clientY - rect.top - geo.pad.t) / Math.max(1, geo.plotH), 0, 1);
  const currentRangeX = Math.max(0.0001, geo.viewMaxX - geo.viewMinX);
  const currentRangeY = Math.max(0.0001, geo.viewMaxY - geo.viewMinY);
  const anchorX = geo.viewMinX + sx * currentRangeX;
  const anchorY = geo.viewMaxY - sy * currentRangeY;

  const currentTarget = Number.isFinite(state.mapViewport.targetZoom) ? state.mapViewport.targetZoom : state.mapViewport.zoom;
  const nextTargetZoom = clamp(currentTarget * multiplier, 1, 8);
  const nextRangeX = geo.baseRangeX / nextTargetZoom;
  const nextRangeY = geo.baseRangeY / nextTargetZoom;
  const nextCenterX = anchorX + (0.5 - sx) * nextRangeX;
  const nextCenterY = anchorY + (sy - 0.5) * nextRangeY;

  state.mapViewport.offsetX = clamp((nextCenterX - geo.baseCenterX) / Math.max(0.0001, geo.baseRangeX), -0.5, 0.5);
  state.mapViewport.offsetY = clamp((nextCenterY - geo.baseCenterY) / Math.max(0.0001, geo.baseRangeY), -0.5, 0.5);
  state.mapViewport.targetZoom = nextTargetZoom;
  animateMapZoom();
}

function onMapDoubleClick(event) {
  event.preventDefault();
}

function zoomMapFromPanelButton(multiplier) {
  if (!el.mapSvg) {
    return;
  }
  const rect = el.mapSvg.getBoundingClientRect();
  const cx = rect.left + rect.width * 0.5;
  const cy = rect.top + rect.height * 0.5;
  zoomMapAtClientPoint(cx, cy, multiplier);
}

function mapClientToWorld(clientX, clientY) {
  if (!el.mapSvg || !state.geometry.map) {
    return null;
  }
  const geo = state.geometry.map;
  const rect = el.mapSvg.getBoundingClientRect();
  const sx = clamp((clientX - rect.left - geo.pad.l) / Math.max(1, geo.plotW), 0, 1);
  const sy = clamp((clientY - rect.top - geo.pad.t) / Math.max(1, geo.plotH), 0, 1);
  return {
    x: geo.viewMinX + sx * Math.max(1e-9, geo.viewMaxX - geo.viewMinX),
    y: geo.viewMaxY - sy * Math.max(1e-9, geo.viewMaxY - geo.viewMinY)
  };
}

function worldToMapScreenPx(worldX, worldY, geo) {
  return {
    x: geo.pad.l + ((worldX - geo.viewMinX) / Math.max(1e-9, geo.viewMaxX - geo.viewMinX)) * geo.plotW,
    y: geo.pad.t + (1 - (worldY - geo.viewMinY) / Math.max(1e-9, geo.viewMaxY - geo.viewMinY)) * geo.plotH
  };
}

function nearestFiberProjection(worldX, worldY, fiber) {
  if (!fiber || !Array.isArray(fiber.points) || fiber.points.length < 2 || !Array.isArray(fiber.cumLen)) {
    return null;
  }
  const pts = fiber.points;
  const cum = fiber.cumLen;
  const total = Math.max(1e-9, fiber.totalLen || cum[cum.length - 1] || 1);
  let best = null;
  let bestD2 = Infinity;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const seg2 = vx * vx + vy * vy;
    if (seg2 < 1e-12) {
      continue;
    }
    const wx = worldX - a.x;
    const wy = worldY - a.y;
    const u = clamp((wx * vx + wy * vy) / seg2, 0, 1);
    const px = a.x + u * vx;
    const py = a.y + u * vy;
    const dx = worldX - px;
    const dy = worldY - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      const segLen = Math.sqrt(seg2);
      const along = cum[i - 1] + u * segLen;
      best = {
        x: px,
        y: py,
        along,
        fraction: clamp(along / total, 0, 1)
      };
    }
  }
  return best;
}

function pointOnFiberAtFraction(fiber, fraction) {
  if (!fiber || !Array.isArray(fiber.points) || fiber.points.length < 2 || !Array.isArray(fiber.cumLen)) {
    return null;
  }
  const pts = fiber.points;
  const cum = fiber.cumLen;
  const total = Math.max(1e-9, fiber.totalLen || cum[cum.length - 1] || 1);
  const target = clamp(fraction, 0, 1) * total;
  for (let i = 1; i < cum.length; i += 1) {
    if (target <= cum[i]) {
      const segLen = Math.max(1e-9, cum[i] - cum[i - 1]);
      const u = clamp((target - cum[i - 1]) / segLen, 0, 1);
      const a = pts[i - 1];
      const b = pts[i];
      return {
        x: a.x + u * (b.x - a.x),
        y: a.y + u * (b.y - a.y)
      };
    }
  }
  return pts[pts.length - 1];
}

function getSelectedChannelsDistanceStats(sc) {
  const entries = Object.values(sc?.entryByCol || {}).filter((e) => Number.isFinite(Number(e?.distance_m)));
  if (!entries.length) {
    return null;
  }
  const ds = entries.map((e) => Number(e.distance_m)).sort((a, b) => a - b);
  return {
    min: ds[0],
    max: ds[ds.length - 1]
  };
}

function tryMapClickSelectChannel(clientX, clientY) {
  const sc = state.shotBundle?.selectedChannel;
  if (!sc?.available || !sc.multiChannel) {
    return;
  }
  const geo = state.geometry.map;
  const fiber = geo?.fiberSelection;
  if (!geo || !fiber) {
    return;
  }
  const world = mapClientToWorld(clientX, clientY);
  if (!world) {
    return;
  }
  const nearest = nearestFiberProjection(world.x, world.y, fiber);
  if (!nearest) {
    return;
  }
  const nearestPx = worldToMapScreenPx(nearest.x, nearest.y, geo);
  const rect = el.mapSvg.getBoundingClientRect();
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const distPx = Math.hypot(localX - nearestPx.x, localY - nearestPx.y);
  if (distPx > 26) {
    return;
  }

  const stats = getSelectedChannelsDistanceStats(sc);
  const entries = Object.values(sc.entryByCol || {});
  if (!stats || !entries.length) {
    return;
  }
  const targetDist = stats.min + nearest.fraction * (stats.max - stats.min);
  let best = null;
  let bestDelta = Infinity;
  for (const entry of entries) {
    const d = Number(entry?.distance_m);
    if (!Number.isFinite(d)) {
      continue;
    }
    const delta = Math.abs(d - targetDist);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = entry;
    }
  }
  if (!best || !Number.isFinite(best.preview_col)) {
    return;
  }
  void switchSelectedChannelToPreviewCol(Number(best.preview_col));
}

function onMapPointerDown(event) {
  if (!state.shotBundle) {
    return;
  }
  if (typeof event.button === "number" && event.button !== 0) {
    return;
  }
  event.preventDefault();
  state.draggingTarget = "map";
  state.mapPointerDown = { x: event.clientX, y: event.clientY, moved: false };
  state.mapPanLastRenderTs = 0;
  state.hover.map = { x: event.clientX, y: event.clientY };
  if (el.mapSvg) {
    el.mapSvg.style.cursor = "grabbing";
  }
}

function onMapPointerMove(event) {
  if (state.draggingTarget !== "map") {
    return;
  }
  if (!state.geometry.map) {
    return;
  }

  const prev = state.hover.map || { x: event.clientX, y: event.clientY };
  const dx = event.clientX - prev.x;
  const dy = event.clientY - prev.y;
  state.hover.map = { x: event.clientX, y: event.clientY };
  if (state.mapPointerDown && !state.mapPointerDown.moved) {
    const ddx = event.clientX - state.mapPointerDown.x;
    const ddy = event.clientY - state.mapPointerDown.y;
    if (Math.hypot(ddx, ddy) > 4) {
      state.mapPointerDown.moved = true;
    }
  }

  state.mapPanDX += dx;
  state.mapPanDY += dy;
  scheduleMapPanApply();
}

function onMapTouchStart(event) {
  if (!state.shotBundle) {
    return;
  }
  const touch = event.touches?.[0];
  if (!touch) {
    return;
  }
  state.draggingTarget = "map";
  state.hover.map = { x: touch.clientX, y: touch.clientY };
  if (el.mapSvg) {
    el.mapSvg.style.cursor = "grabbing";
  }
  event.preventDefault();
}

function onMapTouchMove(event) {
  if (state.draggingTarget !== "map") {
    return;
  }
  const touch = event.touches?.[0];
  if (!touch) {
    return;
  }
  onMapPointerMove(touch);
  event.preventDefault();
}

function onMapTouchEnd() {
  onGlobalPointerUp();
}

function bindMapZoomButtonHandlers() {
  if (el.mapZoomIn) {
    el.mapZoomIn.addEventListener("click", () => {
      zoomMapFromPanelButton(1.28);
    });
  }
  if (el.mapZoomOut) {
    el.mapZoomOut.addEventListener("click", () => {
      zoomMapFromPanelButton(1 / 1.28);
    });
  }
}

function renderEventNavigation() {
  if (!el.eventNav) {
    return;
  }
  const events = getEventList();
  const current = getCurrentInterval();

  const shouldRebuild = el.eventNav.dataset.shotId !== String(state.selectedShotId) || el.eventNav.children.length !== events.length;

  if (events.length === 0) {
    if (el.eventNav.dataset.empty !== "true") {
      el.eventNav.innerHTML = "";
      const empty = document.createElement("span");
      empty.className = "placeholder-note";
      empty.textContent = "No candidate events for this shot.";
      el.eventNav.appendChild(empty);
      el.eventNav.dataset.empty = "true";
      el.eventNav.dataset.shotId = String(state.selectedShotId || "");
    }
    return;
  }

  if (shouldRebuild || el.eventNav.dataset.empty === "true") {
    el.eventNav.innerHTML = "";
    for (const event of events) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "event-chip";
      chip.dataset.eventId = event.event_id;
      chip.textContent = `${event.event_id.split("_").slice(-1)[0]}: ${event.start_time_s.toFixed(1)}-${event.end_time_s.toFixed(1)} s`;
      chip.addEventListener("click", () => {
        const timeExtent = getTimeExtentFromShotBundle(state.shotBundle);
        const eventPad = 1.2;
        const start = clamp(event.start_time_s - eventPad, timeExtent.start, timeExtent.end);
        const end = clamp(event.end_time_s + eventPad, start, timeExtent.end);
        syncIntervalInputs({ start, end });
        state.cursorTime = clamp(0.5 * (event.start_time_s + event.end_time_s), start, end);
        renderAllPanels();
        updateDataStatus(`Jumped to ${event.event_id}; interval ${start.toFixed(2)}-${end.toFixed(2)} s.`);
      });
      el.eventNav.appendChild(chip);
    }
    el.eventNav.dataset.empty = "false";
    el.eventNav.dataset.shotId = String(state.selectedShotId || "");
  }

  const chips = Array.from(el.eventNav.querySelectorAll(".event-chip"));
  for (let idx = 0; idx < chips.length && idx < events.length; idx += 1) {
    const chip = chips[idx];
    const event = events[idx];
    const active = state.cursorTime >= event.start_time_s && state.cursorTime <= event.end_time_s;
    const inInterval = event.end_time_s >= current.start && event.start_time_s <= current.end;
    chip.classList.toggle("active", active);
    chip.classList.toggle("in-interval", inInterval);
  }

  const overlapCount = events.filter((event) => event.end_time_s >= current.start && event.start_time_s <= current.end).length;
  updateDataStatus(`Selected shot ${state.selectedShotId}; interval ${current.start.toFixed(2)}-${current.end.toFixed(2)} s; ${overlapCount} candidate event(s) overlap.`);
}

function hitTestDas(event) {
  const geo = state.geometry.das;
  if (!geo) {
    return null;
  }

  const { pad, plotW, plotH } = geo;
  const x = event.offsetX;
  const y = event.offsetY;

  if (x < pad.left || x > pad.left + plotW || y < pad.top || y > pad.top + plotH) {
    return null;
  }

  const { timeIndices, distances, matrix } = geo;

  const col = clamp(Math.floor(((x - pad.left) / plotW) * timeIndices.length), 0, timeIndices.length - 1);
  const axis = geo.mode === "waterfall" ? geo.channels : distances;
  const rowFromTop = clamp(Math.floor(((y - pad.top) / plotH) * axis.length), 0, axis.length - 1);
  const row = geo.mode === "waterfall" ? rowFromTop : axis.length - rowFromTop - 1;
  const timeIndex = timeIndices[col];
  const time = geo.t[timeIndex];
  const sampleIndex = geo.sampleIndices?.[timeIndex];
  const sampleOffset = Number.isFinite(Number(sampleIndex)) && Number.isFinite(Number(geo.sampleOrigin))
    ? Number(sampleIndex) - Number(geo.sampleOrigin)
    : null;
  const distance = distances?.[row] ?? axis[row];
  const channel = geo.channels?.[row];
  const value = geo.mode === "waterfall"
    ? getWaterfallValue(geo.waterfall, timeIndex, row)
    : matrix[timeIndex]?.[row] ?? 0;

  return {
    mode: geo.mode || "activity",
    time,
    sampleIndex,
    sampleOffset,
    distance,
    channel,
    value,
    clientX: event.clientX,
    clientY: event.clientY
  };
}

function hitTestHydro(event) {
  const geo = state.geometry.hydro;
  if (!geo) {
    return null;
  }

  const { pad, plotW, plotH, t, y: scores, threshold, timeStart, timeEnd } = geo;
  const x = event.offsetX;
  const y = event.offsetY;

  if (x < pad.l || x > pad.l + plotW || y < pad.t || y > pad.t + plotH) {
    return null;
  }

  const xNorm = (x - pad.l) / plotW;
  const targetTime = timeStart + xNorm * (timeEnd - timeStart);
  let lo = 0;
  let hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < targetTime) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  let bestIndex = lo;
  if (lo > 0 && Math.abs(t[lo - 1] - targetTime) < Math.abs(t[lo] - targetTime)) {
    bestIndex = lo - 1;
  }

  const time = t[bestIndex];
  const score = scores[bestIndex];

  return {
    time,
    score,
    threshold,
    clientX: event.clientX,
    clientY: event.clientY
  };
}

function getSelectedChannelFullTimeRange(sc) {
  const candidates = [
    sc?.bandpassAudio?.t,
    sc?.signal?.t,
    sc?.band?.t,
    sc?.spec?.t
  ];
  for (const t of candidates) {
    if (t?.length >= 2 && Number.isFinite(t[0]) && Number.isFinite(t[t.length - 1])) {
      return { start: Number(t[0]), end: Number(t[t.length - 1]) };
    }
  }
  return getCurrentInterval();
}

function robustRangeFromSeries(values, startIndex, endIndex, options = {}) {
  const { qLo = 0.001, qHi = 0.999, maxSamples = 5000, includeValue = null } = options;
  if (!values?.length || endIndex < startIndex) {
    return { min: 0, max: 1 };
  }
  const n = endIndex - startIndex + 1;
  const step = Math.max(1, Math.floor(n / maxSamples));
  const samples = [];
  for (let i = startIndex; i <= endIndex; i += step) {
    const v = Number(values[i]);
    if (Number.isFinite(v)) {
      samples.push(v);
    }
  }
  if (samples.length < 4) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = startIndex; i <= endIndex; i += 1) {
      const v = Number(values[i]);
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { min: 0, max: 1 };
    }
    if (Number.isFinite(includeValue)) {
      min = Math.min(min, includeValue);
      max = Math.max(max, includeValue);
    }
    const pad = (max - min) * 0.12 || 1e-6;
    return { min: min - pad, max: max + pad };
  }
  samples.sort((a, b) => a - b);
  let min = quantileFromSorted(samples, qLo);
  let max = quantileFromSorted(samples, qHi);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    min = samples[0];
    max = samples[samples.length - 1];
  }
  if (Number.isFinite(includeValue)) {
    min = Math.min(min, includeValue);
    max = Math.max(max, includeValue);
  }
  const pad = (max - min) * 0.12 || 1e-6;
  return { min: min - pad, max: max + pad };
}

function renderSelectedChannelPanel() {
  if (!state.shotBundle) {
    el.selchUnavailable.hidden = false;
    el.selchContent.hidden = true;
    el.selchUnavailable.textContent = "Select a shot to load data.";
    state.geometry.selch = null;
    return;
  }

  const sc = state.shotBundle.selectedChannel;
  if (!sc || !sc.available) {
    el.selchUnavailable.hidden = false;
    el.selchContent.hidden = true;
    el.selchUnavailable.textContent = sc?.message || "Selected DAS channel is not available for this shot.";
    state.geometry.selch = null;
    return;
  }

  el.selchUnavailable.hidden = true;
  el.selchContent.hidden = false;

  if (el.selchChannelWrap && el.selchChannelSelect) {
    if (sc.multiChannel) {
      el.selchChannelWrap.hidden = false;
      const preferredOrder = sc.manifestDemo?.available_preview_cols;
      const colsFromIndex = Array.isArray(sc.channelsIndex?.channels)
        ? sc.channelsIndex.channels.map((c) => c.preview_col)
        : [];
      const cols =
        Array.isArray(preferredOrder) && preferredOrder.length > 0
          ? preferredOrder.filter((c) => sc.entryByCol && sc.entryByCol[String(c)])
          : colsFromIndex;
      if (el.selchChannelSelect.dataset.shotId !== String(state.selectedShotId)) {
        el.selchChannelSelect.innerHTML = "";
        cols.forEach((col) => {
          const entry = sc.entryByCol?.[String(col)];
          const opt = document.createElement("option");
          opt.value = String(col);
          const raw = Number(entry?.raw_das_channel_index);
          opt.textContent = Number.isFinite(raw) ? `Preview col ${col} (raw ${raw})` : `Preview col ${col}`;
          el.selchChannelSelect.appendChild(opt);
        });
        el.selchChannelSelect.dataset.shotId = String(state.selectedShotId || "");
      }
      el.selchChannelSelect.value = String(sc.activePreviewCol ?? cols[0] ?? "");
    } else {
      el.selchChannelWrap.hidden = true;
      el.selchChannelSelect.dataset.shotId = "";
    }
  }

  const interval = getCurrentInterval();
  const fullTimeRange = getSelectedChannelFullTimeRange(sc);
  const graphTimeRange = fullTimeRange;
  const cursorKey = [
    state.selectedShotId || "",
    sc.activePreviewCol ?? sc.meta?.selected_preview_col ?? sc.meta?.selected_raw_channel ?? "",
    fullTimeRange.start.toFixed(3),
    fullTimeRange.end.toFixed(3)
  ].join(":");
  if (state.selchCursorKey !== cursorKey && !selchDemoAudioState) {
    state.selchCursorKey = cursorKey;
    state.selchCursorTime = fullTimeRange.start;
  }
  const rawSelchCursor = Number.isFinite(state.selchCursorTime) ? state.selchCursorTime : fullTimeRange.start;
  const selchCursorTime = clamp(rawSelchCursor, fullTimeRange.start, fullTimeRange.end);
  state.selchCursorTime = selchCursorTime;
  const pad = { left: 56, right: 8, top: 4, bottom: 18 };
  let selchPlotW = 0;

  el.selchSubtitle.textContent =
    sc.meta?.selected_channel_label ||
    `Preview col ${sc.meta?.selected_preview_col}, raw ch ${sc.meta?.selected_raw_channel}`;

  if (el.selchAudioWrap) {
    const isWhalesMvp =
      state.selectedShotId === "whales_orca" || state.selectedShotId === "whales_humpback";
    const showAudio = isWhalesMvp && sc?.available;
    el.selchAudioWrap.hidden = !showAudio;
    if (showAudio && el.selchAudioHint) {
      const sac = getSourceAudioCompare();
      const hasSrc = Boolean(sac?.doc?.source_wav_file);
      const hasBp = Boolean(sc.bandpassAudio?.y?.length);
      const hasWide = Boolean(sc.signal?.y?.length);
      if (state.selectedShotId === "whales_humpback") {
        el.selchAudioHint.textContent = hasSrc
          ? "Play DAS listens to the selected fiber channel. Play source is the original reference recording for comparison. DAS can be much noisier, especially for humpback, so use it together with the plots."
          : "Play DAS listens to the selected fiber channel. It can sound mostly like noise, so use the plots to check where the signal changes.";
      } else {
        el.selchAudioHint.textContent = hasSrc
          ? "Play DAS listens to the selected fiber channel. Play source is the original reference recording for comparison; the two will not sound identical."
          : "Play DAS listens to the selected fiber channel after filtering.";
      }
      if (el.selchPlaySourceAudio) {
        el.selchPlaySourceAudio.disabled = !hasSrc;
      }
      if (el.selchPlayDasAudio) {
        el.selchPlayDasAudio.disabled = !hasBp && !hasWide;
      }
      syncSelchAudioScrubber(sc);
    }
  }

  const { t: tSpec, sxx, nf, nt, fortran } = sc.spec;

  function drawSpec() {
    const canvas = el.selchSpecCanvas;
    const { ctx, width, height } = getCanvasSize(canvas, 236);
    ctx.fillStyle = "rgba(8, 15, 31, 0.88)";
    ctx.fillRect(0, 0, width, height);
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    selchPlotW = plotW;
    const isOrcaShot = state.selectedShotId === "whales_orca";
    const isHumpbackShot = state.selectedShotId === "whales_humpback";
    const freqs = Array.isArray(sc.spec?.freqs) ? sc.spec.freqs : null;
    let fiLo = 0;
    let fiHi = nf - 1;
    if (isOrcaShot && freqs && freqs.length === nf) {
      // Orca-focused display window to improve readability of high-band structure.
      fiLo = clamp(lowerBoundSorted(freqs, 1500), 0, nf - 1);
      fiHi = clamp(upperBoundSorted(freqs, 2500) - 1, fiLo, nf - 1);
    } else if (isHumpbackShot && freqs && freqs.length === nf) {
      // Humpback-focused display window: emphasize low-mid band where humpback structure is stronger.
      fiLo = clamp(lowerBoundSorted(freqs, 20), 0, nf - 1);
      fiHi = clamp(upperBoundSorted(freqs, 1400) - 1, fiLo, nf - 1);
    }
    const nFreqDraw = Math.max(1, fiHi - fiLo + 1);

    const i0s = lowerBoundSorted(tSpec, graphTimeRange.start);
    const i1s = upperBoundSorted(tSpec, graphTimeRange.end) - 1;
    const contrastSamples = [];
    const freqBaseline = new Float32Array(nf);
    if (i1s >= i0s) {
      const tStep = Math.max(1, Math.floor((i1s - i0s + 1) / 160));
      const fStep = Math.max(1, Math.floor(nFreqDraw / 80));
      for (let fi = fiLo; fi <= fiHi; fi += 1) {
        let sum = 0;
        let count = 0;
        for (let ti = i0s; ti <= i1s; ti += tStep) {
          const v = spectrogramValue(sxx, nf, nt, fi, ti, fortran);
          sum += v;
          count += 1;
          if ((fi - fiLo) % fStep === 0) {
            contrastSamples.push(v);
          }
        }
        freqBaseline[fi] = count > 0 ? (sum / count) : 0;
      }
    }
    let vmin = -100;
    let vmax = -20;
    if (contrastSamples.length >= 4) {
      contrastSamples.sort((a, b) => a - b);
      if (isOrcaShot) {
        // Orca: robust clipping + stronger local contrast around the higher-frequency region.
        const qLo = quantileFromSorted(contrastSamples, 0.14);
        const qHi = quantileFromSorted(contrastSamples, 0.995);
        const qMid = quantileFromSorted(contrastSamples, 0.55);
        if (Number.isFinite(qLo) && Number.isFinite(qHi) && qHi > qLo) {
          vmin = qLo;
          vmax = qHi;
          const localSpan = Math.max(2, qHi - qLo);
          vmin = Math.max(vmin, qMid - 0.45 * localSpan);
        }
      } else if (isHumpbackShot) {
        // Humpback: robust clipping with slightly wider body to keep tonal/detail structure visible.
        const qLo = quantileFromSorted(contrastSamples, 0.08);
        const qHi = quantileFromSorted(contrastSamples, 0.998);
        const qMid = quantileFromSorted(contrastSamples, 0.5);
        if (Number.isFinite(qLo) && Number.isFinite(qHi) && qHi > qLo) {
          vmin = qLo;
          vmax = qHi;
          const localSpan = Math.max(2, qHi - qLo);
          vmin = Math.max(vmin, qMid - 0.52 * localSpan);
        }
      } else {
        const qLo = quantileFromSorted(contrastSamples, 0.05);
        const qHi = quantileFromSorted(contrastSamples, 0.995);
        if (Number.isFinite(qLo) && Number.isFinite(qHi) && qHi > qLo) {
          vmin = qLo;
          vmax = qHi;
        }
      }
    }
    const margin = (vmax - vmin) * (isOrcaShot ? 0.02 : (isHumpbackShot ? 0.03 : 0.04));
    vmin -= margin;
    vmax += margin;

    const rasW = Math.max(1, Math.floor(plotW));
    const rasH = Math.max(1, Math.floor(plotH));
    const off = document.createElement("canvas");
    off.width = rasW;
    off.height = rasH;
    const offCtx = off.getContext("2d");
    const img = offCtx.createImageData(rasW, rasH);
    for (let px = 0; px < rasW; px += 1) {
      const tLin = graphTimeRange.start + ((px + 0.5) / rasW) * (graphTimeRange.end - graphTimeRange.start);
      let lo = 0;
      let hi = tSpec.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (tSpec[mid] < tLin) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      let ti = lo;
      if (ti > 0 && Math.abs(tSpec[ti - 1] - tLin) < Math.abs(tSpec[ti] - tLin)) {
        ti -= 1;
      }
      ti = clamp(ti, 0, nt - 1);
      for (let py = 0; py < rasH; py += 1) {
        const fn = fiHi - (py / Math.max(1, rasH - 1)) * (nFreqDraw - 1);
        const fiInt = clamp(Math.floor(fn), 0, nf - 1);
        let db = spectrogramValue(sxx, nf, nt, fiInt, ti, fortran);
        if (isOrcaShot) {
          // Lightweight background suppression: remove per-frequency baseline over current interval.
          db -= freqBaseline[fiInt];
        } else if (isHumpbackShot) {
          // Lighter suppression than Orca to preserve broader low-mid humpback structure.
          db -= 0.65 * freqBaseline[fiInt];
        }
        const [r, g, b] = colorForSpecDbRgb(db, vmin, vmax);
        const o = (py * rasW + px) * 4;
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    }
    offCtx.putImageData(img, 0, 0);
    ctx.drawImage(off, pad.left, pad.top, plotW, plotH);

    const cursorNorm = (selchCursorTime - graphTimeRange.start) / Math.max(1e-9, graphTimeRange.end - graphTimeRange.start);
    const cursorX = pad.left + clamp(cursorNorm, 0, 1) * plotW;
    ctx.strokeStyle = "rgba(114, 246, 255, 0.35)";
    ctx.strokeRect(pad.left, pad.top, plotW, plotH);
    ctx.strokeStyle = "rgba(255, 230, 109, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorX, pad.top);
    ctx.lineTo(cursorX, pad.top + plotH);
    ctx.stroke();

    ctx.fillStyle = "#9fb3d9";
    ctx.font = "11px Space Grotesk";
    ctx.fillText(`${graphTimeRange.start.toFixed(2)} s`, pad.left, height - 5);
    ctx.fillText(`${graphTimeRange.end.toFixed(2)} s`, pad.left + plotW - 54, height - 5);
    ctx.save();
    ctx.translate(10, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Frequency", 0, 0);
    ctx.restore();
  }

  function drawBand() {
    const canvas = el.selchBandCanvas;
    const { ctx, width, height } = getCanvasSize(canvas, 116);
    ctx.fillStyle = "rgba(8, 15, 31, 0.88)";
    ctx.fillRect(0, 0, width, height);
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const { t: tb, score, mask, threshold } = sc.band;
    const i0b = lowerBoundSorted(tb, graphTimeRange.start);
    const i1b = upperBoundSorted(tb, graphTimeRange.end) - 1;

    if (mask && mask.length === score.length) {
      for (let px = 0; px < plotW; px += 1) {
        const tLin = graphTimeRange.start + ((px + 0.5) / plotW) * (graphTimeRange.end - graphTimeRange.start);
        let lo = 0;
        let hi = tb.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (tb[mid] < tLin) {
            lo = mid + 1;
          } else {
            hi = mid;
          }
        }
        let idx = lo;
        if (idx > 0 && Math.abs(tb[idx - 1] - tLin) < Math.abs(tb[idx] - tLin)) {
          idx -= 1;
        }
        idx = clamp(idx, 0, tb.length - 1);
        if (mask[idx]) {
          ctx.fillStyle = "rgba(114, 246, 255, 0.14)";
          ctx.fillRect(pad.left + px, pad.top, 1, plotH);
        }
      }
    }

    const bandRange = robustRangeFromSeries(score, i0b, i1b, {
      qLo: 0.01,
      qHi: 0.995,
      includeValue: threshold
    });
    const ymin = bandRange.min;
    const ymax = bandRange.max;

    ctx.strokeStyle = "rgba(114, 246, 255, 0.35)";
    ctx.strokeRect(pad.left, pad.top, plotW, plotH);

    ctx.beginPath();
    ctx.strokeStyle = "rgba(156, 255, 87, 0.9)";
    ctx.lineWidth = 1.4;
    let started = false;
    const nBand = Math.max(0, i1b - i0b + 1);
    const bandStep = Math.max(1, Math.floor(nBand / Math.ceil(plotW * 4)));
    for (let i = i0b; i <= i1b; i += bandStep) {
      const t = tb[i];
      const x = pad.left + ((t - graphTimeRange.start) / Math.max(1e-9, graphTimeRange.end - graphTimeRange.start)) * plotW;
      const y = pad.top + (1 - (score[i] - ymin) / Math.max(1e-9, ymax - ymin)) * plotH;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    if (Number.isFinite(threshold)) {
      const ty = pad.top + (1 - (threshold - ymin) / Math.max(1e-9, ymax - ymin)) * plotH;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "rgba(255, 107, 135, 0.88)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(pad.left, ty);
      ctx.lineTo(pad.left + plotW, ty);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const cursorNormB = (selchCursorTime - graphTimeRange.start) / Math.max(1e-9, graphTimeRange.end - graphTimeRange.start);
    const cursorXB = pad.left + clamp(cursorNormB, 0, 1) * plotW;
    ctx.strokeStyle = "rgba(255, 230, 109, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorXB, pad.top);
    ctx.lineTo(cursorXB, pad.top + plotH);
    ctx.stroke();

  }

  function drawWave() {
    const canvas = el.selchWaveCanvas;
    const { ctx, width, height } = getCanvasSize(canvas, 96);
    ctx.fillStyle = "rgba(8, 15, 31, 0.88)";
    ctx.fillRect(0, 0, width, height);
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const { t: tw, y: yw } = sc.signal;
    const i0w = lowerBoundSorted(tw, graphTimeRange.start);
    const i1w = upperBoundSorted(tw, graphTimeRange.end) - 1;

    if (i1w < i0w) {
      ctx.fillStyle = "#9fb3d9";
      ctx.font = "12px Space Grotesk";
      ctx.fillText("No waveform samples in interval.", pad.left, pad.top + 24);
    } else {
      const waveRange = robustRangeFromSeries(yw, i0w, i1w, { qLo: 0.001, qHi: 0.999 });
      const ymin = waveRange.min;
      const ymax = waveRange.max;
      ctx.strokeStyle = "rgba(114, 246, 255, 0.35)";
      ctx.strokeRect(pad.left, pad.top, plotW, plotH);
      const n = i1w - i0w + 1;
      const maxPts = Math.ceil(plotW * 4);
      const step = Math.max(1, Math.floor(n / maxPts));
      ctx.beginPath();
      ctx.strokeStyle = "rgba(114, 246, 255, 0.85)";
      ctx.lineWidth = 1.2;
      let startedW = false;
      for (let i = i0w; i <= i1w; i += step) {
        const t = tw[i];
        const x = pad.left + ((t - graphTimeRange.start) / Math.max(1e-9, graphTimeRange.end - graphTimeRange.start)) * plotW;
        const y = pad.top + (1 - (yw[i] - ymin) / Math.max(1e-9, ymax - ymin)) * plotH;
        if (!startedW) {
          ctx.moveTo(x, y);
          startedW = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }

    const cursorNormW = (selchCursorTime - graphTimeRange.start) / Math.max(1e-9, graphTimeRange.end - graphTimeRange.start);
    const cursorXW = pad.left + clamp(cursorNormW, 0, 1) * plotW;
    ctx.strokeStyle = "rgba(255, 230, 109, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorXW, pad.top);
    ctx.lineTo(cursorXW, pad.top + plotH);
    ctx.stroke();
  }

  drawSpec();
  drawBand();
  drawWave();

  const dist = sc.meta?.selected_distance_m;
  const distStr = Number.isFinite(dist) ? ` · ~${dist.toFixed(1)} m along cable` : "";
  const bh = sc.band.bandHz;
  const bandStr = bh ? `${bh[0].toFixed(0)}–${bh[1].toFixed(0)} Hz band` : "Band-pass support";
  el.selchCaption.textContent = `${bandStr}. Full channel axis ${fullTimeRange.start.toFixed(2)}–${fullTimeRange.end.toFixed(2)} s, cursor ${selchCursorTime.toFixed(2)} s${distStr}.`;

  state.geometry.selch = {
    interval,
    timeStart: graphTimeRange.start,
    timeEnd: graphTimeRange.end,
    pad,
    plotW: selchPlotW
  };
}

function renderAllPanels() {
  syncCursorToInterval();
  updateCurrentIntervalLabel();
  updatePlaybackLabel();
  renderActiveEventLabel();
  renderDasPanel();
  renderSelectedChannelPanel();
  renderHydroPanel();
  renderEventNavigation();
  updateMapShotSummary();
  updateMapSnapshotPanel();
}

function applyIntervalSelection(statusMessage = null) {
  if (!state.shotBundle) {
    return;
  }
  const interval = getCurrentInterval();
  syncIntervalInputs(interval);
  syncCursorToInterval();
  renderAllPanels();
  if (statusMessage) {
    updateDataStatus(statusMessage);
  }
}

function resetIntervalToRecommended() {
  if (!state.shotBundle) {
    return;
  }
  const recommended = getRecommendedInterval();
  syncIntervalInputs(recommended);
  state.cursorTime = recommended.start;
  renderAllPanels();
  updateDataStatus(`Interval reset to recommended ${recommended.start.toFixed(2)}-${recommended.end.toFixed(2)} s.`);
}

function seekCursorToTime(targetTime, sourceLabel, options = {}) {
  if (!Number.isFinite(targetTime)) {
    return;
  }
  const { announce = true, deferred = true } = options;
  const interval = getCurrentInterval();
  state.cursorTime = clamp(targetTime, interval.start, interval.end);
  if (deferred) {
    scheduleMainRender();
  } else {
    renderAllPanels();
  }
  if (announce) {
    updateDataStatus(`Cursor moved to ${state.cursorTime.toFixed(2)} s via ${sourceLabel}.`);
  }
}

function seekSelchCursorToTime(targetTime, sourceLabel, options = {}) {
  if (!Number.isFinite(targetTime)) {
    return;
  }
  const { announce = true } = options;
  const geo = state.geometry.selch;
  const fallbackRange = getSelectedChannelFullTimeRange(state.shotBundle?.selectedChannel);
  const timeStart = Number.isFinite(geo?.timeStart) ? geo.timeStart : fallbackRange.start;
  const timeEnd = Number.isFinite(geo?.timeEnd) ? geo.timeEnd : fallbackRange.end;
  state.selchCursorTime = clamp(targetTime, timeStart, timeEnd);
  renderSelectedChannelPanel();
  renderHydroPanel();
  if (announce) {
    updateDataStatus(`Selected DAS channel cursor moved to ${state.selchCursorTime.toFixed(2)} s via ${sourceLabel}.`);
  }
}

function seekFromDasPointer(event) {
  const hit = hitTestDas(event);
  if (!hit) {
    return;
  }
  seekCursorToTime(hit.time, "DAS view", {
    announce: false,
    deferred: true
  });
}

function hitTestSelchTime(event) {
  const geo = state.geometry.selch;
  if (!geo || !geo.plotW) {
    return null;
  }
  const x = event.offsetX;
  if (x < geo.pad.left || x > geo.pad.left + geo.plotW) {
    return null;
  }
  const timeStart = Number.isFinite(geo.timeStart) ? geo.timeStart : geo.interval.start;
  const timeEnd = Number.isFinite(geo.timeEnd) ? geo.timeEnd : geo.interval.end;
  const t =
    timeStart +
    ((x - geo.pad.left) / Math.max(1e-9, geo.plotW)) * (timeEnd - timeStart);
  return {
    time: t,
    clientX: event.clientX,
    clientY: event.clientY
  };
}

function seekFromSelchPointer(event) {
  const hit = hitTestSelchTime(event);
  if (!hit) {
    return;
  }
  seekSelchCursorToTime(hit.time, "selected-channel view", { announce: false });
}

function bindSelchCanvas(canvas) {
  canvas.addEventListener("mousedown", (event) => {
    state.draggingTarget = "selch";
    seekFromSelchPointer(event);
  });
  canvas.addEventListener("click", (event) => {
    const hit = hitTestSelchTime(event);
    if (!hit) {
      return;
    }
    seekSelchCursorToTime(hit.time, "selected-channel view", { announce: true });
  });
  canvas.addEventListener(
    "mousemove",
    (event) => {
      if (state.draggingTarget === "selch") {
        seekFromSelchPointer(event);
      }
    },
    { passive: true }
  );
}

function onGlobalPointerUp(event) {
  const wasMapDrag = state.draggingTarget === "map";
  if (state.draggingTarget === "map" && state.mapPointerDown && !state.mapPointerDown.moved && event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    tryMapClickSelectChannel(event.clientX, event.clientY);
  }
  state.draggingTarget = null;
  state.mapPointerDown = null;
  state.mapPanDX = 0;
  state.mapPanDY = 0;
  state.mapPanLastRenderTs = 0;
  if (el.mapSvg) {
    el.mapSvg.style.cursor = "grab";
  }
  if (wasMapDrag) {
    scheduleMapRender();
  }
}

function getManifestCandidateUrls(shotOption) {
  const urls = [];
  const seen = new Set();
  const push = (u) => {
    if (u && !seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  };

  /* Prefer the locked output base if we already discovered one. */
  const locked = assetResolver.lockedBases.output;
  const bases = locked
    ? [locked, ...ASSET_BASE_CANDIDATES.output.filter((b) => b !== locked)]
    : ASSET_BASE_CANDIDATES.output.slice();

  if (shotOption.manifestPath) {
    if (shotOption.manifestPath.startsWith("http")) {
      push(shotOption.manifestPath);
    } else {
      /* viewer_index lists e.g. "output/shots/<id>/viewer_manifest.json".
       * That leading "output/" is doubled if naively joined with an output
       * base. Try both with and without the prefix to stay robust. */
      const rel = _normalizeRel(shotOption.manifestPath);
      const stripped = rel.startsWith("output/") ? rel.slice("output/".length) : rel;
      bases.forEach((base) => {
        push(`${base}/${stripped}`);
        if (stripped !== rel) {
          push(`${base}/${rel}`);
        }
      });
    }
  }

  bases.forEach((base) => {
    push(`${base}/shots/${shotOption.shotId}/viewer_manifest.json`);
  });

  return urls;
}

function getBaseDir(url) {
  const idx = url.lastIndexOf("/");
  return idx >= 0 ? url.slice(0, idx) : "";
}

function buildMetaFromChannelEntry(entry) {
  if (!entry) {
    return {};
  }
  return {
    selected_channel_label: entry.label,
    selected_preview_col: entry.preview_col,
    selected_raw_channel: entry.raw_das_channel_index,
    selected_distance_m: entry.distance_m
  };
}

function buildSelectedChannelPayloadFromNpz(signalNpz, specNpz, bandNpz) {
  const tSigRec = signalNpz.t_s;
  const sigRec = signalNpz.signal;
  if (!tSigRec?.data || !sigRec?.data) {
    throw new Error("signal NPZ missing t_s/signal arrays");
  }

  const tSpecRec = specNpz.t_s;
  const freqRec = specNpz.freqs_hz;
  const sxxRec = specNpz.Sxx_db;
  if (!tSpecRec?.data || !freqRec?.data || !sxxRec?.data) {
    throw new Error("spectrogram NPZ incomplete");
  }

  const shape = sxxRec.shape || [];
  if (shape.length < 2) {
    throw new Error("Sxx_db must be 2-D");
  }
  const nf = shape[0];
  const nt = shape[1];
  if (tSpecRec.shape[0] !== nt || freqRec.shape[0] !== nf) {
    console.warn("Spectrogram axis lengths do not match Sxx_db shape; continuing.");
  }

  const tBandRec = bandNpz.t_s;
  const scoreRec = bandNpz.bandpass_support_score;
  if (!tBandRec?.data || !scoreRec?.data) {
    throw new Error("band-pass NPZ incomplete");
  }

  let maskArr = null;
  if (bandNpz.signal_present_mask?.data) {
    maskArr = bandNpz.signal_present_mask.data;
  }

  let threshold = null;
  if (bandNpz.threshold?.data?.length) {
    threshold = Number(bandNpz.threshold.data[0]);
  }

  let bandHz = null;
  if (bandNpz.band_hz?.data && bandNpz.band_hz.shape[0] >= 2) {
    bandHz = [Number(bandNpz.band_hz.data[0]), Number(bandNpz.band_hz.data[1])];
  }

  let signalFs = null;
  if (signalNpz.fs_hz?.data?.length) {
    signalFs = Number(signalNpz.fs_hz.data[0]);
  }

  let bandpassAudio = null;
  const bpWf = signalNpz.bandpass_waveform;
  if (bpWf?.data?.length && tSigRec.data?.length && bpWf.data.length === tSigRec.data.length && Number.isFinite(signalFs)) {
    bandpassAudio = {
      t: tSigRec.data,
      y: bpWf.data,
      fs: signalFs
    };
  }

  return {
    signal: {
      t: tSigRec.data,
      y: sigRec.data
    },
    signalFs,
    bandpassAudio,
    spec: {
      t: tSpecRec.data,
      freqs: freqRec.data,
      sxx: sxxRec.data,
      nf,
      nt,
      fortran: !!sxxRec.fortran
    },
    band: {
      t: tBandRec.data,
      score: scoreRec.data,
      mask: maskArr,
      threshold,
      bandHz
    }
  };
}

async function loadSelectedChannelNpzTriple(baseDir, sigRel, specRel, bandRel) {
  if (!sigRel || !specRel || !bandRel) {
    throw new Error("Missing NPZ path for selected-channel triple");
  }
  const [signalNpz, specNpz, bandNpz] = await Promise.all([
    fetchNpz(`${baseDir}/${sigRel}`),
    fetchNpz(`${baseDir}/${specRel}`),
    fetchNpz(`${baseDir}/${bandRel}`)
  ]);
  return buildSelectedChannelPayloadFromNpz(signalNpz, specNpz, bandNpz);
}

function applySelectedChannelPayload(sc, payload, entry) {
  sc.signal = payload.signal;
  sc.spec = payload.spec;
  sc.band = payload.band;
  sc.signalFs = payload.signalFs;
  sc.bandpassAudio = payload.bandpassAudio;
  if (entry) {
    sc.meta = buildMetaFromChannelEntry(entry);
  }
}

async function loadSelectedChannelIfPresent(manifest, manifestUrl) {
  const files = manifest?.files || {};
  const demo = manifest?.selected_channel_demo || null;

  if (manifest?.selected_channel_mode_available === false) {
    return {
      available: false,
      message: "Selected DAS channel is not available for this shot (manifest flag)."
    };
  }

  const baseDir = getBaseDir(manifestUrl);
  const selectedIndexRel = files.selected_channels_index || "selected_channels_index.json";
  const selectedBundleRel = files.selected_channel_bundle || "selected_channel_bundle.json";

  // Frontend compatibility: support selected-channel exports even when
  // viewer_manifest.json has not yet been patched with selected_channel_* keys.
  const index = await fetchJsonFromManifestPaths(baseDir, selectedIndexRel);
  if (index && Array.isArray(index.channels) && index.channels.length > 0) {
    const channels = index.channels;
    const entryByCol = {};
    channels.forEach((ch) => {
      if (ch && Number.isFinite(ch.preview_col)) {
        entryByCol[String(ch.preview_col)] = ch;
      }
    });
    const defaultCol = Number(
      index.default_preview_col ?? demo?.default_preview_col ?? demo?.preview_column ?? channels[0].preview_col
    );
    const defaultEntry = entryByCol[String(defaultCol)];
    if (!defaultEntry?.files) {
      return { available: false, message: `Default preview col ${defaultCol} missing from selected-channels index.` };
    }
    try {
      const f = defaultEntry.files;
      const payload = await loadSelectedChannelNpzTriple(baseDir, f.signal, f.spectrogram, f.bandpass_score);
      return {
        available: true,
        multiChannel: channels.length > 1,
        baseDir,
        manifestDemo:
          demo || {
            mode: "v2",
            default_preview_col: defaultCol,
            available_preview_cols: channels
              .map((ch) => ch?.preview_col)
              .filter((value) => Number.isFinite(value))
          },
        channelsIndex: index,
        entryByCol,
        activePreviewCol: defaultCol,
        channelCache: {
          [String(defaultCol)]: payload
        },
        meta: buildMetaFromChannelEntry(defaultEntry),
        ...payload
      };
    } catch (error) {
      return {
        available: false,
        message: `Selected-channel NPZ load failed: ${summarizeError(error)}`
      };
    }
  }

  let meta;
  try {
    meta = await fetchJsonFromManifestPaths(baseDir, selectedBundleRel);
    if (!meta) {
      return {
        available: false,
        message: "Selected DAS channel is not available for this shot (bundle/index files not found)."
      };
    }
  } catch (error) {
    return { available: false, message: `Could not load selected-channel bundle: ${summarizeError(error)}` };
  }

  const sigRel = files.selected_channel_signal || meta?.bundle_files?.signal_npz || "selected_channel_signal.npz";
  const specRel =
    files.selected_channel_spectrogram || meta?.bundle_files?.spectrogram_npz || "selected_channel_spectrogram.npz";
  const bandRel =
    files.selected_channel_bandpass_score || meta?.bundle_files?.bandpass_score_npz || "selected_channel_bandpass_score.npz";

  if (!sigRel || !specRel || !bandRel) {
    return { available: false, message: "Selected-channel export paths are incomplete in the manifest." };
  }

  try {
    const payload = await loadSelectedChannelNpzTriple(baseDir, sigRel, specRel, bandRel);
    return {
      available: true,
      multiChannel: false,
      baseDir,
      manifestDemo:
        demo || {
          mode: "v1",
          preview_column: meta?.selected_preview_col,
          raw_das_channel: meta?.selected_raw_channel,
          band_hz: meta?.recommended_bandpass_hz,
          channel_label: meta?.selected_channel_label,
          notes: ["Loaded from selected_channel_bundle.json auto-discovery (manifest keys optional)."]
        },
      meta,
      ...payload
    };
  } catch (error) {
    return {
      available: false,
      message: `Selected-channel NPZ load failed: ${summarizeError(error)}`
    };
  }
}

async function switchSelectedChannelToPreviewCol(previewCol) {
  const sc = state.shotBundle?.selectedChannel;
  if (!sc?.available || !sc.multiChannel) {
    return;
  }
  stopSelchDemoAudio();
  const key = String(previewCol);
  const entry = sc.entryByCol?.[key];
  if (!entry?.files) {
    return;
  }
  if (sc.activePreviewCol === previewCol) {
    scheduleMainRender();
    scheduleMapRender();
    return;
  }
  const cached = sc.channelCache[key];
  if (cached) {
    applySelectedChannelPayload(sc, cached, entry);
    sc.activePreviewCol = previewCol;
    if (el.selchChannelSelect) {
      el.selchChannelSelect.value = key;
    }
    scheduleMainRender();
    scheduleMapRender();
    return;
  }
  updateDataStatus(`Loading selected-channel preview col ${previewCol}…`);
  try {
    const f = entry.files;
    const payload = await loadSelectedChannelNpzTriple(sc.baseDir, f.signal, f.spectrogram, f.bandpass_score);
    sc.channelCache[key] = payload;
    applySelectedChannelPayload(sc, payload, entry);
    sc.activePreviewCol = previewCol;
    if (el.selchChannelSelect) {
      el.selchChannelSelect.value = key;
    }
    updateDataStatus(`Selected-channel preview col ${previewCol} loaded.`);
    scheduleMainRender();
    scheduleMapRender();
  } catch (error) {
    updateDataStatus(`Selected-channel load failed: ${summarizeError(error)}`);
  }
}

async function loadManifestForShot(shotOption) {
  const candidates = getManifestCandidateUrls(shotOption);
  const result = await tryLoadJsonFromUrls(candidates);
  if (result.url && !assetResolver.lockedBases.output) {
    /* Infer the output base from the manifest URL by stripping the
     * "/shots/<id>/viewer_manifest.json" tail. */
    const m = result.url.match(/^(.*)\/shots\/[^/]+\/viewer_manifest\.json$/);
    if (m && m[1]) {
      assetResolver.lockedBases.output = m[1];
      console.info(`[asset:output] base locked → ${m[1]} (via manifest)`);
    }
  }
  if (result.url) {
    console.info(`[manifest] ${shotOption.shotId} loaded from ${result.url}`);
  } else {
    console.error(`[manifest] ${shotOption.shotId} failed; tried`, candidates);
  }
  return result;
}

async function loadBundleFromManifest(manifest, manifestUrl) {
  const baseDir = getBaseDir(manifestUrl);
  const files = manifest?.files || {};
  const missingCompatibilityFiles = [];

  async function loadFile(fileKey) {
    const relative = files[fileKey];
    if (!relative) {
      missingCompatibilityFiles.push(`${fileKey}: key missing in manifest.files`);
      return null;
    }
    try {
      return await fetchJson(`${baseDir}/${relative}`);
    } catch (_) {
      missingCompatibilityFiles.push(`${fileKey}: ${relative}`);
      return null;
    }
  }

  const shotMetadata = await loadFile("shot_metadata");
  const recordersSummary = await loadFile("recorders_summary");
  const events = await loadFile("events");
  const hydroActivity = await loadFile("hydrophone_activity");
  const dasActivity = await loadFile("das_activity");
  const situation = await loadFile("situation");

  let sourceAudioCompare = null;
  const compareRel = files.source_audio_compare || files.orca_audio_compare;
  if (compareRel) {
    try {
      const doc = await fetchJson(`${baseDir}/${compareRel}`);
      if (doc && doc.schema_version === "orca_audio_compare_v1") {
        sourceAudioCompare = { doc, baseDir };
      }
    } catch (_) {
      sourceAudioCompare = null;
    }
  }

  return {
    shotMetadata,
    recordersSummary,
    events,
    hydroActivity,
    dasActivity,
    situation,
    sourceAudioCompare,
    orcaAudioCompare: sourceAudioCompare,
    missingCompatibilityFiles,
    mode: "full"
  };
}

async function loadFallbackBundle(shotId) {
  const shotMetadataRes = await tryLoadJsonFromCandidates(`shots/${shotId}/shot_metadata.json`, SAMPLE_BASE_CANDIDATES);
  const recordersRes = await tryLoadJsonFromCandidates(`shots/${shotId}/recorders_summary.json`, SAMPLE_BASE_CANDIDATES);
  const eventsRes = await tryLoadJsonFromCandidates(`shots/${shotId}/events.json`, SAMPLE_BASE_CANDIDATES);

  if (!shotMetadataRes.data && !eventsRes.data) {
    return null;
  }

  return {
    shotMetadata: shotMetadataRes.data,
    recordersSummary: recordersRes.data,
    events: eventsRes.data,
    hydroActivity: null,
    dasActivity: null,
    situation: null,
    mode: "fallback"
  };
}

function applyIntervalDefaults() {
  const recommended = getRecommendedInterval();
  syncIntervalInputs(recommended);
  state.cursorTime = recommended.start;
  updateCurrentIntervalLabel();
}

function updateHoverTooltipFromDAS(event) {
  scheduleHoverTooltip("das", event, (latestEvent) => {
    const hit = hitTestDas(latestEvent);
    if (!hit) {
      state.hover.das = null;
      hideTooltip();
      return;
    }

    const isWaterfall = hit.mode === "waterfall";
    const axisLine = isWaterfall
      ? `Raw channel ${Number(hit.channel).toFixed(0)}`
      : `Distance ${hit.distance.toFixed(1)} m`;
    const timeLine = isWaterfall && Number.isFinite(Number(hit.sampleOffset))
      ? `Sample ${formatWaterfallAxisNumber(Number(hit.sampleOffset))} (${hit.time.toFixed(2)} s)`
      : `Time ${hit.time.toFixed(2)} s`;
    const valueLine = isWaterfall
      ? `Amplitude ${Number(hit.value).toFixed(3)}`
      : `Normalized activity ${Number(hit.value).toFixed(3)}`;
    showTooltip(
      isWaterfall ? "DAS waterfall" : "DAS activity",
      `${timeLine}<br>${axisLine}<br>${valueLine}<br>Interval ${getCurrentInterval().start.toFixed(2)}-${getCurrentInterval().end.toFixed(2)} s`,
      hit.clientX,
      hit.clientY
    );
  });
}

function updateHoverTooltipFromHydro(event) {
  scheduleHoverTooltip("hydro", event, (latestEvent) => {
    const hit = hitTestHydro(latestEvent);
    if (!hit) {
      state.hover.hydro = null;
      hideTooltip();
      return;
    }

    showTooltip(
      "Hydrophone reference activity",
      `Time ${hit.time.toFixed(2)} s<br>Reference score ${hit.score.toFixed(2)} dB<br>${Number.isFinite(hit.threshold) ? (hit.score >= hit.threshold ? "Above threshold" : "Below threshold") : "Baseline reference"}<br>Shown with selected DAS timeline`,
      hit.clientX,
      hit.clientY
    );
  });
}

async function onShotChanged() {
  const selectedShotId = el.shotSelect.value;
  const shotOption = state.shotOptions.find((option) => option.shotId === selectedShotId);
  const loadSeq = state.shotLoadSeq + 1;
  state.shotLoadSeq = loadSeq;
  state.selectedShotId = selectedShotId;
  state.selectedManifest = null;
  state.manifestSource = null;
  state.shotBundle = null;
  state.eventCount = null;
  hideTooltip();
  renderDasStatusMessage("Loading synchronized bundle...", "Loading synchronized DAS context...");

  if (!shotOption) {
    updateDataStatus("No shot option selected.");
    return;
  }

  setPlayback(false);
  stopSelchDemoAudio();
  updateDataStatus(`Loading synchronized bundle for ${selectedShotId}...`);

  const manifestResult = await loadManifestForShot(shotOption);
  if (loadSeq !== state.shotLoadSeq || state.selectedShotId !== selectedShotId) {
    return;
  }
  state.selectedManifest = manifestResult.data;
  state.manifestSource = manifestResult.url;

  try {
    if (manifestResult.data && manifestResult.url) {
      const bundle = await loadBundleFromManifest(manifestResult.data, manifestResult.url);
      if (loadSeq !== state.shotLoadSeq || state.selectedShotId !== selectedShotId) {
        return;
      }
      await attachMainPanelsFromNpzFallback(manifestResult.data, manifestResult.url, bundle);
      if (loadSeq !== state.shotLoadSeq || state.selectedShotId !== selectedShotId) {
        return;
      }
      bundle.selectedChannel = await loadSelectedChannelIfPresent(manifestResult.data, manifestResult.url);
      if (loadSeq !== state.shotLoadSeq || state.selectedShotId !== selectedShotId) {
        return;
      }
      state.shotBundle = bundle;
      resetMapViewport();
      resetMapTimelineForShot();
      state.eventCount = getEventList().length;
      applyIntervalDefaults();
      renderManifestMetadata();
      renderAllPanels();
      scheduleMapRender();
      scheduleDasWaterfallPrefetch();
      if (state.shotBundle.missingCompatibilityFiles?.length) {
        updateDataStatus(
          `Loaded synchronized viewer bundle for ${selectedShotId}, but missing compatibility files: ${state.shotBundle.missingCompatibilityFiles.join(", ")}.`
        );
      } else {
        updateDataStatus(`Loaded synchronized viewer bundle for ${selectedShotId}.`);
      }
      return;
    }

    const fallbackBundle = await loadFallbackBundle(selectedShotId);
    if (loadSeq !== state.shotLoadSeq || state.selectedShotId !== selectedShotId) {
      return;
    }
    if (fallbackBundle) {
      state.shotBundle = fallbackBundle;
      state.shotBundle.selectedChannel = {
        available: false,
        message: "Selected DAS channel is not available for this shot."
      };
      resetMapViewport();
      resetMapTimelineForShot();
      state.selectedManifest = null;
      state.manifestSource = null;
      state.eventCount = getEventList().length;
      applyIntervalDefaults();
      renderManifestMetadata();
      renderAllPanels();
      scheduleMapRender();
      updateDataStatus(`Loaded fallback metadata bundle for ${selectedShotId}; panel rendering uses metadata where full exports are unavailable.`);
      return;
    }

    state.shotBundle = null;
    state.eventCount = null;
    if (el.eventNav) {
      el.eventNav.innerHTML = "";
    }
    el.dasCaption.textContent = "No synchronized data loaded.";
    el.hydroCaption.textContent = "No synchronized data loaded.";
    el.mapCaption.textContent = "No synchronized data loaded.";
    updateDataStatus(`No viewer-compatible files found for ${selectedShotId}.`);
  } catch (error) {
    state.shotBundle = null;
    state.eventCount = null;
    updateDataStatus(`Failed to load shot ${selectedShotId}: ${summarizeError(error)}`);
  }
}

function handleIntervalInputChange() {
  if (!state.shotBundle) {
    return;
  }
  applyIntervalSelection();
}

function bindEvents() {
  el.startInput.addEventListener("change", handleIntervalInputChange);
  el.endInput.addEventListener("change", handleIntervalInputChange);
  el.startInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      applyIntervalSelection("Interval applied from input fields.");
    }
  });
  el.endInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      applyIntervalSelection("Interval applied from input fields.");
    }
  });
  el.intervalApplyBtn.addEventListener("click", () => {
    applyIntervalSelection("Interval applied.");
  });
  el.intervalResetBtn.addEventListener("click", resetIntervalToRecommended);
  el.shotSelect.addEventListener("change", onShotChanged);
  el.dasModeActivity?.addEventListener("click", () => setDasViewMode("activity"));
  el.dasModeWaterfall?.addEventListener("click", () => setDasViewMode("waterfall"));

  el.dasCanvas.addEventListener("mousemove", updateHoverTooltipFromDAS, { passive: true });
  el.dasCanvas.addEventListener("mousedown", (event) => {
    state.draggingTarget = "das";
    seekFromDasPointer(event);
  });
  el.dasCanvas.addEventListener("click", (event) => {
    const hit = hitTestDas(event);
    if (!hit) {
      return;
    }
    seekCursorToTime(hit.time, "DAS view", {
      announce: true,
      deferred: false
    });
  });
  el.dasCanvas.addEventListener("mousemove", (event) => {
    if (state.draggingTarget === "das") {
      seekFromDasPointer(event);
    }
  }, { passive: true });
  el.dasCanvas.addEventListener("mouseleave", () => {
    hideTooltip();
  }, { passive: true });

  el.hydroSvg.addEventListener("mousemove", updateHoverTooltipFromHydro, { passive: true });
  el.hydroSvg.addEventListener("mouseleave", () => {
    hideTooltip();
  }, { passive: true });

  bindSelchCanvas(el.selchSpecCanvas);
  bindSelchCanvas(el.selchBandCanvas);
  bindSelchCanvas(el.selchWaveCanvas);

  if (el.selchChannelSelect) {
    el.selchChannelSelect.addEventListener("change", () => {
      const v = Number(el.selchChannelSelect.value);
      if (!Number.isFinite(v)) {
        return;
      }
      void switchSelectedChannelToPreviewCol(v);
    });
  }

  if (el.selchPlayDasAudio) {
    el.selchPlayDasAudio.addEventListener("click", () => {
      startSelchDasPlayback();
    });
  }
  if (el.selchPlaySourceAudio) {
    el.selchPlaySourceAudio.addEventListener("click", () => {
      void playSelchSourceReference();
    });
  }
  if (el.selchStopAudio) {
    el.selchStopAudio.addEventListener("click", () => {
      stopSelchDemoAudio();
    });
  }
  if (el.selchAudioScrubber) {
    el.selchAudioScrubber.addEventListener("input", () => {
      const t = Number(el.selchAudioScrubber.value);
      if (!Number.isFinite(t)) {
        return;
      }
      state.selchCursorTime = t;
      renderSelectedChannelPanel();
      renderHydroPanel();
    });
  }

  el.mapSvg.addEventListener("dblclick", onMapDoubleClick);
  el.mapSvg.addEventListener("mousedown", onMapPointerDown);
  el.mapSvg.addEventListener("touchstart", onMapTouchStart, { passive: false });
  el.mapSvg.addEventListener("touchmove", onMapTouchMove, { passive: false });
  el.mapSvg.addEventListener("touchend", onMapTouchEnd, { passive: true });
  el.mapSvg.addEventListener("touchcancel", onMapTouchEnd, { passive: true });

  window.addEventListener("mousemove", onMapPointerMove, { passive: true });
  window.addEventListener("mouseup", onGlobalPointerUp, { passive: true });

  bindMapControlHandlers();
  bindMapTimelineHandlers();
  bindMapZoomButtonHandlers();

  window.addEventListener("resize", () => {
    if (state.shotBundle) {
      renderAllPanels();
      scheduleMapRender();
    }
  });
}

async function initialize() {
  setPlayback(false);
  bindEvents();
  el.playBtn.disabled = true;
  el.pauseBtn.disabled = true;
  el.playbackStatus.textContent = "Cursor synced to selected interval; playback deferred to a later step.";

  updateDataStatus("Loading shot list from viewer index...");
  console.info(
    `[asset] page served from ${window.location.pathname}; probing bases`,
    ASSET_BASE_CANDIDATES
  );
  const indexLoad = await tryLoadJsonFromCandidates("viewer_index.json", OUTPUT_BASE_CANDIDATES);

  if (indexLoad.data) {
    state.shotOptions = parseIndexToShotOptions(indexLoad.data, indexLoad.url);
    updateDataStatus(`Loaded shot list from ${indexLoad.url}.`);
    console.info(
      `[asset] shots known: ${state.shotOptions.map((o) => o.shotId).join(", ") || "(none)"}`
    );
  } else {
    state.indexSource = null;
    state.shotOptions = SHOT_FALLBACK.map((shotId) => ({ shotId, manifestPath: null }));
    const triedShort = (indexLoad.tried || []).map((t) => t.url).slice(0, 4).join(", ");
    updateDataStatus(
      `viewer_index.json not found (tried: ${triedShort}). ` +
      "Using fallback shot list (whales_humpback, whales_orca). " +
      "Make sure output/ exists at the repo root and you started the server per site/README.md."
    );
  }

  renderShotOptions();
  if (state.shotOptions.length > 0) {
    el.shotSelect.value = state.shotOptions[0].shotId;
    await onShotChanged();
  }

  /* Diagnostics summary so it is obvious which paths actually worked. */
  const summary = assetResolver.summary();
  console.info("[asset] locked bases", summary.lockedBases);
  if (summary.failures.length > 0) {
    console.warn(
      `[asset] ${summary.failures.length} asset(s) had no candidate succeed:`,
      summary.failures.map((f) => `${f.kind}/${f.rel}`)
    );
  } else {
    console.info("[asset] all probed assets resolved.");
  }
}

initialize().catch((error) => {
  updateDataStatus(`Initialization failed: ${summarizeError(error)}`);
});
