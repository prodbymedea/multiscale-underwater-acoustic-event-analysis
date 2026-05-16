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
    interval: geo.interval,
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
