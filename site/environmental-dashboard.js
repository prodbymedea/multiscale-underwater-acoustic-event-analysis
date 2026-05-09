const ENV_BASES = ["output/environmental", "./output/environmental", "../output/environmental"];
const ALPLAKES_GEOMETRY_URLS = [
  "output/environmental/alplakes_geometry.txt.gz",
  "./output/environmental/alplakes_geometry.txt.gz",
  "../output/environmental/alplakes_geometry.txt.gz",
  "https://alplakes-eawag.s3.eu-central-1.amazonaws.com/simulations/delft3d-flow/cache/zurich/geometry.txt.gz",
  "https://alplakes-eawag.s3.eu-central-1.amazonaws.com/simulations/delft3d-flow/cache/zurich/geometry.txt.gz?timestamp=1778284800"
];
const LAKE_ZURICH_CENTER = [47.285, 8.645];
const LAKE_ZURICH_HOME_ZOOM = 11.15;
const LAKE_ZURICH_BOUNDS = [
  [47.09, 8.38],
  [47.43, 8.94]
];
const MODEL_FIT_START = { lat: 47.372, lon: 8.535 };
const MODEL_FIT_END = { lat: 47.219, lon: 8.825 };
const MODEL_FIT_HALF_WIDTH = { lat: 0.026, lon: -0.018 };
const PLAY_INTERVAL_MS = 500;

const el = {
  map: document.getElementById("envdash-leaflet"),
  status: document.getElementById("envdash-status"),
  zoomIn: document.getElementById("envdash-zoom-in"),
  zoomOut: document.getElementById("envdash-zoom-out"),
  zoomReset: document.getElementById("envdash-zoom-reset"),
  play: document.getElementById("envdash-play"),
  time: document.getElementById("envdash-time"),
  timeLabel: document.getElementById("envdash-time-label"),
  legendMin: document.getElementById("legend-min"),
  legendMax: document.getElementById("legend-max"),
  sideCurrentToggle: document.getElementById("side-current-toggle"),
  sideStreamlineToggle: document.getElementById("side-streamline-toggle"),
  streamlineOptions: document.getElementById("streamline-options"),
  streamlineSpeedControl: document.getElementById("streamline-speed-control"),
  streamlineSpeed: document.getElementById("streamline-speed"),
  streamlineSpeedValue: document.getElementById("streamline-speed-value"),
  streamlineColorPicker: document.getElementById("streamline-color-picker"),
  arrowColorPicker: document.getElementById("arrow-color-picker"),
  tempOpacity: document.getElementById("temp-opacity"),
  tempOpacityValue: document.getElementById("temp-opacity-value"),
  arrowSize: document.getElementById("arrow-size"),
  arrowSizeValue: document.getElementById("arrow-size-value"),
  periodValue: document.getElementById("env-period-value"),
  depthValue: document.getElementById("env-depth-value"),
  depthSlider: document.getElementById("env-depth-slider")
};

const state = {
  map: null,
  baseLayer: null,
  overlayPane: null,
  overlay: null,
  npz: null,
  layout: null,
  timeIndex: 0,
  depthIndex: 0,
  playing: false,
  timer: null,
  showTemp: true,
  showCurrents: true,
  showStreamlines: false,
  streamlineSpeed: 1,
  streamlineColor: "#eef2f8",
  arrowColor: "#141414",
  flowAnimationOn: true,
  flowFrameHandle: null,
  flowNowMs: 0,
  tempStyle: "dots",
  tempOpacity: 1,
  arrowSize: 22,
  modelBounds: null,
  geoGrid: null,
  geoMode: "provisional",
  overlayTopLeft: null,
  overlayTopLeftLatLng: null,
  homeFlyFrame: null,
  tempRange: null,
  speedRange: null
};

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mix(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t))
  ];
}

function ramp(stops, t) {
  const v = clamp(t, 0, 1);
  const scaled = v * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(scaled));
  return mix(stops[i], stops[i + 1], scaled - i);
}

function tempColor(t) {
  return ramp([[18, 42, 115], [26, 115, 190], [238, 234, 218], [221, 111, 50], [111, 12, 7]], t);
}

function hexToRgba(hex, alpha = 1) {
  const clean = String(hex || "#141414").replace("#", "").trim();
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean.padEnd(6, "0").slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) {
    return `rgba(20, 20, 20, ${alpha})`;
  }
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function setStatus(text, fade = false) {
  if (!el.status) return;
  el.status.textContent = text;
  el.status.hidden = false;
  el.status.classList.toggle("is-faded", fade);
}


function getDescrInfo(descr) {
  const map = {
    "<f4": { bytes: 4, kind: "f32" }, "|f4": { bytes: 4, kind: "f32" },
    "<f8": { bytes: 8, kind: "f64" }, "|f8": { bytes: 8, kind: "f64" },
    "<i4": { bytes: 4, kind: "i32" }, "<i2": { bytes: 2, kind: "i16" },
    "<u2": { bytes: 2, kind: "u16" }, "|u1": { bytes: 1, kind: "u8" },
    "|i1": { bytes: 1, kind: "i8" }
  };
  return map[descr] || null;
}

