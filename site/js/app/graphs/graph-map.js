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
