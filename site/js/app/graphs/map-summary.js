function getSelectedChannelSummary() {
  const sc = state.shotBundle?.selectedChannel;
  if (!sc?.available) {
    return {
      channel: "Unavailable",
      distance: "-",
      band: "-"
    };
  }

  const previewCol = Number(sc.activePreviewCol ?? sc.meta?.selected_preview_col ?? sc.manifestDemo?.preview_column ?? sc.manifestDemo?.default_preview_col);
  const entry = Number.isFinite(previewCol) ? sc.entryByCol?.[String(previewCol)] : null;
  const raw = Number(entry?.raw_das_channel_index ?? sc.meta?.selected_raw_channel ?? sc.manifestDemo?.raw_das_channel);
  const distance = Number(entry?.distance_m ?? sc.meta?.selected_distance_m);
  const parts = [];

  if (Number.isFinite(previewCol)) {
    parts.push(`preview ${previewCol}`);
  }
  if (Number.isFinite(raw)) {
    parts.push(`raw ${raw}`);
  }

  return {
    channel: parts.length ? parts.join(" / ") : (sc.meta?.selected_channel_label || "Loaded"),
    distance: Number.isFinite(distance) ? `${distance.toFixed(1)} m along cable` : "-",
    band: Array.isArray(sc.band?.bandHz) && Number.isFinite(sc.band.bandHz[0]) && Number.isFinite(sc.band.bandHz[1])
      ? `${sc.band.bandHz[0].toFixed(0)}-${sc.band.bandHz[1].toFixed(0)} Hz`
      : "-"
  };
}

function renderMapChannelChips(sc) {
  if (!el.mapChannelChipsWrap || !el.mapChannelChips) {
    return;
  }
  el.mapChannelChips.innerHTML = "";
  if (!sc?.available || !sc.multiChannel || !sc.entryByCol) {
    el.mapChannelChipsWrap.hidden = true;
    return;
  }

  const channels = Object.values(sc.entryByCol)
    .filter((entry) => Number.isFinite(Number(entry?.preview_col)))
    .sort((a, b) => Number(a.preview_col) - Number(b.preview_col));
  if (!channels.length) {
    el.mapChannelChipsWrap.hidden = true;
    return;
  }

  channels.forEach((entry) => {
    const previewCol = Number(entry.preview_col);
    const raw = Number(entry.raw_das_channel_index);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "map-channel-chip";
    chip.setAttribute("role", "listitem");
    chip.textContent = Number.isFinite(raw) ? `p${previewCol} / ${raw}` : `p${previewCol}`;
    if (Number(sc.activePreviewCol) === previewCol) {
      chip.classList.add("active");
    }
    chip.addEventListener("click", () => {
      void switchSelectedChannelToPreviewCol(previewCol);
    });
    el.mapChannelChips.appendChild(chip);
  });
  el.mapChannelChipsWrap.hidden = false;
}

function updateMapShotSummary() {
  if (!el.mapSummaryChannel || !el.mapSummaryDistance || !el.mapSummaryHint) {
    return;
  }

  const shotId = state.selectedManifest?.shot_id || state.selectedShotId || "-";
  const interval = getCurrentInterval();
  const sourceGt = getSourceGroundTruth();
  const selectedChannel = getSelectedChannelSummary();
  const sc = state.shotBundle?.selectedChannel;

  if (el.mapSummaryShot) {
    el.mapSummaryShot.textContent = shotId;
  }
  if (el.mapSummaryEvents) {
    const intervalEventCount = getEventsForInterval(interval).length;
    const totalEventCount = getEventList().length;
    el.mapSummaryEvents.textContent = Number.isFinite(totalEventCount)
      ? `${intervalEventCount}/${totalEventCount} in interval`
      : "Events unknown";
  }
  if (el.mapSummaryInterval) {
    el.mapSummaryInterval.textContent = `${formatSeconds(interval.start)} - ${formatSeconds(interval.end)}`;
  }
  el.mapSummaryChannel.textContent = selectedChannel.channel;
  el.mapSummaryDistance.textContent = selectedChannel.distance;
  if (el.mapSummaryBand) {
    el.mapSummaryBand.textContent = selectedChannel.band;
  }
  if (el.mapSummarySource) {
    el.mapSummarySource.textContent = sourceGt.available ? "Source available" : "No source";
  }
  el.mapSummaryHint.textContent = sc?.available && sc.multiChannel
    ? "Choose an exported DAS channel."
    : "Selected-channel export is fixed for this shot.";
  renderMapChannelChips(sc);
}

function updateMapSnapshotPanel() {
  if (!el.mapSnapEvent) {
    return;
  }
  const source = getSourceGroundTruth();
  const tracks = state.shotBundle?.situation?.boat_tracks?.tracks || {};
  const recorders = state.shotBundle?.recordersSummary || {};
  const trackCount = Object.values(tracks).filter((pts) => Array.isArray(pts) && pts.length > 1).length;
  const recorderCount = Object.keys(recorders).length;
  const mapTime = state.mapTimeline.mode === "time"
    ? formatSeconds(Number(state.mapTimeline.time || 0))
    : "Full extent";

  el.mapSnapEvent.textContent = mapTime;
  el.mapSnapDepth.textContent = source.available && Number.isFinite(source.depth) ? `${source.depth.toFixed(1)} m` : "-";
  el.mapSnapSourceX.textContent = source.available && Number.isFinite(source.x) && Number.isFinite(source.y)
    ? `${source.x.toFixed(1)} / ${source.y.toFixed(1)}`
    : "-";
  el.mapSnapTracks.textContent = String(trackCount);
  el.mapSnapRecorders.textContent = String(recorderCount);
}
