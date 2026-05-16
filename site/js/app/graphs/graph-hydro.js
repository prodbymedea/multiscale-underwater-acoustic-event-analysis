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