function parseNpy(buffer) {
  const u8 = new Uint8Array(buffer);
  if (String.fromCharCode(...u8.subarray(0, 6)) !== "\x93NUMPY") {
    throw new Error("Invalid NPY");
  }
  const major = u8[6];
  const headerLen = major === 1 ? u8[8] | (u8[9] << 8) : new DataView(buffer).getUint32(8, true);
  const headerOffset = major === 1 ? 10 : 12;
  const header = new TextDecoder("latin1").decode(u8.subarray(headerOffset, headerOffset + headerLen));
  const descr = (header.match(/'descr':\s*'([^']+)'/) || [])[1];
  const shape = ((header.match(/'shape':\s*\(([^)]*)\)/) || [])[1] || "")
    .split(",").map((p) => Number.parseInt(p.trim(), 10)).filter(Number.isFinite);
  const fortran = /'fortran_order':\s*True/.test(header);
  const info = getDescrInfo(descr);
  if (!info) throw new Error(`Unsupported NPY dtype ${descr}`);
  let offset = headerOffset + headerLen;
  while (offset % 16 !== 0) offset += 1;
  const n = shape.reduce((a, b) => a * b, 1);
  let data;
  if (info.kind === "f32") data = new Float32Array(buffer, offset, n);
  else if (info.kind === "f64") data = new Float64Array(buffer, offset, n);
  else if (info.kind === "i32") data = new Int32Array(buffer, offset, n);
  else if (info.kind === "i16") data = new Int16Array(buffer, offset, n);
  else if (info.kind === "u16") data = new Uint16Array(buffer, offset, n);
  else if (info.kind === "u8") data = new Uint8Array(buffer, offset, n);
  else data = new Int8Array(buffer, offset, n);
  return { data, shape, fortran, descr };
}

