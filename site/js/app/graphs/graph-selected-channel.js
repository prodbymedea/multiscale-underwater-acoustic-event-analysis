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

