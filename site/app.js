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
    hydro: null,
    map: null,
    mapNode: null
  },
  geometry: {
    das: null,
    hydro: null,
    map: null
  },
  hoverFrame: 0,
  hoverEvent: null,
  hoverTarget: null,
  draggingTarget: null,
  mapViewport: {
    zoom: 1,
    targetZoom: 1,
    offsetX: 0,
    offsetY: 0
  },
  mainRenderFrame: 0,
  mapRenderFrame: 0,
  mapZoomFrame: 0,
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
  mapView: document.getElementById("map-view"),
  eventNav: document.getElementById("event-nav"),
  hoverTooltip: document.getElementById("hover-tooltip")
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
    return;
  }

  const tick = () => {
    state.mapZoomFrame = 0;
    const current = state.mapViewport.zoom;
    const target = state.mapViewport.targetZoom;
    const next = current + (target - current) * 0.22;

    if (Math.abs(next - target) < 0.0025) {
      state.mapViewport.zoom = target;
      scheduleMapRender();
      return;
    }

    state.mapViewport.zoom = next;
    scheduleMapRender();
    state.mapZoomFrame = requestAnimationFrame(tick);
  };

  state.mapZoomFrame = requestAnimationFrame(tick);
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

function shotDuration() {
  const extent = getTimeExtentFromShotBundle(state.shotBundle);
  return Math.max(0, extent.end - extent.start);
}