function unzipNpz(buffer) {
  const entries = fflate.unzipSync(new Uint8Array(buffer));
  const out = {};
  for (const name of Object.keys(entries)) {
    if (!name.endsWith(".npy")) continue;
    const bytes = entries[name];
    out[name.replace(/\.npy$/i, "")] = parseNpy(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }
  return out;
}

async function loadEnvNpz() {
  for (const base of ENV_BASES) {
    try {
      const res = await fetch(`${base}/environmental_map_fields.npz`, { cache: "no-cache" });
      if (res.ok) return unzipNpz(await res.arrayBuffer());
    } catch (_) {
      // Try next base.
    }
  }
  throw new Error("environmental_map_fields.npz not found");
}

async function fetchGzipText(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const compressed = await res.arrayBuffer();
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream is not supported in this browser");
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function parseGeoGrid(text) {
  const rows = text.split(/\r?\n/).filter((line) => line.length > 0);
  const M = rows.length;
  const parsedRows = rows.map((line) => line.split(","));
  const maxCols = parsedRows.reduce((mx, row) => Math.max(mx, row.length), 0);
  const N = Math.floor(maxCols / 2);
  if (!M || !N) {
    throw new Error("geometry grid is empty");
  }
  const lat = new Float64Array(M * N);
  const lon = new Float64Array(M * N);
  lat.fill(Number.NaN);
  lon.fill(Number.NaN);
  for (let m = 0; m < M; m += 1) {
    const row = parsedRows[m];
    for (let n = 0; n < N; n += 1) {
      const a = Number.parseFloat((row[n] || "").trim());
      const b = Number.parseFloat((row[n + N] || "").trim());
      const i = m * N + n;
      lat[i] = Number.isFinite(a) ? a : Number.NaN;
      lon[i] = Number.isFinite(b) ? b : Number.NaN;
    }
  }
  return { M, N, lat, lon };
}

async function loadAlplakesGeoGrid(expectedM, expectedN) {
  for (const url of ALPLAKES_GEOMETRY_URLS) {
    try {
      const text = await fetchGzipText(url);
      const grid = parseGeoGrid(text);
      if (
        (!Number.isFinite(expectedM) || !Number.isFinite(expectedN)) ||
        (grid.M === expectedM && grid.N === expectedN)
      ) {
        return grid;
      }
    } catch (_) {
      // Try next URL.
    }
  }
  throw new Error("Alplakes geometry unavailable or shape mismatch");
}

function idx2(a, row, col) {
  const [M, N] = a.shape;
  return a.fortran ? row + M * col : row * N + col;
}

function idx3(a, t, row, col) {
  const [T, M, N] = a.shape;
  return a.fortran ? t + T * (row + M * col) : t * M * N + row * N + col;
}

function val3(a, t, row, col) {
  return a.data[idx3(a, t, row, col)];
}

function idx4(a, t, z, row, col) {
  const [T, Z, M, N] = a.shape;
  return a.fortran
    ? t + T * (z + Z * (row + M * col))
    : ((t * Z + z) * M + row) * N + col;
}

function val4(a, t, z, row, col) {
  return a.data[idx4(a, t, z, row, col)];
}

function hasDepthStack() {
  return !!(
    state.npz?.temperature_zt?.data &&
    state.npz.temperature_zt.shape?.length === 4 &&
    state.npz.depth_m?.data
  );
}

function currentDepthMeters() {
  if (!hasDepthStack()) {
    return 0.9;
  }
  const d = Number(state.npz.depth_m.data[state.depthIndex]);
  return Number.isFinite(d) ? d : 0.9;
}

function depthLabel() {
  return `${currentDepthMeters().toFixed(2).replace(/\.?0+$/, "")} m`;
}

function getTemp(t, row, col) {
  if (hasDepthStack()) {
    return val4(state.npz.temperature_zt, t, state.depthIndex, row, col);
  }
  return val3(state.npz.temperature_t, t, row, col);
}

function getU(t, row, col) {
  if (hasDepthStack() && state.npz.u_face_zt?.data) {
    return val4(state.npz.u_face_zt, t, state.depthIndex, row, col);
  }
  return val3(state.npz.u_face_t, t, row, col);
}

function getV(t, row, col) {
  if (hasDepthStack() && state.npz.v_face_zt?.data) {
    return val4(state.npz.v_face_zt, t, state.depthIndex, row, col);
  }
  return val3(state.npz.v_face_t, t, row, col);
}

function sampleField(row, col) {
  if (!state.layout) return null;
  const r0 = Math.floor(row);
  const c0 = Math.floor(col);
  if (r0 < 0 || c0 < 0 || r0 >= state.layout.M - 1 || c0 >= state.layout.N - 1) {
    return null;
  }
  const tr = row - r0;
  const tc = col - c0;
  const samples = [
    [r0, c0, (1 - tr) * (1 - tc)],
    [r0 + 1, c0, tr * (1 - tc)],
    [r0, c0 + 1, (1 - tr) * tc],
    [r0 + 1, c0 + 1, tr * tc]
  ];
  let u = 0;
  let v = 0;
  let temp = 0;
  let w = 0;
  for (const [rr, cc, ww] of samples) {
    const tt = getTemp(state.timeIndex, rr, cc);
    const uu = getU(state.timeIndex, rr, cc);
    const vv = getV(state.timeIndex, rr, cc);
    if (!Number.isFinite(tt) || !Number.isFinite(uu) || !Number.isFinite(vv)) continue;
    u += uu * ww;
    v += vv * ww;
    temp += tt * ww;
    w += ww;
  }
  if (w < 0.35) return null;
  return { u: u / w, v: v / w, temp: temp / w };
}

function modelLatLngFloat(row, col) {
  if (state.geoGrid) {
    const r0 = Math.floor(row);
    const c0 = Math.floor(col);
    if (r0 < 0 || c0 < 0 || r0 >= state.geoGrid.M - 1 || c0 >= state.geoGrid.N - 1) return null;
    const tr = row - r0;
    const tc = col - c0;
    const points = [
      [r0, c0, (1 - tr) * (1 - tc)],
      [r0 + 1, c0, tr * (1 - tc)],
      [r0, c0 + 1, (1 - tr) * tc],
      [r0 + 1, c0 + 1, tr * tc]
    ];
    let lat = 0;
    let lon = 0;
    let w = 0;
    for (const [rr, cc, ww] of points) {
      const i = rr * state.geoGrid.N + cc;
      const la = state.geoGrid.lat[i];
      const lo = state.geoGrid.lon[i];
      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
      lat += la * ww;
      lon += lo * ww;
      w += ww;
    }
    return w > 0.35 ? L.latLng(lat / w, lon / w) : null;
  }
  const rr = clamp(Math.round(row), 0, state.layout.M - 1);
  const cc = clamp(Math.round(col), 0, state.layout.N - 1);
  return modelLatLng(rr, cc);
}

function quantile(values, q) {
  if (!values.length) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : lerp(sorted[lo], sorted[hi], pos - lo);
}

function computeModelBounds() {
  const xs = [];
  const ys = [];
  const { npz, layout } = state;
  for (let m = 0; m < layout.M; m += 1) {
    for (let n = 0; n < layout.N; n += 1) {
      const t = getTemp(state.timeIndex, m, n);
      if (!Number.isFinite(t)) continue;
      xs.push(npz.XZ.data[idx2(npz.XZ, m, n)]);
      ys.push(npz.YZ.data[idx2(npz.YZ, m, n)]);
    }
  }
  state.modelBounds = {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys)
  };
}

function modelLatLng(row, col) {
  if (state.geoGrid) {
    const i = row * state.geoGrid.N + col;
    const lat = state.geoGrid.lat[i];
    const lon = state.geoGrid.lon[i];
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      return L.latLng(lat, lon);
    }
    return null;
  }
  const { npz, modelBounds } = state;
  const x = npz.XZ.data[idx2(npz.XZ, row, col)];
  const y = npz.YZ.data[idx2(npz.YZ, row, col)];
  const xn = (x - modelBounds.minX) / Math.max(1e-9, modelBounds.maxX - modelBounds.minX);
  const yn = (y - modelBounds.minY) / Math.max(1e-9, modelBounds.maxY - modelBounds.minY);
  const side = yn - 0.5;
  return L.latLng(
    MODEL_FIT_START.lat + xn * (MODEL_FIT_END.lat - MODEL_FIT_START.lat) + side * MODEL_FIT_HALF_WIDTH.lat,
    MODEL_FIT_START.lon + xn * (MODEL_FIT_END.lon - MODEL_FIT_START.lon) + side * MODEL_FIT_HALF_WIDTH.lon
  );
}

