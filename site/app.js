const SHOT_FALLBACK = ["whales_humpback", "whales_orca"];
const OUTPUT_BASE_CANDIDATES = ["../output", "./data", "output"];
const SAMPLE_BASE_CANDIDATES = ["../output_samples", "output_samples"];

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
    hydro: null
  },
  geometry: {
    das: null,
    hydro: null
  },
  hoverFrame: 0,
  hoverEvent: null,
  hoverTarget: null
};

const el = {
  shotSelect: document.getElementById("shot-select"),
  startInput: document.getElementById("interval-start"),
  endInput: document.getElementById("interval-end"),
  playBtn: document.getElementById("play-btn"),
  pauseBtn: document.getElementById("pause-btn"),
  playbackStatus: document.getElementById("playback-status"),
  dataStatus: document.getElementById("data-status"),
  metaShot: document.getElementById("meta-shot"),
  metaTimeRange: document.getElementById("meta-time-range"),
  metaRecommended: document.getElementById("meta-recommended"),
  metaCurrentInterval: document.getElementById("meta-current-interval"),
  metaEventCount: document.getElementById("meta-event-count"),
  metaGroundTruth: document.getElementById("meta-ground-truth"),
  dasCanvas: document.getElementById("das-canvas"),
  dasCaption: document.getElementById("das-caption"),
  hydroSvg: document.getElementById("hydro-svg"),
  hydroCaption: document.getElementById("hydro-caption"),
  mapSvg: document.getElementById("map-svg"),
  mapCaption: document.getElementById("map-caption"),
  eventNav: document.getElementById("event-nav"),
  hoverTooltip: document.getElementById("hover-tooltip")
};

