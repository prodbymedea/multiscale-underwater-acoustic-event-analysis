const SHOT_FALLBACK = ["whales_humpback", "whales_orca"];
const OUTPUT_BASE_CANDIDATES = ["../output", "./data", "output"];

const state = {
  indexSource: null,
  manifestSource: null,
  shotOptions: [],
  selectedShotId: null,
  selectedManifest: null,
  eventCount: null,
  playing: false
};

const el = {
  shotSelect: document.getElementById("shot-select"),
  startInput: document.getElementById("interval-start"),
  endInput: document.getElementById("interval-end"),
  playBtn: document.getElementById("play-btn"),
  pauseBtn: document.getElementById("pause-btn"),
  playbackStatus: document.getElementById("playback-status"),
  dataStatus: document.getElementById("data-status"),
  metaShot: document.getElementById("meta-shot"),
  metaTimeRange: document.getElementById("meta-time-range"),
  metaRecommended: document.getElementById("meta-recommended"),
  metaCurrentInterval: document.getElementById("meta-current-interval"),
  metaEventCount: document.getElementById("meta-event-count"),
  metaGroundTruth: document.getElementById("meta-ground-truth"),
  metaManifestFiles: document.getElementById("meta-manifest-files")
};

function updateDataStatus(message) {
  el.dataStatus.textContent = message;
}

function setPlayback(playing) {
  state.playing = playing;
  el.playBtn.disabled = playing;
  el.pauseBtn.disabled = !playing;
  el.playbackStatus.textContent = playing ? "Playing (skeleton state)" : "Paused";
}

function formatSeconds(value) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  return `${value.toFixed(2)} s`;
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function tryLoadJsonFromCandidates(relativePath, baseCandidates) {
  const failures = [];
  for (const base of baseCandidates) {
    const url = `${base}/${relativePath}`;
    try {
      const data = await fetchJson(url);
      return { data, url };
    } catch (err) {
      failures.push(`${url} (${err.message})`);
    }
  }
  return { data: null, url: null, failures };
}

function parseIndexToShotOptions(indexData, indexUrl) {
  const shotSet = new Set();
  const options = [];

  function pushShot(shotId, manifestPath) {
    if (!shotId || shotSet.has(shotId)) {
      return;
    }
    shotSet.add(shotId);
    options.push({ shotId, manifestPath: manifestPath || null });
  }

  if (Array.isArray(indexData)) {
    indexData.forEach((item) => {
      if (typeof item === "string") {
        pushShot(item, null);
      } else if (item && typeof item === "object") {
        pushShot(item.shot_id || item.id, item.manifest || item.manifest_path || item.path);
      }
    });
  }

  if (indexData && typeof indexData === "object") {
    const arraysToScan = [indexData.shots, indexData.items];
    arraysToScan.forEach((arr) => {
      if (!Array.isArray(arr)) {
        return;
      }
      arr.forEach((item) => {
        if (typeof item === "string") {
          pushShot(item, null);
        } else if (item && typeof item === "object") {
          pushShot(item.shot_id || item.id, item.manifest || item.manifest_path || item.path);
        }
      });
    });

    if (indexData.by_shot && typeof indexData.by_shot === "object") {
      Object.entries(indexData.by_shot).forEach(([shotId, value]) => {
        if (value && typeof value === "object") {
          pushShot(shotId, value.manifest || value.manifest_path || value.path);
        } else {
          pushShot(shotId, null);
        }
      });
    }
  }

  if (options.length === 0) {
    SHOT_FALLBACK.forEach((shotId) => pushShot(shotId, null));
  }

  state.indexSource = indexUrl;
  return options;
}

function renderShotOptions() {
  el.shotSelect.innerHTML = "";
  state.shotOptions.forEach((option) => {
    const node = document.createElement("option");
    node.value = option.shotId;
    node.textContent = option.shotId;
    el.shotSelect.appendChild(node);
  });
}

function parseNumeric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clampIntervalToTimeRange(start, end, timeExtent) {
  if (!timeExtent || !Number.isFinite(timeExtent.start) || !Number.isFinite(timeExtent.end)) {
    return { start, end };
  }

  const safeStart = Math.max(timeExtent.start, Math.min(start, timeExtent.end));
  const safeEnd = Math.max(safeStart, Math.min(end, timeExtent.end));
  return { start: safeStart, end: safeEnd };
}

