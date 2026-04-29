const SHOT_FALLBACK = ["whales_humpback", "whales_orca"];
const OUTPUT_BASE_CANDIDATES = ["../output", "./data", "output"];
const SAMPLE_BASE_CANDIDATES = ["../output_samples", "output_samples"];
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
  playing: false,
  cursorTime: 0,
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
  selchChannelSelect: document.getElementById("selch-channel-select")
};

function updateDataStatus(message) {
  if (state.lastStatusMessage === message) {
    return;
  }
  state.lastStatusMessage = message;
  el.dataStatus.textContent = message;
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
  for (const base of baseCandidates) {
    const url = `${base}/${relativePath}`;
    try {
      const data = await fetchJson(url);
      return { data, url };
    } catch (_) {
      // Continue trying other candidates.
    }
  }
  return { data: null, url: null };
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
  el.metaCurrentInterval.textContent = `${formatSeconds(interval.start)} to ${formatSeconds(interval.end)}`;
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

  el.metaShot.textContent = shotId || "-";
  el.metaTimeRange.textContent = `${formatSeconds(timeExtent.start)} to ${formatSeconds(timeExtent.end)}`;
  el.metaRecommended.textContent = `${formatSeconds(recommended.start)} to ${formatSeconds(recommended.end)}`;
  el.metaEventCount.textContent = Number.isFinite(state.eventCount) ? String(state.eventCount) : "Unknown";
  el.metaGroundTruth.textContent = sourceGt.available ? "Available" : "Not available";
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

function renderDasPanel() {
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

  state.geometry.das = { t, distances, matrix, timeIndices, interval, pad, plotW, plotH, width, height };

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
  const interval = getCurrentInterval();
  const events = getEventList();
  const width = Math.max(640, Math.floor(el.hydroSvg.clientWidth || 1200));
  const height = Math.max(220, Math.floor(el.hydroSvg.clientHeight || 300));
  el.hydroSvg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  el.hydroSvg.setAttribute("preserveAspectRatio", "none");

  if (!Array.isArray(hydro?.t_s) || !Array.isArray(hydro?.score_db) || hydro.t_s.length < 2) {
    const timeExtent = getTimeExtentFromShotBundle(state.shotBundle);
    const visibleEvents = events.filter((event) => event.end_time_s >= timeExtent.start && event.start_time_s <= timeExtent.end);
    const outsideEvents = events.length - visibleEvents.length;

    const eventBars = visibleEvents.map((event) => {
      const padL = 80;
      const plotW = width - 120;
      const plotY = 70;
      const plotH = Math.max(90, height - 160);
      const x = padL + ((event.start_time_s - timeExtent.start) / Math.max(0.001, timeExtent.end - timeExtent.start)) * plotW;
      const w = ((event.end_time_s - event.start_time_s) / Math.max(0.001, timeExtent.end - timeExtent.start)) * plotW;
      return `<rect x="${x.toFixed(1)}" y="${plotY.toFixed(1)}" width="${Math.max(2, w).toFixed(1)}" height="${plotH.toFixed(1)}" fill="rgba(255,79,216,0.28)"></rect>`;
    }).join("");

    const padL = 80;
    const plotW = width - 120;
    const plotY = 70;
    const plotH = Math.max(90, height - 160);
    const intervalX = padL + ((interval.start - timeExtent.start) / Math.max(0.001, timeExtent.end - timeExtent.start)) * plotW;
    const intervalW = ((interval.end - interval.start) / Math.max(0.001, timeExtent.end - timeExtent.start)) * plotW;

    el.hydroSvg.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" fill="rgba(8,15,31,0.86)"></rect>
      <rect x="${padL}" y="${plotY}" width="${plotW}" height="${plotH}" fill="rgba(8,15,31,0.55)" stroke="rgba(114,246,255,0.25)"></rect>
      ${eventBars}
      <rect x="${intervalX.toFixed(1)}" y="${plotY}" width="${Math.max(2, intervalW).toFixed(1)}" height="${plotH}" fill="rgba(114,246,255,0.18)"></rect>
      <text x="92" y="52" fill="#9fb3d9" font-size="14">Hydrophone score timeseries unavailable. Showing interval + candidate-event guidance.</text>
      <text x="90" y="${Math.max(0, height - 22)}" fill="#9fb3d9" font-size="13">${timeExtent.start.toFixed(2)} s</text>
      <text x="${Math.max(90, width - 90)}" y="${Math.max(0, height - 22)}" fill="#9fb3d9" font-size="13">${timeExtent.end.toFixed(2)} s</text>
      ${outsideEvents > 0 ? `<text x="92" y="${Math.max(70, height - 42)}" fill="#ffd98b" font-size="12">${outsideEvents} event(s) are outside the visible timeline window.</text>` : ""}
    `;

    el.hydroCaption.textContent = `Hydrophone support score is unavailable for this shot. Interval sync and candidate-event guidance remain active.`;
    return;
  }

  const t = hydro.t_s;
  const y = hydro.score_db;
  const threshold = Number(hydro?.normalization?.threshold_db);
  const timeStart = t[0];
  const timeEnd = t[t.length - 1];
  const yMin = Math.min(...y) - 0.8;
  const yMax = Math.max(...y) + 0.8;

  const pad = { l: 72, r: 24, t: 18, b: 34 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;

  const xScale = (x) => pad.l + ((x - timeStart) / Math.max(0.001, timeEnd - timeStart)) * plotW;
  const yScale = (v) => pad.t + (1 - (v - yMin) / Math.max(0.001, yMax - yMin)) * plotH;

  state.geometry.hydro = { t, y, threshold, timeStart, timeEnd, yMin, yMax, pad, plotW, plotH, xScale, yScale };

  const path = t.map((time, index) => {
    const marker = index === 0 ? "M" : "L";
    return `${marker}${xScale(time).toFixed(2)},${yScale(y[index]).toFixed(2)}`;
  }).join(" ");

  const visibleEvents = events.filter((event) => event.end_time_s >= timeStart && event.start_time_s <= timeEnd);
  const outsideEvents = events.length - visibleEvents.length;

  const eventRects = visibleEvents
    .map((event) => {
      const x = xScale(event.start_time_s);
      const w = xScale(event.end_time_s) - x;
      return `<rect x="${x.toFixed(2)}" y="${pad.t}" width="${Math.max(2, w).toFixed(2)}" height="${plotH}" fill="rgba(255,79,216,0.12)"></rect>`;
    })
    .join("");

  const intervalX = xScale(interval.start);
  const intervalW = Math.max(2, xScale(interval.end) - intervalX);
  const cursorX = xScale(clamp(state.cursorTime, timeStart, timeEnd));

  const thresholdLine = Number.isFinite(threshold)
    ? `<line x1="${pad.l}" y1="${yScale(threshold).toFixed(2)}" x2="${width - pad.r}" y2="${yScale(threshold).toFixed(2)}" stroke="rgba(255,107,135,0.85)" stroke-dasharray="6 5" stroke-width="1.8"></line>`
    : "";

  el.hydroSvg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="rgba(8,15,31,0.88)"></rect>
    <rect x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}" fill="rgba(8,15,31,0.52)" stroke="rgba(114,246,255,0.2)"></rect>
    ${eventRects}
    <rect x="${intervalX.toFixed(2)}" y="${pad.t}" width="${intervalW.toFixed(2)}" height="${plotH}" fill="rgba(114,246,255,0.18)"></rect>
    ${thresholdLine}
    <path d="${path}" fill="none" stroke="rgba(114,246,255,0.28)" stroke-width="6"></path>
    <path d="${path}" fill="none" stroke="#72f6ff" stroke-width="2.75"></path>
    <line x1="${cursorX.toFixed(2)}" y1="${pad.t}" x2="${cursorX.toFixed(2)}" y2="${pad.t + plotH}" stroke="rgba(255,230,109,0.95)" stroke-width="2"></line>
    <line x1="${pad.l}" y1="${pad.t + plotH}" x2="${width - pad.r}" y2="${pad.t + plotH}" stroke="rgba(159,179,217,0.7)" stroke-width="1"></line>
    <text x="${pad.l}" y="${height - 10}" fill="#9fb3d9" font-size="13">${timeStart.toFixed(2)} s</text>
    <text x="${width - pad.r - 62}" y="${height - 10}" fill="#9fb3d9" font-size="13">${timeEnd.toFixed(2)} s</text>
    <text x="16" y="${pad.t + 14}" fill="#9fb3d9" font-size="13">dB</text>
    ${outsideEvents > 0 ? `<text x="${pad.l}" y="${Math.max(20, pad.t - 4)}" fill="#ffd98b" font-size="11">${outsideEvents} event(s) outside current hydro timeline.</text>` : ""}
  `;

  el.hydroCaption.textContent = `Hydrophone support score synchronized with interval ${interval.start.toFixed(2)}-${interval.end.toFixed(2)} s; candidate-event guidance overlay enabled.`;
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
  el.dataStatus.textContent = `Selected shot ${state.selectedShotId}; interval ${current.start.toFixed(2)}-${current.end.toFixed(2)} s; ${overlapCount} candidate event(s) overlap.`;
}

function hitTestDas(event) {
  const geo = state.geometry.das;
  if (!geo) {
    return null;
  }

  const { pad, plotW, plotH, timeIndices, distances, matrix } = geo;
  const x = event.offsetX;
  const y = event.offsetY;

  if (x < pad.left || x > pad.left + plotW || y < pad.top || y > pad.top + plotH) {
    return null;
  }

  const col = clamp(Math.floor(((x - pad.left) / plotW) * timeIndices.length), 0, timeIndices.length - 1);
  const rowFromTop = clamp(Math.floor(((y - pad.top) / plotH) * distances.length), 0, distances.length - 1);
  const row = distances.length - rowFromTop - 1;
  const timeIndex = timeIndices[col];
  const time = geo.t[timeIndex];
  const distance = distances[row];
  const value = matrix[timeIndex]?.[row] ?? 0;

  return {
    time,
    distance,
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

function drawSelchEventShading(ctx, pad, plotW, plotH, interval, events) {
  for (const event of events) {
    if (event.end_time_s < interval.start || event.start_time_s > interval.end) {
      continue;
    }
    const es = Math.max(event.start_time_s, interval.start);
    const ee = Math.min(event.end_time_s, interval.end);
    const x0 = pad.left + ((es - interval.start) / Math.max(1e-9, interval.end - interval.start)) * plotW;
    const x1 = pad.left + ((ee - interval.start) / Math.max(1e-9, interval.end - interval.start)) * plotW;
    ctx.fillStyle = "rgba(255, 79, 216, 0.12)";
    ctx.fillRect(x0, pad.top, Math.max(1, x1 - x0), plotH);
  }
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
    el.selchUnavailable.textContent = sc?.message || "Selected-channel mode not available for this shot.";
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
  const events = getEventList();
  const pad = { left: 56, right: 8, top: 4, bottom: 18 };
  let selchPlotW = 0;

  el.selchSubtitle.textContent =
    sc.meta?.selected_channel_label ||
    `Preview col ${sc.meta?.selected_preview_col}, raw ch ${sc.meta?.selected_raw_channel}`;

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

    const i0s = lowerBoundSorted(tSpec, interval.start);
    const i1s = upperBoundSorted(tSpec, interval.end) - 1;
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
      const tLin = interval.start + ((px + 0.5) / rasW) * (interval.end - interval.start);
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
    drawSelchEventShading(ctx, pad, plotW, plotH, interval, events);

    const cursorNorm = (state.cursorTime - interval.start) / Math.max(1e-9, interval.end - interval.start);
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
    ctx.fillText(`${interval.start.toFixed(2)} s`, pad.left, height - 5);
    ctx.fillText(`${interval.end.toFixed(2)} s`, pad.left + plotW - 54, height - 5);
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
    const i0b = lowerBoundSorted(tb, interval.start);
    const i1b = upperBoundSorted(tb, interval.end) - 1;

    if (mask && mask.length === score.length) {
      for (let px = 0; px < plotW; px += 1) {
        const tLin = interval.start + ((px + 0.5) / plotW) * (interval.end - interval.start);
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

    drawSelchEventShading(ctx, pad, plotW, plotH, interval, events);

    let ymin = Infinity;
    let ymax = -Infinity;
    if (i1b >= i0b) {
      for (let i = i0b; i <= i1b; i += 1) {
        const v = score[i];
        if (v < ymin) ymin = v;
        if (v > ymax) ymax = v;
      }
    }
    if (!Number.isFinite(ymin)) {
      ymin = 0;
      ymax = 1;
    }
    if (Number.isFinite(threshold)) {
      ymin = Math.min(ymin, threshold);
      ymax = Math.max(ymax, threshold);
    }
    const yPad = (ymax - ymin) * 0.12 || 1e-6;
    ymin -= yPad;
    ymax += yPad;

    ctx.strokeStyle = "rgba(114, 246, 255, 0.35)";
    ctx.strokeRect(pad.left, pad.top, plotW, plotH);

    ctx.beginPath();
    ctx.strokeStyle = "rgba(156, 255, 87, 0.9)";
    ctx.lineWidth = 1.4;
    let started = false;
    for (let i = i0b; i <= i1b; i += 1) {
      const t = tb[i];
      const x = pad.left + ((t - interval.start) / Math.max(1e-9, interval.end - interval.start)) * plotW;
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

    const cursorNormB = (state.cursorTime - interval.start) / Math.max(1e-9, interval.end - interval.start);
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
    const i0w = lowerBoundSorted(tw, interval.start);
    const i1w = upperBoundSorted(tw, interval.end) - 1;

    drawSelchEventShading(ctx, pad, plotW, plotH, interval, events);

    if (i1w < i0w) {
      ctx.fillStyle = "#9fb3d9";
      ctx.font = "12px Space Grotesk";
      ctx.fillText("No waveform samples in interval.", pad.left, pad.top + 24);
    } else {
      let ymin = Infinity;
      let ymax = -Infinity;
      for (let i = i0w; i <= i1w; i += 1) {
        const v = yw[i];
        if (v < ymin) ymin = v;
        if (v > ymax) ymax = v;
      }
      const yPadW = (ymax - ymin) * 0.08 || 1e-6;
      ymin -= yPadW;
      ymax += yPadW;
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
        const x = pad.left + ((t - interval.start) / Math.max(1e-9, interval.end - interval.start)) * plotW;
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

    const cursorNormW = (state.cursorTime - interval.start) / Math.max(1e-9, interval.end - interval.start);
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
  el.selchCaption.textContent = `${bandStr}. Interval ${interval.start.toFixed(2)}–${interval.end.toFixed(2)} s, cursor ${state.cursorTime.toFixed(2)} s${distStr}.`;

  state.geometry.selch = {
    interval,
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
  renderHydroPanel();
  renderSelectedChannelPanel();
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

function seekFromHydroPointer(event) {
  const hit = hitTestHydro(event);
  if (!hit) {
    return;
  }
  seekCursorToTime(hit.time, "hydrophone view", {
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
  const t =
    geo.interval.start +
    ((x - geo.pad.left) / Math.max(1e-9, geo.plotW)) * (geo.interval.end - geo.interval.start);
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
  seekCursorToTime(hit.time, "selected-channel view", {
    announce: false,
    deferred: true
  });
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
    seekCursorToTime(hit.time, "selected-channel view", {
      announce: true,
      deferred: false
    });
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

  if (shotOption.manifestPath) {
    if (shotOption.manifestPath.startsWith("http")) {
      urls.push(shotOption.manifestPath);
    } else {
      OUTPUT_BASE_CANDIDATES.forEach((base) => {
        urls.push(`${base}/${shotOption.manifestPath}`);
      });
    }
  }

  OUTPUT_BASE_CANDIDATES.forEach((base) => {
    urls.push(`${base}/shots/${shotOption.shotId}/viewer_manifest.json`);
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

  return {
    signal: {
      t: tSigRec.data,
      y: sigRec.data
    },
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
      message: "Selected-channel mode not available for this shot (manifest flag)."
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
        message: "Selected-channel mode not available for this shot (bundle/index files not found)."
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
  updateDataStatus(`Loading Orca selected-channel preview col ${previewCol}…`);
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
  return tryLoadJsonFromUrls(candidates);
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

  return {
    shotMetadata,
    recordersSummary,
    events,
    hydroActivity,
    dasActivity,
    situation,
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

    showTooltip(
      "DAS activity",
      `Time ${hit.time.toFixed(2)} s<br>Distance ${hit.distance.toFixed(1)} m<br>Normalized activity ${Number(hit.value).toFixed(3)}<br>Interval ${getCurrentInterval().start.toFixed(2)}-${getCurrentInterval().end.toFixed(2)} s`,
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
      "Hydrophone support score",
      `Time ${hit.time.toFixed(2)} s<br>Support score ${hit.score.toFixed(2)} dB<br>${Number.isFinite(hit.threshold) ? (hit.score >= hit.threshold ? "Above threshold" : "Below threshold") : "Baseline support"}<br>Interval ${getCurrentInterval().start.toFixed(2)}-${getCurrentInterval().end.toFixed(2)} s`,
      hit.clientX,
      hit.clientY
    );
  });
}

async function onShotChanged() {
  const selectedShotId = el.shotSelect.value;
  const shotOption = state.shotOptions.find((option) => option.shotId === selectedShotId);
  state.selectedShotId = selectedShotId;
  hideTooltip();

  if (!shotOption) {
    updateDataStatus("No shot option selected.");
    return;
  }

  setPlayback(false);
  updateDataStatus(`Loading synchronized bundle for ${selectedShotId}...`);

  const manifestResult = await loadManifestForShot(shotOption);
  state.selectedManifest = manifestResult.data;
  state.manifestSource = manifestResult.url;

  try {
    if (manifestResult.data && manifestResult.url) {
      state.shotBundle = await loadBundleFromManifest(manifestResult.data, manifestResult.url);
      await attachMainPanelsFromNpzFallback(manifestResult.data, manifestResult.url, state.shotBundle);
      state.shotBundle.selectedChannel = await loadSelectedChannelIfPresent(manifestResult.data, manifestResult.url);
      resetMapViewport();
      resetMapTimelineForShot();
      state.eventCount = getEventList().length;
      applyIntervalDefaults();
      renderManifestMetadata();
      renderAllPanels();
      scheduleMapRender();
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
    if (fallbackBundle) {
      state.shotBundle = fallbackBundle;
      state.shotBundle.selectedChannel = {
        available: false,
        message: "Selected-channel mode not available for this shot."
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
    el.eventNav.innerHTML = "";
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
  el.hydroSvg.addEventListener("mousedown", (event) => {
    state.draggingTarget = "hydro";
    seekFromHydroPointer(event);
  });
  el.hydroSvg.addEventListener("click", (event) => {
    const hit = hitTestHydro(event);
    if (!hit) {
      return;
    }
    seekCursorToTime(hit.time, "hydrophone view", {
      announce: true,
      deferred: false
    });
  });
  el.hydroSvg.addEventListener("mousemove", (event) => {
    if (state.draggingTarget === "hydro") {
      seekFromHydroPointer(event);
    }
  }, { passive: true });
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
  const indexLoad = await tryLoadJsonFromCandidates("viewer_index.json", OUTPUT_BASE_CANDIDATES);

  if (indexLoad.data) {
    state.shotOptions = parseIndexToShotOptions(indexLoad.data, indexLoad.url);
    updateDataStatus(`Loaded shot list from ${indexLoad.url}.`);
  } else {
    state.indexSource = null;
    state.shotOptions = SHOT_FALLBACK.map((shotId) => ({ shotId, manifestPath: null }));
    updateDataStatus("viewer_index.json not found. Using fallback shot list (whales_humpback, whales_orca).");
  }

  renderShotOptions();
  if (state.shotOptions.length > 0) {
    el.shotSelect.value = state.shotOptions[0].shotId;
    await onShotChanged();
  }
}

initialize().catch((error) => {
  updateDataStatus(`Initialization failed: ${summarizeError(error)}`);
});