function projectToOverlayPoint(latlng) {
  if (!state.map || !latlng) return null;
  const topLeft = state.overlayTopLeft || state.map.containerPointToLayerPoint([0, 0]);
  const p = state.map.latLngToLayerPoint(latlng).subtract(topLeft);
  return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
}

function computeRanges() {
  const temps = [];
  const speeds = [];
  const { npz, layout, timeIndex } = state;
  for (let m = 0; m < layout.M; m += 1) {
    for (let n = 0; n < layout.N; n += 1) {
      const t = getTemp(timeIndex, m, n);
      if (Number.isFinite(t)) temps.push(t);
      const u = getU(timeIndex, m, n);
      const v = getV(timeIndex, m, n);
      if (Number.isFinite(u) && Number.isFinite(v)) speeds.push(Math.hypot(u, v));
    }
  }
  state.tempRange = { lo: quantile(temps, 0.03), hi: quantile(temps, 0.97) };
  state.speedRange = { p95: quantile(speeds, 0.95) || 1e-6 };
}

function estimateCellPixelSize() {
  if (!state.map || !state.layout) return 6;
  const m0 = Math.floor(state.layout.M * 0.5);
  const n0 = Math.floor(state.layout.N * 0.5);
  const p00ll = modelLatLng(m0, n0);
  const p10ll = modelLatLng(Math.min(state.layout.M - 1, m0 + 1), n0);
  const p01ll = modelLatLng(m0, Math.min(state.layout.N - 1, n0 + 1));
  if (!p00ll || !p10ll || !p01ll) return 6;
  const p00 = projectToOverlayPoint(p00ll);
  const p10 = projectToOverlayPoint(p10ll);
  const p01 = projectToOverlayPoint(p01ll);
  if (!p00 || !p10 || !p01) return 6;
  const sx = Math.hypot(p10.x - p00.x, p10.y - p00.y);
  const sy = Math.hypot(p01.x - p00.x, p01.y - p00.y);
  const cell = Math.max(sx, sy);
  return clamp(cell * 1.08, 4, 42);
}