function getRecommendedInterval(manifest) {
  const duration = manifest?.viewer_defaults?.interval_duration_s;
  const timeExtent = manifest?.time_extent_s;

  if (!Number.isFinite(duration) || !timeExtent || !Number.isFinite(timeExtent.start) || !Number.isFinite(timeExtent.end)) {
    return null;
  }

  const start = timeExtent.start;
  const end = Math.min(start + duration, timeExtent.end);
  return { start, end, duration };
}

async function loadEventCount(manifest) {
  const explicitCount = manifest?.event_count;
  if (Number.isFinite(explicitCount)) {
    return explicitCount;
  }

  const eventsFile = manifest?.files?.events;
  if (!eventsFile) {
    return null;
  }

  const basePath = state.manifestSource ? state.manifestSource.split("/").slice(0, -1).join("/") : null;
  const candidateUrls = [];

  if (basePath && !eventsFile.startsWith("http")) {
    candidateUrls.push(`${basePath}/${eventsFile}`);
  }

  if (eventsFile.startsWith("http")) {
    candidateUrls.push(eventsFile);
  }

  for (const url of candidateUrls) {
    try {
      const eventsData = await fetchJson(url);
      if (Number.isFinite(eventsData?.n_events)) {
        return eventsData.n_events;
      }
      if (Array.isArray(eventsData?.events)) {
        return eventsData.events.length;
      }
    } catch (_) {
      // Keep this non-fatal for skeleton mode.
    }
  }

  return null;
}

async function loadManifestForShot(shotOption) {
  const manifestRelativeFallback = `shots/${shotOption.shotId}/viewer_manifest.json`;
  const candidateUrls = [];

  if (shotOption.manifestPath) {
    if (shotOption.manifestPath.startsWith("http")) {
      candidateUrls.push(shotOption.manifestPath);
    } else {
      OUTPUT_BASE_CANDIDATES.forEach((base) => {
        candidateUrls.push(`${base}/${shotOption.manifestPath}`);
      });
    }
  }

  OUTPUT_BASE_CANDIDATES.forEach((base) => {
    candidateUrls.push(`${base}/${manifestRelativeFallback}`);
  });

  for (const url of candidateUrls) {
    try {
      const manifest = await fetchJson(url);
      return { manifest, sourceUrl: url };
    } catch (_) {
      // Try next path.
    }
  }

  return { manifest: null, sourceUrl: null };
}

function renderManifestMetadata(manifest, eventCount, fallbackShotId) {
  const shotId = manifest?.shot_id || fallbackShotId;
  const timeExtent = manifest?.time_extent_s;
  const recommended = getRecommendedInterval(manifest);
  const sourceGt = manifest?.source_ground_truth;

  el.metaShot.textContent = shotId || "-";

  if (timeExtent && Number.isFinite(timeExtent.start) && Number.isFinite(timeExtent.end)) {
    el.metaTimeRange.textContent = `${formatSeconds(timeExtent.start)} to ${formatSeconds(timeExtent.end)}`;
  } else {
    el.metaTimeRange.textContent = "Not available";
  }

  if (recommended) {
    el.metaRecommended.textContent = `${formatSeconds(recommended.start)} to ${formatSeconds(recommended.end)} (duration ${formatSeconds(recommended.duration)})`;
  } else {
    el.metaRecommended.textContent = "Not available";
  }

  el.metaEventCount.textContent = Number.isFinite(eventCount) ? String(eventCount) : "Unknown";

  if (sourceGt && typeof sourceGt.available === "boolean") {
    el.metaGroundTruth.textContent = sourceGt.available ? "Available" : "Not available";
  } else {
    el.metaGroundTruth.textContent = "Unknown";
  }

  const manifestFiles = manifest?.files && typeof manifest.files === "object"
    ? Object.keys(manifest.files)
    : [];
  el.metaManifestFiles.textContent = manifestFiles.length > 0
    ? manifestFiles.join(", ")
    : "Not available";
}

