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