function currentSnapshot() {
  const das = state.shotBundle?.dasActivity;
  const t = das?.axes?.t_s;
  const distances = das?.axes?.distances_m;
  const matrix = das?.activity_01;
  if (!Array.isArray(t) || !Array.isArray(distances) || !Array.isArray(matrix) || t.length === 0) {
    return { peakDistance: null };
  }

  let bestIdx = 0;
  let bestDiff = Math.abs(t[0] - state.cursorTime);
  for (let i = 1; i < t.length; i += 1) {
    const diff = Math.abs(t[i] - state.cursorTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }

  const row = matrix[bestIdx];
  if (!Array.isArray(row) || row.length === 0) {
    return { peakDistance: null };
  }

  let peakIdx = 0;
  let peakVal = Number(row[0]) || 0;
  for (let i = 1; i < row.length; i += 1) {
    const v = Number(row[i]) || 0;
    if (v > peakVal) {
      peakVal = v;
      peakIdx = i;
    }
  }

  return { peakDistance: Number.isFinite(distances[peakIdx]) ? distances[peakIdx] : null };
}

function buildSituationPoints(recorders, sourcePoint, xScale, yScale) {
  const parts = [];
  recorders.forEach((rec) => {
    const cx = xScale(rec.x);
    const cy = yScale(rec.y);
    parts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="8" fill="rgba(114,246,255,0.16)"></circle>`);
    parts.push(`<circle class="map-interactive-point map-point-recorder" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="3.9" fill="#72f6ff" data-tooltip-title="Recorder Station" data-tooltip-body="Type: Recorder station<br>Name: ${rec.name}<br>Coordinates (E, N): ${rec.x.toFixed(1)} m, ${rec.y.toFixed(1)} m"></circle>`);
  });

  if (sourcePoint) {
    const cx = xScale(sourcePoint.x);
    const cy = yScale(sourcePoint.y);
    parts.push(`<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="12" fill="rgba(255,79,216,0.18)"></circle>`);
    parts.push(`<circle class="map-interactive-point map-point-source" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="4.7" fill="#ff4fd8" data-tooltip-title="Source Reference" data-tooltip-body="Type: Reference source<br>Coordinates (E, N): ${sourcePoint.x.toFixed(1)} m, ${sourcePoint.y.toFixed(1)} m${Number.isFinite(sourcePoint.depth) ? `<br>Depth: ${sourcePoint.depth.toFixed(1)} m` : ""}"></circle>`);
  }

  return parts.join("");
}

function buildMapTimeOverlays(fiber, tracks, xScale, yScale) {
  const parts = [];
  const snap = currentSnapshot();

  const fiberSegs = Object.values(fiber || {}).filter((pts) => Array.isArray(pts) && pts.length > 1);
  if (fiberSegs.length && snap.peakDistance != null) {
    const mainFiber = fiberSegs.reduce((best, cur) => (cur.length > best.length ? cur : best), fiberSegs[0]);
    const distances = state.shotBundle?.dasActivity?.axes?.distances_m || [];
    const minD = distances.length ? distances[0] : 0;
    const maxD = distances.length ? distances[distances.length - 1] : 1;
    const frac = clamp((snap.peakDistance - minD) / Math.max(1e-6, maxD - minD), 0, 1);
    const idx = Math.round(frac * (mainFiber.length - 1));
    const pt = mainFiber[idx];
    if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
      const x = xScale(pt.x);
      const y = yScale(pt.y);
      parts.push(`<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="20" fill="rgba(255,230,109,0.12)"></circle>`);
      parts.push(`<circle class="map-interactive-point map-point-daspeak" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="9.8" fill="rgba(255,230,109,0.96)" stroke="rgba(255,244,178,0.58)" stroke-width="1.1" data-tooltip-title="DAS Peak Projection" data-tooltip-body="Type: Dynamic DAS marker<br>Meaning: Peak DAS activity projected on fiber<br>Time: ${state.cursorTime.toFixed(2)} s"></circle>`);
    }
  }

  const duration = shotDuration();
  const extent = getTimeExtentFromShotBundle(state.shotBundle);
  const shotFrac = duration > 0 ? clamp((state.cursorTime - extent.start) / duration, 0, 1) : 0;
  const palette = ["#72f6ff", "#ff4fd8", "#9cff57", "#ffe66d"];
  let k = 0;
  for (const [trackName, item] of Object.entries(tracks || {})) {
    const seqs = Array.isArray(item) ? [item] : Object.values(item || {}).filter(Array.isArray);
    for (const seq of seqs.slice(0, 1)) {
      if (!seq || seq.length < 2) continue;
      const idx = Math.round(shotFrac * (seq.length - 1));
      const pt = seq[idx];
      if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
      const color = palette[k % palette.length];
      k += 1;
      parts.push(`<circle cx="${xScale(pt.x).toFixed(2)}" cy="${yScale(pt.y).toFixed(2)}" r="11" fill="${color}" opacity="0.18"></circle>`);
      parts.push(`<circle class="map-interactive-point map-point-boatcue" cx="${xScale(pt.x).toFixed(2)}" cy="${yScale(pt.y).toFixed(2)}" r="4.9" fill="${color}" stroke="rgba(226,236,255,0.42)" stroke-width="0.9" data-tooltip-title="Boat Position Cue" data-tooltip-body="Type: Dynamic trajectory marker<br>Track: ${trackName}<br>Coordinates (E, N): ${pt.x.toFixed(1)} m, ${pt.y.toFixed(1)} m<br>Time: ${state.cursorTime.toFixed(2)} s"></circle>`);
    }
  }

  return parts.join("");
}

function buildLegend(tracks, palette, legendX, legendY, includeFiber = true) {
  const names = Object.keys(tracks || {});
  const items = includeFiber ? [{ name: "Fiber", color: "#f1681f" }] : [];
  names.slice(0, 5).forEach((name, idx) => items.push({ name, color: palette[idx % palette.length] }));
  const legendW = 170;
  const legendH = Math.max(52, 24 + items.length * 18);

  const parts = [
    `<rect x="${legendX.toFixed(1)}" y="${legendY.toFixed(1)}" width="${legendW}" height="${legendH}" rx="12" fill="rgba(11,23,43,0.86)" stroke="rgba(114,246,255,0.24)"></rect>`,
    `<text x="${(legendX + 10).toFixed(1)}" y="${(legendY + 14).toFixed(1)}" fill="#9fb3d9" font-size="11">Map layers</text>`
  ];

  items.forEach((item, idx) => {
    const y = legendY + 24 + idx * 18;
    parts.push(`<line x1="${(legendX + 12).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(legendX + 34).toFixed(1)}" y2="${y.toFixed(1)}" stroke="${item.color}" stroke-width="2.4"></line>`);
    parts.push(`<text x="${(legendX + 42).toFixed(1)}" y="${(y + 4).toFixed(1)}" fill="#d4e3ff" font-size="11">${item.name}</text>`);
  });

  return parts.join("");
}

function renderMapPanel() {
  const source = getSourceGroundTruth();
  const recorderSummary = state.shotBundle?.recordersSummary;
  const situation = state.shotBundle?.situation;
  const recorders = [];

  const width = Math.max(640, Math.floor(el.mapSvg.clientWidth || 1200));
  const height = Math.max(420, Math.floor(el.mapSvg.clientHeight || 560));
  const pad = { l: 48, r: 48, t: 26, b: 28 };
  const legendReserve = 194;
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
  for (let i = 0; i < extentCandidates.length; i += 1) {
    const p = extentCandidates[i];
    if (p.x < minX0) minX0 = p.x;
    if (p.x > maxX0) maxX0 = p.x;
    if (p.y < minY0) minY0 = p.y;
    if (p.y > maxY0) maxY0 = p.y;
  }
  const xPad = Math.max(5, (maxX0 - minX0) * 0.08);
  const yPad = Math.max(5, (maxY0 - minY0) * 0.08);
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

  const trackPalette = ["#72f6ff", "#ff4fd8", "#9cff57", "#ffe66d", "#c9a0ff", "#ff7a59"];

  const parts = [
    `<rect x="0" y="0" width="${width}" height="${height}" fill="rgba(5,11,23,0.97)"></rect>`,
    `<rect x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}" fill="rgba(8,15,31,0.45)" stroke="rgba(197,223,255,0.18)"></rect>`
  ];

  if (showBathymetry && Array.isArray(grid) && grid.length && xCoords.length && yCoords.length) {
    parts.push(`<rect x="${pad.l}" y="${pad.t}" width="${plotW}" height="${plotH}" fill="rgba(235,239,244,0.042)"></rect>`);
    parts.push(buildDataDrivenBathymetry(grid, xCoords, yCoords));
  }

  if (showFiber && Array.isArray(fiberAll) && fiberAll.length > 1) {
    const fiberPts = decimatePoints(
      fiberAll.filter((pt) => Number.isFinite(pt?.x) && Number.isFinite(pt?.y)),
      zoom <= 1.6 ? 360 : 900
    );
    for (let i = 1; i < fiberPts.length; i += 1) {
      const prev = fiberPts[i - 1];
      const curr = fiberPts[i];
      parts.push(`<line x1="${xScale(prev.x).toFixed(2)}" y1="${yScale(prev.y).toFixed(2)}" x2="${xScale(curr.x).toFixed(2)}" y2="${yScale(curr.y).toFixed(2)}" stroke="rgba(241,104,31,0.28)" stroke-width="2.1" stroke-linecap="round"></line>`);
    }
  }

  if (showTracks) {
    trackItems.forEach((track, idx) => {
      const color = trackPalette[idx % trackPalette.length];
      const pts = decimatePoints(
        track.points.filter((pt) => Number.isFinite(pt?.x) && Number.isFinite(pt?.y)),
        zoom <= 1.6 ? 260 : 700
      );
      for (let i = 1; i < pts.length; i += 1) {
        const prev = pts[i - 1];
        const curr = pts[i];
        const body = `Type: Vessel trajectory<br>Track: ${track.name}<br>Coordinates (E, N): ${curr.x.toFixed(1)} m, ${curr.y.toFixed(1)} m`;
        parts.push(`<line class="map-interactive-line map-track-segment" x1="${xScale(prev.x).toFixed(2)}" y1="${yScale(prev.y).toFixed(2)}" x2="${xScale(curr.x).toFixed(2)}" y2="${yScale(curr.y).toFixed(2)}" stroke="${color}" stroke-width="1.8" opacity="0.92" data-tooltip-title="Boat Trajectory" data-tooltip-body="${body}"></line>`);
      }
    });
  }

  const points = showPoints ? buildSituationPoints(recorders, sourcePoint, xScale, yScale) : "";
  const overlays = buildMapTimeOverlays(showFiber ? { all: fiberAll } : {}, showTracks ? (boatTracks || {}) : {}, xScale, yScale);
  const legendX = pad.l + plotW + 12;
  const legendY = pad.t + 12;
  const legend = buildLegend(showTracks ? (boatTracks || {}) : {}, trackPalette, legendX, legendY, showFiber);

  parts.push(points);
  parts.push(overlays);
  parts.push(legend);

  state.geometry.map = {
    plotW,
    plotH
  };

  el.mapSvg.innerHTML = parts.join("");
  el.mapCaption.textContent = "Hover tracks and points for details. The map reacts softly to the current playback time.";
  attachMapHoverHandlers();
}

function attachMapHoverHandlers() {
  if (!el.mapSvg || el.mapSvg.dataset.hoverBound === "true") return;

  el.mapSvg.addEventListener("mousemove", (event) => {
    if (state.draggingTarget === "map") {
      clearMapHoverState();
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

    if (btn.getAttribute("data-action") === "reset-view") {
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

function onMapWheel(event) {
  if (!state.shotBundle) {
    return;
  }
  // Keep page scroll smooth. Zoom only on explicit gesture.
  if (!event.ctrlKey && !event.metaKey) {
    return;
  }
  event.preventDefault();

  const modeScale = event.deltaMode === 1 ? 16 : (event.deltaMode === 2 ? 120 : 1);
  const normalizedDelta = event.deltaY * modeScale;
  const factor = Math.exp(-normalizedDelta * 0.00135);
  const currentTarget = Number.isFinite(state.mapViewport.targetZoom) ? state.mapViewport.targetZoom : state.mapViewport.zoom;
  state.mapViewport.targetZoom = clamp(currentTarget * factor, 1, 8);
  animateMapZoom();
}

function onMapPointerDown(event) {
  if (!state.shotBundle || event.button !== 0) {
    return;
  }
  state.draggingTarget = "map";
  state.hover.map = { x: event.clientX, y: event.clientY };
  el.mapSvg.style.cursor = "grabbing";
}

function onMapPointerMove(event) {
  if (state.draggingTarget !== "map" || !state.hover.map) {
    return;
  }
  const geo = state.geometry.map;
  if (!geo) {
    return;
  }

  const dx = event.clientX - state.hover.map.x;
  const dy = event.clientY - state.hover.map.y;
  state.hover.map = { x: event.clientX, y: event.clientY };

  state.mapViewport.offsetX = clamp(state.mapViewport.offsetX - (dx / Math.max(1, geo.plotW)) / state.mapViewport.zoom, -0.5, 0.5);
  state.mapViewport.offsetY = clamp(state.mapViewport.offsetY + (dy / Math.max(1, geo.plotH)) / state.mapViewport.zoom, -0.5, 0.5);
  scheduleMapRender();
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

function renderAllPanels() {
  syncCursorToInterval();
  updateCurrentIntervalLabel();
  updatePlaybackLabel();
  renderActiveEventLabel();
  renderDasPanel();
  renderHydroPanel();
  renderEventNavigation();
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

function onGlobalPointerUp() {
  state.draggingTarget = null;
  if (el.mapSvg) {
    el.mapSvg.style.cursor = "grab";
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
      resetMapViewport();
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
      resetMapViewport();
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

  el.mapSvg.addEventListener("wheel", onMapWheel, { passive: false });
  el.mapSvg.addEventListener("mousedown", onMapPointerDown);
  el.mapSvg.addEventListener("mousemove", onMapPointerMove, { passive: true });

  window.addEventListener("mouseup", onGlobalPointerUp, { passive: true });

  bindMapControlHandlers();

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
