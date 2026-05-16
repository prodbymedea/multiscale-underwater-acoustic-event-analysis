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
 * Diagnostics are kept in memory only:
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
    }
  }
}

async function _probeJson(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
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
  return { data: null, url: null, base: null, tried };
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
  playBtn: document.getElementById("play-btn"),
  pauseBtn: document.getElementById("pause-btn"),
  playbackStatus: document.getElementById("playback-status"),
  dataStatus: document.getElementById("data-status"),
  metaShot: document.getElementById("meta-shot"),
  metaTimeRange: document.getElementById("meta-time-range"),
  metaRecommended: document.getElementById("meta-recommended"),
  metaEventCount: document.getElementById("meta-event-count"),
  metaActiveEvent: document.getElementById("meta-active-event"),
  metaGroundTruth: document.getElementById("meta-ground-truth"),
  dasHeading: document.getElementById("das-heading"),
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