function drawCurrentStreakBands(ctx, layout, timeIndex, ref, nowMs) {
  if (!state.showStreamlines || state.streamlineSpeed <= 0) return;
  const zoom = state.map?.getZoom?.() || 10.5;
  const zoomBoost = clamp(0.7 + (zoom - 10.5) * 0.2, 0.55, 1.45);
  const strideM = Math.max(1, Math.floor(layout.M / 60));
  const strideN = Math.max(1, Math.floor(layout.N / 24));
  ctx.save();
  ctx.lineCap = "round";

  for (let m = 0; m < layout.M; m += strideM) {
    for (let n = 0; n < layout.N; n += strideN) {
      if (!Number.isFinite(getTemp(timeIndex, m, n))) continue;
      const u = getU(timeIndex, m, n);
      const v = getV(timeIndex, m, n);
      if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
      const sp = Math.hypot(u, v);
      if (sp < 1e-8) continue;

      const ll = modelLatLng(m, n);
      if (!ll) continue;
      const p = projectToOverlayPoint(ll);
      if (!p) continue;

      const speedNorm = clamp(sp / ref, 0, 1.35);
      // Faster water gets denser streaks; slow zones stay visually sparse.
      const drawChance = clamp((0.18 + speedNorm * 1.05) * zoomBoost, 0.1, 1);
      const hash = Math.abs(Math.sin((m + 1) * 12.9898 + (n + 1) * 78.233)) * 43758.5453;
      if (hash - Math.floor(hash) > drawChance) continue;

      const len = clamp((sp / ref) * (state.arrowSize * 1.95), 7, state.arrowSize * 2.8);
      const ux = u / sp;
      const uy = -(v / sp);
      const x1 = p.x - ux * len * 0.5;
      const y1 = p.y - uy * len * 0.5;
      const x2 = p.x + ux * len * 0.5;
      const y2 = p.y + uy * len * 0.5;

      const dash = clamp(len * 0.7, 6, 32);
      const gap = clamp(len * 0.28, 3, 12);
      const speedScale = clamp(sp / ref, 0.35, 2.4);
      const phase = (nowMs * 0.018 * speedScale * state.streamlineSpeed) % (dash + gap);
      const glowAlpha = clamp(0.12 + speedNorm * 0.16, 0.1, 0.3);
      const coreAlpha = clamp(0.28 + speedNorm * 0.24, 0.22, 0.52);
      const glowColor = hexToRgba(state.streamlineColor, glowAlpha);
      const coreColor = hexToRgba(state.streamlineColor, coreAlpha);

      ctx.setLineDash([dash, gap]);
      ctx.lineDashOffset = -phase;
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.strokeStyle = coreColor;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }

  ctx.setLineDash([]);
  ctx.restore();
}

function stopFlowAnimation() {
  if (state.flowFrameHandle !== null) {
    cancelAnimationFrame(state.flowFrameHandle);
    state.flowFrameHandle = null;
  }
}

function flowAnimationTick(nowMs) {
  state.flowFrameHandle = null;
  state.flowNowMs = nowMs;
  if (
    !state.flowAnimationOn ||
    !state.showCurrents ||
    !state.showStreamlines ||
    state.streamlineSpeed <= 0 ||
    !state.overlay
  ) {
    return;
  }
  redrawOverlay();
  state.flowFrameHandle = requestAnimationFrame(flowAnimationTick);
}

function ensureFlowAnimation() {
  if (!state.flowAnimationOn || !state.showCurrents || !state.showStreamlines || state.streamlineSpeed <= 0 || !state.overlay) return;
  if (state.flowFrameHandle !== null) return;
  state.flowFrameHandle = requestAnimationFrame(flowAnimationTick);
}

const EnvOverlay = L.Layer.extend({
  onAdd(map) {
    this._map = map;
    this._canvas = L.DomUtil.create("canvas", "envdash-overlay-canvas leaflet-zoom-animated");
    this._raf = null;
    map.getPane("scientific-overlays").appendChild(this._canvas);
    map.on("moveend zoomend resize viewreset", this._scheduleReset, this);
    if (map.options.zoomAnimation && L.Browser.any3d) {
      map.on("zoomanim", this._animateZoom, this);
    }
    this._scheduleReset();
  },
  onRemove(map) {
    if (this._raf !== null) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    map.off("moveend zoomend resize viewreset", this._scheduleReset, this);
    if (map.options.zoomAnimation && L.Browser.any3d) {
      map.off("zoomanim", this._animateZoom, this);
    }
    state.overlayTopLeft = null;
    state.overlayTopLeftLatLng = null;
    this._canvas.remove();
  },
  _scheduleReset() {
    if (this._raf !== null) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this._reset();
    });
  },
  _animateZoom(event) {
    if (!this._map || !this._canvas || !state.overlayTopLeftLatLng) return;
    const scale = this._map.getZoomScale(event.zoom, this._map.getZoom());
    const topLeft = this._map._latLngToNewLayerPoint(state.overlayTopLeftLatLng, event.zoom, event.center);
    L.DomUtil.setTransform(this._canvas, topLeft, scale);
  },
  _reset() {
    const size = this._map.getSize();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    this._canvas.width = Math.round(size.x * dpr);
    this._canvas.height = Math.round(size.y * dpr);
    this._canvas.style.width = `${size.x}px`;
    this._canvas.style.height = `${size.y}px`;
    state.overlayTopLeft = this._map.containerPointToLayerPoint([0, 0]);
    state.overlayTopLeftLatLng = this._map.containerPointToLatLng([0, 0]);
    L.DomUtil.setPosition(this._canvas, state.overlayTopLeft);
    const ctx = this._canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);
    drawOverlay(ctx);
  }
});

