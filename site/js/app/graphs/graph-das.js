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

function syncDasModeControls() {
  state.dasViewMode = "waterfall";
  if (el.dasHeading) {
    el.dasHeading.textContent = `DAS Waterfall — ${shotSpeciesLabel()}`;
  }
  if (el.dasModeWaterfall) {
    el.dasModeWaterfall.classList.toggle("active", true);
    el.dasModeWaterfall.setAttribute("aria-pressed", "true");
  }
}

function renderDasPanel() {
  syncDasModeControls();
  if (!state.shotBundle?.dasWaterfall) {
    renderDasStatusMessage("Loading DAS waterfall preview...", "Loading raw DAS waterfall preview...");
    ensureDasWaterfallLoaded();
    return;
  }
  renderDasWaterfallPanel();
}

function setDasViewMode(mode) {
  if (mode !== "waterfall") {
    return;
  }
  state.dasViewMode = mode;
  renderDasPanel();
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
  }
};

function getDasWaterfallPalette() {
  return DAS_WATERFALL_PALETTES[DAS_WATERFALL_PALETTE_NAME] || DAS_WATERFALL_PALETTES.darkSeismic;
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

function formatWaterfallSampleSeconds(sampleOffset, wf) {
  const fsHz = Number(wf?.fsHz);
  if (!Number.isFinite(sampleOffset)) {
    return "-";
  }
  if (!Number.isFinite(fsHz) || fsHz <= 0) {
    return formatWaterfallAxisNumber(sampleOffset);
  }
  const seconds = sampleOffset / fsHz;
  return `${seconds.toFixed(2)} s`;
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
    const label = sampleIndices ? formatWaterfallSampleSeconds(v, wf) : `${Number(v).toFixed(2)} s`;
    ctx.fillText(label, x, pad.top + plotH + 8);
  }
  ctx.fillText("Time (s)", pad.left + plotW / 2, height - 14);
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
  const yTicks = [0, 200, 400, 600, 800].filter((v, idx, arr) => (
    v <= channels[channels.length - 1] && arr.indexOf(v) === idx
  ));
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
  const firstChannel = Number(channels[0]);
  const lastChannel = Number(channels[channels.length - 1]);
  const channelRangeText = Number.isFinite(firstChannel) && Number.isFinite(lastChannel)
    ? `, raw channels ${firstChannel.toFixed(0)}-${lastChannel.toFixed(0)}`
    : "";
  el.dasCaption.textContent =
    `DAS Waterfall preview for ${shotSpeciesLabel()}: ${nRows} DAS channel positions${channelRangeText}, ` +
    `${viewInterval.start.toFixed(2)}-${viewInterval.end.toFixed(2)} s. Brighter colors mean stronger fiber-signal changes; hover for sample index, then inspect or listen to one channel in Selected DAS Channel.`;
}