function updateDataStatus(message) {
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

function summarizeError(error) {
  if (!error) {
    return "unknown error";
  }
  return error.message || String(error);
}

function showTooltip(title, body, clientX, clientY) {
  const tip = el.hoverTooltip;
  tip.innerHTML = `<div class="title">${title}</div><p class="body">${body}</p>`;
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

function clampIntervalToTimeRange(start, end, timeExtent) {
  const safeStart = clamp(start, timeExtent.start, timeExtent.end);
  const safeEnd = clamp(end, safeStart, timeExtent.end);
  return { start: safeStart, end: safeEnd };
}

function getRecommendedInterval() {
  const defaults = state.selectedManifest?.viewer_defaults;
  const duration = defaults?.interval_duration_s;
  const timeExtent = getTimeExtentFromShotBundle(state.shotBundle);

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
}

function updatePlaybackLabel() {
  const interval = getCurrentInterval();
  const cursorText = Number.isFinite(state.cursorTime) ? `${state.cursorTime.toFixed(2)} s` : "-";
  el.playbackStatus.textContent = `Cursor @ ${cursorText} within ${interval.start.toFixed(2)}-${interval.end.toFixed(2)} s`;
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

function getSourceGroundTruth() {
  const manifestSource = state.selectedManifest?.source_ground_truth;
  if (manifestSource?.available) {
    return {
      available: true,
      x: manifestSource.position_xy_m?.[0],
      y: manifestSource.position_xy_m?.[1],
      depth: manifestSource.depth_m
    };
  }

  const source = state.shotBundle?.shotMetadata?.source;
  if (source && Number.isFinite(source.pos_x_m) && Number.isFinite(source.pos_y_m)) {
    return {
      available: true,
      x: source.pos_x_m,
      y: source.pos_y_m,
      depth: source.depth_m
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

  updateCurrentIntervalLabel();
}

function getCanvasSize(canvas, fallbackHeight) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.floor(canvas.clientWidth));
  const height = Math.max(180, Math.floor(fallbackHeight));
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

  if (!Array.isArray(hydro?.t_s) || !Array.isArray(hydro?.score_db) || hydro.t_s.length < 2) {
    const timeExtent = getTimeExtentFromShotBundle(state.shotBundle);
    const eventBars = events.map((event) => {
      const x = 80 + ((event.start_time_s - timeExtent.start) / Math.max(0.001, timeExtent.end - timeExtent.start)) * 1080;
      const w = ((event.end_time_s - event.start_time_s) / Math.max(0.001, timeExtent.end - timeExtent.start)) * 1080;
      return `<rect x="${x.toFixed(1)}" y="96" width="${Math.max(2, w).toFixed(1)}" height="96" fill="rgba(255,79,216,0.28)"></rect>`;
    }).join("");

    el.hydroSvg.innerHTML = `
      <rect x="0" y="0" width="1200" height="300" fill="rgba(8,15,31,0.86)"></rect>
      <rect x="80" y="70" width="1080" height="140" fill="rgba(8,15,31,0.55)" stroke="rgba(114,246,255,0.25)"></rect>
      ${eventBars}
      <rect x="${(80 + ((interval.start - timeExtent.start) / Math.max(0.001, timeExtent.end - timeExtent.start)) * 1080).toFixed(1)}" y="70" width="${Math.max(2, ((interval.end - interval.start) / Math.max(0.001, timeExtent.end - timeExtent.start)) * 1080).toFixed(1)}" height="140" fill="rgba(114,246,255,0.18)"></rect>
      <text x="92" y="52" fill="#9fb3d9" font-size="14">Hydrophone score timeseries unavailable. Showing interval + candidate-event guidance.</text>
      <text x="90" y="254" fill="#9fb3d9" font-size="13">${timeExtent.start.toFixed(2)} s</text>
      <text x="1115" y="254" fill="#9fb3d9" font-size="13">${timeExtent.end.toFixed(2)} s</text>
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

  const width = 1200;
  const height = 300;
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

  const eventRects = events
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
  `;

  el.hydroCaption.textContent = `Hydrophone support score synchronized with interval ${interval.start.toFixed(2)}-${interval.end.toFixed(2)} s; candidate-event guidance overlay enabled.`;
}

function renderMapPanel() {
  const source = getSourceGroundTruth();
  const recorderSummary = state.shotBundle?.recordersSummary;
  const recorders = [];

  if (recorderSummary && typeof recorderSummary === "object") {
    Object.entries(recorderSummary).forEach(([name, payload]) => {
      const x = payload?.attrs?.["Position X (m)"];
      const y = payload?.attrs?.["Position Y (m)"];
      if (Number.isFinite(x) && Number.isFinite(y)) {
        recorders.push({ name, x, y });
      }
    });
  }

  const points = [];
  if (source.available && Number.isFinite(source.x) && Number.isFinite(source.y)) {
    points.push({ type: "source", label: "Source", x: source.x, y: source.y });
  }
  recorders.forEach((rec) => points.push({ type: "recorder", label: rec.name, x: rec.x, y: rec.y }));

  const interval = getCurrentInterval();

  if (points.length === 0) {
    el.mapSvg.innerHTML = `
      <rect x="0" y="0" width="1200" height="320" fill="rgba(8,15,31,0.86)"></rect>
      <text x="34" y="48" fill="#9fb3d9" font-size="15">Spatial coordinates unavailable for this shot bundle.</text>
      <text x="34" y="76" fill="#9fb3d9" font-size="13">Interval synchronization remains active: ${interval.start.toFixed(2)}-${interval.end.toFixed(2)} s.</text>
    `;
    el.mapCaption.textContent = "Map is in metadata-only mode; source/recorder geometry not available.";
    return;
  }

  const width = 1200;
  const height = 320;
  const pad = 48;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const xScale = (x) => pad + ((x - minX) / Math.max(0.001, maxX - minX)) * (width - 2 * pad);
  const yScale = (y) => height - pad - ((y - minY) / Math.max(0.001, maxY - minY)) * (height - 2 * pad);

  const symbols = points.map((point) => {
    const cx = xScale(point.x);
    const cy = yScale(point.y);
    const fill = point.type === "source" ? "#ff4fd8" : "#72f6ff";
    const ring = point.type === "source" ? "rgba(255,79,216,0.2)" : "rgba(114,246,255,0.16)";
    return `
      <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="15" fill="${ring}"></circle>
      <circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="6" fill="${fill}"></circle>
      <text x="${(cx + 10).toFixed(2)}" y="${(cy - 10).toFixed(2)}" fill="#d4e3ff" font-size="12">${point.label}</text>
    `;
  }).join("");

  el.mapSvg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="rgba(8,15,31,0.88)"></rect>
    <rect x="${pad}" y="${pad}" width="${width - 2 * pad}" height="${height - 2 * pad}" fill="rgba(8,15,31,0.52)" stroke="rgba(114,246,255,0.24)"></rect>
    ${symbols}
    <text x="${pad}" y="28" fill="#9fb3d9" font-size="13">Synchronized interval: ${interval.start.toFixed(2)}-${interval.end.toFixed(2)} s</text>
    <text x="${pad}" y="${height - 12}" fill="#9fb3d9" font-size="12">Source depth: ${source.available && Number.isFinite(source.depth) ? `${source.depth.toFixed(1)} m` : "not available"}</text>
  `;

  el.mapCaption.textContent = `Map synchronized with shot ${state.selectedShotId}; source and recorder positions rendered when available.`;
}

function renderEventNavigation() {
  const events = getEventList();
  el.eventNav.innerHTML = "";

  if (events.length === 0) {
    const empty = document.createElement("span");
    empty.className = "placeholder-note";
    empty.textContent = "No candidate events for this shot.";
    el.eventNav.appendChild(empty);
    return;
  }

  const current = getCurrentInterval();
  for (const event of events) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "event-chip";
    const active = state.cursorTime >= event.start_time_s && state.cursorTime <= event.end_time_s;
    if (active) {
      chip.classList.add("active");
    }
    chip.textContent = `${event.event_id.split("_").slice(-1)[0]}: ${event.start_time_s.toFixed(1)}-${event.end_time_s.toFixed(1)} s`;
    chip.addEventListener("click", () => {
      const timeExtent = getTimeExtentFromShotBundle(state.shotBundle);
      const eventPad = 1.2;
      const start = clamp(event.start_time_s - eventPad, timeExtent.start, timeExtent.end);
      const end = clamp(event.end_time_s + eventPad, start, timeExtent.end);
      syncIntervalInputs({ start, end });
      state.cursorTime = clamp(event.start_time_s, start, end);
      updateCurrentIntervalLabel();
      renderAllPanels();
    });
    el.eventNav.appendChild(chip);
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
  let bestIndex = 0;
  let bestDistance = Math.abs(t[0] - targetTime);
  for (let index = 1; index < t.length; index += 1) {
    const dist = Math.abs(t[index] - targetTime);
    if (dist < bestDistance) {
      bestIndex = index;
      bestDistance = dist;
    }
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

function renderAllPanels() {
  syncCursorToInterval();
  updateCurrentIntervalLabel();
  updatePlaybackLabel();
  renderDasPanel();
  renderHydroPanel();
  renderMapPanel();
  renderEventNavigation();
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
      state.eventCount = getEventList().length;
      applyIntervalDefaults();
      renderManifestMetadata();
      renderAllPanels();
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
      state.selectedManifest = null;
      state.manifestSource = null;
      state.eventCount = getEventList().length;
      applyIntervalDefaults();
      renderManifestMetadata();
      renderAllPanels();
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
  const interval = getCurrentInterval();
  syncIntervalInputs(interval);
  syncCursorToInterval();
  renderAllPanels();
}

function bindEvents() {
  el.startInput.addEventListener("change", handleIntervalInputChange);
  el.endInput.addEventListener("change", handleIntervalInputChange);
  el.shotSelect.addEventListener("change", onShotChanged);

  el.dasCanvas.addEventListener("mousemove", updateHoverTooltipFromDAS);
  el.dasCanvas.addEventListener("mouseleave", () => {
    hideTooltip();
  });

  el.hydroSvg.addEventListener("mousemove", updateHoverTooltipFromHydro);
  el.hydroSvg.addEventListener("mouseleave", () => {
    hideTooltip();
  });

  window.addEventListener("resize", () => {
    if (state.shotBundle) {
      renderAllPanels();
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
