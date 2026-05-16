function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseNumeric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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