function drawOverlay(ctx) {
  if (!state.npz || !state.layout) return;
  computeRanges();
  const zoom = state.map?.getZoom?.() || 10.5;
  const zoomBoost = clamp(1 + (zoom - 10.5) * 0.2, 0.8, 2.2);
  const { npz, layout, timeIndex, tempRange } = state;
  if (state.showTemp) {
    ctx.globalAlpha = state.tempOpacity;
    if (state.tempStyle === "heatmap") {
      // Heatmap rendering: smoothed gradient visualization
      const gridSize = 8;
      for (let m = 0; m < layout.M; m += gridSize) {
        for (let n = 0; n < layout.N; n += gridSize) {
          const temps = [];
          for (let dm = 0; dm < Math.min(gridSize, layout.M - m); dm += 1) {
            for (let dn = 0; dn < Math.min(gridSize, layout.N - n); dn += 1) {
              const t = getTemp(timeIndex, m + dm, n + dn);
              if (Number.isFinite(t)) temps.push(t);
            }
          }
          if (temps.length === 0) continue;
          const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
          const normTemp = (avgTemp - tempRange.lo) / Math.max(1e-9, tempRange.hi - tempRange.lo);
          const ll = modelLatLng(m, n);
          if (!ll) continue;
          const p = projectToOverlayPoint(ll);
          if (!p) continue;
          const c = tempColor(normTemp);
          ctx.fillStyle = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
          ctx.fillRect(p.x - gridSize * 1.5, p.y - gridSize * 1.5, gridSize * 3, gridSize * 3);
        }
      }
    } else {
      // Dots rendering: individual point visualization
      const cellSize = estimateCellPixelSize();
      const half = cellSize * 0.5;
      for (let m = 0; m < layout.M; m += 1) {
        for (let n = 0; n < layout.N; n += 1) {
          const t = getTemp(timeIndex, m, n);
          if (!Number.isFinite(t)) continue;
          const ll = modelLatLng(m, n);
          if (!ll) continue;
          const p = projectToOverlayPoint(ll);
          if (!p) continue;
          const c = tempColor((t - tempRange.lo) / Math.max(1e-9, tempRange.hi - tempRange.lo));
          ctx.fillStyle = `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
          ctx.fillRect(p.x - half, p.y - half, cellSize, cellSize);
        }
      }
    }
  }
  if (state.showCurrents) {
    const ref = Math.max(state.speedRange.p95 || 1e-6, 1e-6);
    const nowMs = state.flowNowMs || performance.now();
    drawCurrentStreakBands(ctx, layout, timeIndex, ref, nowMs);
    const strideM = Math.max(1, Math.floor((layout.M / 32) / zoomBoost));
    const strideN = Math.max(1, Math.floor((layout.N / 12) / zoomBoost));
    ctx.globalAlpha = 0.82;
    const arrowStyle = hexToRgba(state.arrowColor, 0.9);
    ctx.strokeStyle = arrowStyle;
    ctx.fillStyle = arrowStyle;
    ctx.lineWidth = 1.9;
    for (let m = 0; m < layout.M; m += strideM) {
      for (let n = 0; n < layout.N; n += strideN) {
        if (!Number.isFinite(getTemp(timeIndex, m, n))) continue;
        const u = getU(timeIndex, m, n);
        const v = getV(timeIndex, m, n);
        if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
        const sp = Math.hypot(u, v);
        if (sp < 1e-8) continue;
        const ll = modelLatLng(m, n);
        if (!ll) continue;
        const p = projectToOverlayPoint(ll);
        if (!p) continue;
        const len = clamp((sp / ref) * state.arrowSize * (1.05 + zoomBoost * 0.25), 6, state.arrowSize * 1.9);
        const dx = (u / sp) * len;
        const dy = -(v / sp) * len;
        ctx.beginPath();
        ctx.moveTo(p.x - dx * 0.45, p.y - dy * 0.45);
        ctx.lineTo(p.x + dx * 0.45, p.y + dy * 0.45);
        ctx.stroke();
        const ang = Math.atan2(dy, dx);
        const x2 = p.x + dx * 0.45;
        const y2 = p.y + dy * 0.45;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - 4.5 * Math.cos(ang - 0.55), y2 - 4.5 * Math.sin(ang - 0.55));
        ctx.lineTo(x2 - 4.5 * Math.cos(ang + 0.55), y2 - 4.5 * Math.sin(ang + 0.55));
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
  updateControls();
}


function fmtDate(ts) {
  return new Date(ts * 1000).toLocaleString("en-GB", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC"
  });
}

function fmtPeriodDate(ts) {
  return new Date(ts * 1000).toLocaleDateString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC"
  });
}

function redrawOverlay() {
  state.overlay?._scheduleReset?.();
}

function updateControls() {
  if (el.sideCurrentToggle) {
    el.sideCurrentToggle.classList.toggle("on", state.showCurrents);
    el.sideCurrentToggle.setAttribute("aria-pressed", state.showCurrents ? "true" : "false");
  }
  if (el.sideStreamlineToggle) {
    el.sideStreamlineToggle.classList.toggle("on", state.showStreamlines);
    el.sideStreamlineToggle.setAttribute("aria-pressed", state.showStreamlines ? "true" : "false");
  }
  if (el.streamlineOptions) {
    el.streamlineOptions.style.display = state.showStreamlines ? "flex" : "none";
  }
  if (el.streamlineSpeedControl) {
    el.streamlineSpeedControl.style.display = state.showStreamlines ? "flex" : "none";
  }
  if (el.arrowColorPicker && el.arrowColorPicker.value !== state.arrowColor) {
    el.arrowColorPicker.value = state.arrowColor;
  }
  if (el.streamlineSpeed) {
    el.streamlineSpeed.value = String(Math.round(state.streamlineSpeed * 100));
    if (el.streamlineSpeedValue) {
      el.streamlineSpeedValue.textContent = `x${state.streamlineSpeed.toFixed(2)}`;
    }
  }
  if (el.tempOpacity) {
    el.tempOpacity.value = String(Math.round(state.tempOpacity * 100));
    if (el.tempOpacityValue) {
      el.tempOpacityValue.textContent = `${Math.round(state.tempOpacity * 100)}%`;
    }
  }
  if (el.arrowSize) {
    el.arrowSize.value = String(state.arrowSize);
    if (el.arrowSizeValue) {
      el.arrowSizeValue.textContent = `${state.arrowSize}px`;
    }
  }
  if (!state.npz || !state.layout) return;
  if (el.periodValue && state.npz.time_s?.data?.length) {
    const t = state.npz.time_s.data;
    el.periodValue.textContent = `${fmtPeriodDate(t[0])} - ${fmtPeriodDate(t[t.length - 1])}`;
  }
  el.time.max = String(state.layout.Nt - 1);
  el.time.value = String(state.timeIndex);
  el.timeLabel.value = `${fmtDate(state.npz.time_s.data[state.timeIndex])} UTC`;
  if (el.depthSlider) {
    const maxDepthIndex = Math.max(0, (state.layout.Nz || 1) - 1);
    el.depthSlider.max = String(maxDepthIndex);
    el.depthSlider.value = String(state.depthIndex);
    el.depthSlider.disabled = !hasDepthStack();
  }
  if (el.depthValue) {
    el.depthValue.textContent = depthLabel();
  }
  el.play.textContent = state.playing ? "Ⅱ" : "▶";
  el.play.setAttribute("aria-pressed", state.playing ? "true" : "false");
  if (state.tempRange) {
    el.legendMin.textContent = `${state.tempRange.lo.toFixed(1)}°C`;
    el.legendMax.textContent = `${state.tempRange.hi.toFixed(1)}°C`;
  }
}

function setPlaying(on) {
  state.playing = !!on;
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  if (state.playing) {
    state.timer = setInterval(() => {
      if (state.timeIndex >= state.layout.Nt - 1) {
        state.timeIndex = 0;
        redrawOverlay();
        state.playing = false;
        if (state.timer) clearInterval(state.timer);
        state.timer = null;
        updateControls();
        ensureFlowAnimation();
        return;
      }
      state.timeIndex += 1;
      redrawOverlay();
    }, PLAY_INTERVAL_MS);
  }
  updateControls();
  ensureFlowAnimation();
}

function flyToHomeView() {
  if (!state.map) return;
  if (state.homeFlyFrame !== null) {
    cancelAnimationFrame(state.homeFlyFrame);
    state.homeFlyFrame = null;
  }
  state.map.stop();
  state.overlay?._reset?.();

  const finish = () => {
    requestAnimationFrame(() => {
      state.map.invalidateSize(false);
      redrawOverlay();
    });
  };

  const zoomHome = () => {
    state.overlay?._reset?.();
    if (Math.abs(state.map.getZoom() - LAKE_ZURICH_HOME_ZOOM) < 0.02) {
      finish();
      return;
    }
    let zoomDone = false;
    const onZoomEnd = () => {
      if (zoomDone) return;
      zoomDone = true;
      state.map.off("zoomend", onZoomEnd);
      window.clearTimeout(zoomFallback);
      finish();
    };
    const zoomFallback = window.setTimeout(onZoomEnd, 700);
    state.map.once("zoomend", onZoomEnd);
    state.map.setZoom(LAKE_ZURICH_HOME_ZOOM, { animate: true });
  };

  let panDone = false;
  const onMoveEnd = () => {
    if (panDone) return;
    panDone = true;
    state.map.off("moveend", onMoveEnd);
    window.clearTimeout(panFallback);
    redrawOverlay();
    zoomHome();
  };
  const panFallback = window.setTimeout(onMoveEnd, 700);
  state.map.once("moveend", onMoveEnd);
  state.map.panTo(LAKE_ZURICH_CENTER, {
    animate: true,
    duration: 0.36,
    easeLinearity: 0.25
  });
}

function initMap() {
  if (typeof L === "undefined") {
    setStatus("Leaflet failed to load. Check internet connection.");
    return;
  }

  state.map = L.map(el.map, {
    center: LAKE_ZURICH_CENTER,
    zoom: LAKE_ZURICH_HOME_ZOOM,
    minZoom: 3,
    maxZoom: 19,
    zoomAnimation: true,
    fadeAnimation: true,
    markerZoomAnimation: false,
    zoomControl: false,
    attributionControl: true,
    scrollWheelZoom: true,
    wheelDebounceTime: 28,
    wheelPxPerZoomLevel: 46,
    zoomSnap: 0.1,
    zoomDelta: 0.62,
    inertia: true,
    inertiaDeceleration: 3400,
    inertiaMaxSpeed: 1200,
    worldCopyJump: false,
    preferCanvas: true,
    tap: true
  });

  state.baseLayer = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {
      subdomains: "abcd",
      maxZoom: 20,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      updateWhenZooming: false,
      updateWhenIdle: true,
      keepBuffer: 2
    }
  ).addTo(state.map);

  state.map.createPane("scientific-overlays");
  state.overlayPane = state.map.getPane("scientific-overlays");
  state.overlayPane.style.zIndex = 450;
  state.overlayPane.style.pointerEvents = "none";
  L.control.scale({ metric: true, imperial: false, position: "bottomleft" }).addTo(state.map);

  state.baseLayer.on("tileerror", () => setStatus("Some map tiles failed to load. Check internet connection."));

  el.zoomIn.addEventListener("click", () => state.map.zoomIn(0.75));
  el.zoomOut.addEventListener("click", () => state.map.zoomOut(0.75));
  el.zoomReset.addEventListener("click", flyToHomeView);
  state.map.setView(LAKE_ZURICH_CENTER, LAKE_ZURICH_HOME_ZOOM, { animate: false });
  requestAnimationFrame(() => state.map.invalidateSize(false));
  window.addEventListener("resize", () => state.map.invalidateSize(false), { passive: true });
}

function bindOverlayControls() {
  el.sideCurrentToggle?.addEventListener("click", () => {
    state.showCurrents = !state.showCurrents;
    redrawOverlay();
    if (state.showCurrents) ensureFlowAnimation();
    else stopFlowAnimation();
  });
  el.sideStreamlineToggle?.addEventListener("click", () => {
    state.showStreamlines = !state.showStreamlines;
    if (el.streamlineOptions) {
      el.streamlineOptions.style.display = state.showStreamlines ? "flex" : "none";
    }
    if (el.streamlineSpeedControl) {
      el.streamlineSpeedControl.style.display = state.showStreamlines ? "flex" : "none";
    }
    redrawOverlay();
    if (state.showCurrents && state.showStreamlines && state.streamlineSpeed > 0) ensureFlowAnimation();
    else stopFlowAnimation();
  });
  el.arrowColorPicker?.addEventListener("input", () => {
    state.arrowColor = el.arrowColorPicker.value || "#141414";
    redrawOverlay();
  });
  el.streamlineColorPicker?.addEventListener("input", () => {
    state.streamlineColor = el.streamlineColorPicker.value || "#eef2f8";
    redrawOverlay();
  });
  el.tempOpacity?.addEventListener("input", () => {
    state.tempOpacity = clamp(Number.parseInt(el.tempOpacity.value, 10) || 100, 0, 100) / 100;
    if (el.tempOpacityValue) {
      el.tempOpacityValue.textContent = `${Math.round(state.tempOpacity * 100)}%`;
    }
    redrawOverlay();
  });
  el.arrowSize?.addEventListener("input", () => {
    state.arrowSize = clamp(Number.parseInt(el.arrowSize.value, 10) || 22, 8, 40);
    if (el.arrowSizeValue) {
      el.arrowSizeValue.textContent = `${state.arrowSize}px`;
    }
    redrawOverlay();
  });
  el.streamlineSpeed?.addEventListener("input", () => {
    const pct = clamp(Number.parseInt(el.streamlineSpeed.value, 10) || 0, 0, 300);
    state.streamlineSpeed = pct / 100;
    if (el.streamlineSpeedValue) {
      el.streamlineSpeedValue.textContent = `x${state.streamlineSpeed.toFixed(2)}`;
    }
    redrawOverlay();
    if (state.showCurrents && state.showStreamlines && state.streamlineSpeed > 0) ensureFlowAnimation();
    else stopFlowAnimation();
  });
  el.time.addEventListener("input", () => {
    if (!state.layout?.Nt) return;
    state.timeIndex = clamp(Number.parseInt(el.time.value, 10) || 0, 0, state.layout.Nt - 1);
    redrawOverlay();
  });
  el.depthSlider?.addEventListener("input", () => {
    if (!state.layout?.Nz) return;
    state.depthIndex = clamp(Number.parseInt(el.depthSlider.value, 10) || 0, 0, state.layout.Nz - 1);
    redrawOverlay();
  });
  el.play.addEventListener("click", () => setPlaying(!state.playing));
}

async function init() {
  const geoGridPromise = loadAlplakesGeoGrid(Number.NaN, Number.NaN).catch(() => null);

  try {
    state.npz = await loadEnvNpz();

    const depthStack = !!(
      state.npz.temperature_zt?.data &&
      state.npz.temperature_zt.shape?.length === 4 &&
      state.npz.depth_m?.data
    );
    state.layout = {
      M: state.npz.XZ.shape[0],
      N: state.npz.XZ.shape[1],
      Nt: state.npz.time_s.data.length,
      Nz: depthStack ? state.npz.temperature_zt.shape[1] : 1
    };

    if (depthStack) {
      let best = 0;
      let bestErr = Infinity;
      for (let i = 0; i < state.npz.depth_m.data.length; i += 1) {
        const err = Math.abs(Number(state.npz.depth_m.data[i]) - 0.9);
        if (err < bestErr) {
          best = i;
          bestErr = err;
        }
      }
      state.depthIndex = best;
    } else {
      state.depthIndex = 0;
    }

    state.timeIndex = 0;

    const grid = await Promise.race([
      geoGridPromise,
      new Promise((resolve) => window.setTimeout(() => resolve(null), 250))
    ]);
    state.geoGrid = grid && grid.M === state.layout.M && grid.N === state.layout.N ? grid : null;
    state.geoMode = state.geoGrid ? "georeferenced" : "provisional";
    computeModelBounds();

    initMap();
    bindOverlayControls();
    state.map.invalidateSize(false);
    state.overlay = new EnvOverlay().addTo(state.map);
    state.overlay?._reset?.();
    state.baseLayer?.setOpacity?.(1);
    ensureFlowAnimation();
    updateControls();

    geoGridPromise.then((lateGrid) => {
      if (!lateGrid || lateGrid.M !== state.layout.M || lateGrid.N !== state.layout.N || state.geoGrid) return;
      state.geoGrid = lateGrid;
      state.geoMode = "georeferenced";
      computeModelBounds();
      redrawOverlay();
    });
  } catch (error) {
    initMap();
    bindOverlayControls();
    state.baseLayer?.setOpacity?.(1);
    setStatus(`Environmental overlay not available: ${error.message}`);
    console.error(error);
  }
}

init();