function updateCurrentIntervalLabel() {
  const start = parseNumeric(el.startInput.value);
  const end = parseNumeric(el.endInput.value);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    el.metaCurrentInterval.textContent = "-";
    return;
  }
  el.metaCurrentInterval.textContent = `${formatSeconds(start)} to ${formatSeconds(end)}`;
}

function applyIntervalDefaults(manifest) {
  const recommended = getRecommendedInterval(manifest);
  const timeExtent = manifest?.time_extent_s;

  if (recommended) {
    el.startInput.value = recommended.start.toFixed(2);
    el.endInput.value = recommended.end.toFixed(2);
  } else if (timeExtent && Number.isFinite(timeExtent.start) && Number.isFinite(timeExtent.end)) {
    const fallbackEnd = Math.min(timeExtent.start + 30, timeExtent.end);
    el.startInput.value = timeExtent.start.toFixed(2);
    el.endInput.value = fallbackEnd.toFixed(2);
  } else {
    el.startInput.value = "0.00";
    el.endInput.value = "30.00";
  }

  const start = parseNumeric(el.startInput.value) ?? 0;
  const end = parseNumeric(el.endInput.value) ?? 30;
  const clamped = clampIntervalToTimeRange(start, end, timeExtent);

  el.startInput.value = clamped.start.toFixed(2);
  el.endInput.value = clamped.end.toFixed(2);
  updateCurrentIntervalLabel();
}

async function onShotChanged() {
  const selectedShotId = el.shotSelect.value;
  const shotOption = state.shotOptions.find((option) => option.shotId === selectedShotId);
  state.selectedShotId = selectedShotId;

  if (!shotOption) {
    updateDataStatus("No shot option selected.");
    return;
  }

  updateDataStatus(`Loading manifest for ${selectedShotId}...`);
  const { manifest, sourceUrl } = await loadManifestForShot(shotOption);

  state.selectedManifest = manifest;
  state.manifestSource = sourceUrl;

  if (manifest) {
    const eventCount = await loadEventCount(manifest);
    state.eventCount = eventCount;
    applyIntervalDefaults(manifest);
    renderManifestMetadata(manifest, eventCount, selectedShotId);
    updateDataStatus(
      `Loaded manifest for ${selectedShotId}${sourceUrl ? ` from ${sourceUrl}` : ""}.`
    );
  } else {
    state.eventCount = null;
    renderManifestMetadata(null, null, selectedShotId);
    el.startInput.value = "0.00";
    el.endInput.value = "30.00";
    updateCurrentIntervalLabel();
    updateDataStatus(
      `Manifest not found for ${selectedShotId}. Showing skeleton placeholders only.`
    );
  }

  setPlayback(false);
}

async function initialize() {
  setPlayback(false);
  el.playBtn.addEventListener("click", () => setPlayback(true));
  el.pauseBtn.addEventListener("click", () => setPlayback(false));

  const onIntervalInput = () => {
    const start = parseNumeric(el.startInput.value);
    const end = parseNumeric(el.endInput.value);
    const timeExtent = state.selectedManifest?.time_extent_s;

    if (Number.isFinite(start) && Number.isFinite(end) && timeExtent) {
      const clamped = clampIntervalToTimeRange(start, end, timeExtent);
      el.startInput.value = clamped.start.toFixed(2);
      el.endInput.value = clamped.end.toFixed(2);
    }
    updateCurrentIntervalLabel();
  };

  el.startInput.addEventListener("change", onIntervalInput);
  el.endInput.addEventListener("change", onIntervalInput);

  updateDataStatus("Loading shot list from viewer index...");
  const indexLoad = await tryLoadJsonFromCandidates("viewer_index.json", OUTPUT_BASE_CANDIDATES);

  if (indexLoad.data) {
    state.shotOptions = parseIndexToShotOptions(indexLoad.data, indexLoad.url);
    updateDataStatus(`Loaded shot list from ${indexLoad.url}.`);
  } else {
    state.indexSource = null;
    state.shotOptions = SHOT_FALLBACK.map((shotId) => ({ shotId, manifestPath: null }));
    updateDataStatus(
      "viewer_index.json not found. Using fallback shot list (whales_humpback, whales_orca)."
    );
  }

  renderShotOptions();
  el.shotSelect.addEventListener("change", onShotChanged);
  await onShotChanged();
}

initialize();
