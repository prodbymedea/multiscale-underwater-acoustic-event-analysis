function getTimeExtentFromShotBundle(bundle) {
  const avail = state.selectedManifest?.available_time_range_s;
  if (Array.isArray(avail) && avail.length >= 2 && Number.isFinite(avail[0]) && Number.isFinite(avail[1]) && avail[1] > avail[0]) {
    return { start: avail[0], end: avail[1] };
  }
  const manifestRange = state.selectedManifest?.time_extent_s;
  if (manifestRange && Number.isFinite(manifestRange.start) && Number.isFinite(manifestRange.end)) {
    return { start: manifestRange.start, end: manifestRange.end };
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

function getCurrentInterval() {
  return getTimeExtentFromShotBundle(state.shotBundle);
}

function syncCursorToInterval() {
  const interval = getCurrentInterval();
  state.cursorTime = clamp(state.cursorTime, interval.start, interval.end);
}

function updateCurrentIntervalLabel() {
  const timeExtent = getCurrentInterval();
  if (el.metaRecommended) {
    el.metaRecommended.textContent = `${formatSeconds(timeExtent.start)} to ${formatSeconds(timeExtent.end)}`;
  }
  updateMapShotSummary();
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
  if (!el.metaActiveEvent) {
    return;
  }
  if (!active) {
    el.metaActiveEvent.textContent = "None";
    return;
  }
  el.metaActiveEvent.textContent = `${active.event_id} (${active.start_time_s.toFixed(2)}-${active.end_time_s.toFixed(2)} s)`;
}

function getSourceGroundTruth() {
  const manifestSource = state.selectedManifest?.source_ground_truth;
  if (manifestSource?.available) {
    const x = Number(manifestSource.position_xy_m?.[0] ?? manifestSource.x);
    const y = Number(manifestSource.position_xy_m?.[1] ?? manifestSource.y);
    const depth = Number(manifestSource.depth_m);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return { available: true, x, y, depth };
    }
  }

  const source = state.shotBundle?.shotMetadata?.source;
  const sourceX = Number(source?.pos_x_m);
  const sourceY = Number(source?.pos_y_m);
  if (source && Number.isFinite(sourceX) && Number.isFinite(sourceY)) {
    return {
      available: true,
      x: sourceX,
      y: sourceY,
      depth: Number(source.depth_m)
    };
  }

  return { available: false };
}

function renderManifestMetadata() {
  const shotId = state.selectedManifest?.shot_id || state.selectedShotId;
  const timeExtent = getTimeExtentFromShotBundle(state.shotBundle);
  const sourceGt = getSourceGroundTruth();

  if (el.metaShot) el.metaShot.textContent = shotId || "-";
  if (el.metaTimeRange) el.metaTimeRange.textContent = `${formatSeconds(timeExtent.start)} to ${formatSeconds(timeExtent.end)}`;
  if (el.metaRecommended) el.metaRecommended.textContent = `${formatSeconds(timeExtent.start)} to ${formatSeconds(timeExtent.end)}`;
  if (el.metaEventCount) el.metaEventCount.textContent = Number.isFinite(state.eventCount) ? String(state.eventCount) : "Unknown";
  if (el.metaGroundTruth) el.metaGroundTruth.textContent = sourceGt.available ? "Available" : "Not available";
  renderActiveEventLabel();

  updateCurrentIntervalLabel();
}
