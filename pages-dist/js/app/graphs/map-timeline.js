function getMapTimelineExtentFromSituation(bundle) {
  const tracks = bundle?.situation?.boat_tracks?.tracks;
  let start = Infinity;
  let end = -Infinity;

  Object.values(tracks || {}).forEach((trackPoints) => {
    if (!Array.isArray(trackPoints)) {
      return;
    }
    trackPoints.forEach((pt) => {
      const time = Number(pt?.t);
      if (!Number.isFinite(time)) {
        return;
      }
      if (time < start) start = time;
      if (time > end) end = time;
    });
  });

  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return { start, end };
  }

  const fiberPoints = bundle?.situation?.fiber_track?.segments?.all;
  start = Infinity;
  end = -Infinity;
  if (Array.isArray(fiberPoints)) {
    fiberPoints.forEach((pt) => {
      const time = Number(pt?.t);
      if (!Number.isFinite(time)) {
        return;
      }
      if (time < start) start = time;
      if (time > end) end = time;
    });
  }

  if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
    return { start, end };
  }

  return { start: 0, end: 30 };
}

function syncMapTimelineControls() {
  const extent = state.mapTimeline.extent || getMapTimelineExtentFromSituation(state.shotBundle);
  const hasExtent = Number.isFinite(extent.start) && Number.isFinite(extent.end) && extent.end > extent.start;
  const normalizedTime = clamp(Number.isFinite(state.mapTimeline.time) ? state.mapTimeline.time : extent.start, extent.start, extent.end);

  if (el.mapModeFull) {
    el.mapModeFull.setAttribute("aria-pressed", String(state.mapTimeline.mode === "full"));
  }
  if (el.mapModeTime) {
    el.mapModeTime.setAttribute("aria-pressed", String(state.mapTimeline.mode === "time"));
  }
  if (el.mapTimeSlider) {
    el.mapTimeSlider.min = extent.start.toFixed(2);
    el.mapTimeSlider.max = extent.end.toFixed(2);
    el.mapTimeSlider.step = hasExtent ? Math.max(0.05, (extent.end - extent.start) / 420).toFixed(3) : "0.1";
    el.mapTimeSlider.value = normalizedTime.toFixed(2);
    el.mapTimeSlider.disabled = !state.shotBundle || state.mapTimeline.mode !== "time" || !hasExtent;
  }
  if (el.mapTimePlay) {
    el.mapTimePlay.setAttribute("aria-pressed", String(state.mapTimeline.playing));
    el.mapTimePlay.textContent = state.mapTimeline.playing ? "Pause timeline" : "Play timeline";
    el.mapTimePlay.hidden = state.mapTimeline.mode !== "time";
    el.mapTimePlay.disabled = !state.shotBundle || !hasExtent || state.mapTimeline.mode !== "time";
  }
  if (el.mapTimeValue) {
    el.mapTimeValue.textContent = state.mapTimeline.mode === "full"
      ? "Full map"
      : `Map time ${formatSeconds(normalizedTime)}`;
  }
  if (el.mapTimeNote) {
    el.mapTimeNote.textContent = state.mapTimeline.mode === "full" ? "" : "Situation timeline only";
  }
  updateMapSnapshotPanel();
}

function resetMapTimelineForShot() {
  stopMapTimelinePlayback();
  const extent = getMapTimelineExtentFromSituation(state.shotBundle);
  state.mapTimeline.extent = extent;
  state.mapTimeline.mode = "full";
  state.mapTimeline.time = extent.start;
  syncMapTimelineControls();
}

function stopMapTimelinePlayback() {
  state.mapTimeline.playing = false;
  state.mapTimelineLastTickMs = 0;
  if (state.mapTimelinePlayFrame) {
    cancelAnimationFrame(state.mapTimelinePlayFrame);
    state.mapTimelinePlayFrame = 0;
  }
}

function startMapTimelinePlayback() {
  const extent = state.mapTimeline.extent || getMapTimelineExtentFromSituation(state.shotBundle);
  if (!Number.isFinite(extent.start) || !Number.isFinite(extent.end) || extent.end <= extent.start) {
    return;
  }

  state.mapTimeline.mode = "time";
  if (state.mapTimeline.time >= extent.end - 1e-6) {
    state.mapTimeline.time = extent.start;
  }
  state.mapTimeline.playing = true;
  state.mapTimelineLastTickMs = 0;

  const tick = (timestampMs) => {
    if (!state.mapTimeline.playing) {
      state.mapTimelinePlayFrame = 0;
      return;
    }

    if (!state.mapTimelineLastTickMs) {
      state.mapTimelineLastTickMs = timestampMs;
    }
    const dtSec = Math.max(0, (timestampMs - state.mapTimelineLastTickMs) / 1000);
    state.mapTimelineLastTickMs = timestampMs;

    const currExtent = state.mapTimeline.extent || getMapTimelineExtentFromSituation(state.shotBundle);
    const nextTime = state.mapTimeline.time + dtSec * MAP_TIMELINE_PLAY_SPEED_S;

    if (nextTime >= currExtent.end) {
      state.mapTimeline.time = currExtent.end;
      stopMapTimelinePlayback();
      syncMapTimelineControls();
      scheduleMapRender();
      return;
    }

    state.mapTimeline.time = nextTime;
    syncMapTimelineControls();
    scheduleMapRender();
    state.mapTimelinePlayFrame = requestAnimationFrame(tick);
  };

  syncMapTimelineControls();
  scheduleMapRender();
  state.mapTimelinePlayFrame = requestAnimationFrame(tick);
}

function toggleMapTimelinePlayback() {
  if (state.mapTimeline.playing) {
    stopMapTimelinePlayback();
    syncMapTimelineControls();
    return;
  }
  startMapTimelinePlayback();
}

function setMapTimelineMode(mode) {
  if (mode !== "full" && mode !== "time") {
    return;
  }
  if (mode === "full") {
    stopMapTimelinePlayback();
  }
  state.mapTimeline.mode = mode;
  syncMapTimelineControls();
  scheduleMapRender();
}

function setMapTimelineTime(timeValue) {
  const extent = state.mapTimeline.extent || getMapTimelineExtentFromSituation(state.shotBundle);
  state.mapTimeline.time = clamp(timeValue, extent.start, extent.end);
  syncMapTimelineControls();
  scheduleMapRender();
}
