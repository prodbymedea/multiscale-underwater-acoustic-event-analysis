function renderAllPanels() {
  syncCursorToInterval();
  updateCurrentIntervalLabel();
  updatePlaybackLabel();
  renderActiveEventLabel();
  renderDasPanel();
  renderSelectedChannelPanel();
  renderHydroPanel();
  renderEventNavigation();
  updateMapShotSummary();
  updateMapSnapshotPanel();
}

function seekSelchCursorToTime(targetTime, sourceLabel, options = {}) {
  if (!Number.isFinite(targetTime)) {
    return;
  }
  const { announce = true } = options;
  const geo = state.geometry.selch;
  const fallbackRange = getSelectedChannelFullTimeRange(state.shotBundle?.selectedChannel);
  const timeStart = Number.isFinite(geo?.timeStart) ? geo.timeStart : fallbackRange.start;
  const timeEnd = Number.isFinite(geo?.timeEnd) ? geo.timeEnd : fallbackRange.end;
  state.selchCursorTime = clamp(targetTime, timeStart, timeEnd);
  renderSelectedChannelPanel();
  renderHydroPanel();
  if (announce) {
    updateDataStatus(`Selected DAS channel cursor moved to ${state.selchCursorTime.toFixed(2)} s via ${sourceLabel}.`);
  }
}

function hitTestSelchTime(event) {
  const geo = state.geometry.selch;
  if (!geo || !geo.plotW) {
    return null;
  }
  const x = event.offsetX;
  if (x < geo.pad.left || x > geo.pad.left + geo.plotW) {
    return null;
  }
  const timeStart = Number.isFinite(geo.timeStart) ? geo.timeStart : geo.interval.start;
  const timeEnd = Number.isFinite(geo.timeEnd) ? geo.timeEnd : geo.interval.end;
  const t =
    timeStart +
    ((x - geo.pad.left) / Math.max(1e-9, geo.plotW)) * (timeEnd - timeStart);
  return {
    time: t,
    clientX: event.clientX,
    clientY: event.clientY
  };
}

function seekFromSelchPointer(event) {
  const hit = hitTestSelchTime(event);
  if (!hit) {
    return;
  }
  seekSelchCursorToTime(hit.time, "selected-channel view", { announce: false });
}

function bindSelchCanvas(canvas) {
  if (!canvas) {
    return;
  }
  canvas.addEventListener("mousedown", (event) => {
    state.draggingTarget = "selch";
    seekFromSelchPointer(event);
  });
  canvas.addEventListener("click", (event) => {
    const hit = hitTestSelchTime(event);
    if (!hit) {
      return;
    }
    seekSelchCursorToTime(hit.time, "selected-channel view", { announce: true });
  });
  canvas.addEventListener(
    "mousemove",
    (event) => {
      if (state.draggingTarget === "selch") {
        seekFromSelchPointer(event);
      }
    },
    { passive: true }
  );
}

function onGlobalPointerUp(event) {
  const wasMapDrag = state.draggingTarget === "map";
  if (state.draggingTarget === "map" && state.mapPointerDown && !state.mapPointerDown.moved && event && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
    tryMapClickSelectChannel(event.clientX, event.clientY);
  }
  state.draggingTarget = null;
  state.mapPointerDown = null;
  state.mapPanDX = 0;
  state.mapPanDY = 0;
  state.mapPanLastRenderTs = 0;
  if (el.mapSvg) {
    el.mapSvg.style.cursor = "grab";
  }
  if (wasMapDrag) {
    scheduleMapRender();
  }
}

function getManifestCandidateUrls(shotOption) {
  const urls = [];
  const seen = new Set();
  const push = (u) => {
    if (u && !seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  };

  /* Prefer the locked output base if we already discovered one. */
  const locked = assetResolver.lockedBases.output;
  const bases = locked
    ? [locked, ...ASSET_BASE_CANDIDATES.output.filter((b) => b !== locked)]
    : ASSET_BASE_CANDIDATES.output.slice();

  if (shotOption.manifestPath) {
    if (shotOption.manifestPath.startsWith("http")) {
      push(shotOption.manifestPath);
    } else {
      /* viewer_index lists e.g. "output/shots/<id>/viewer_manifest.json".
       * That leading "output/" is doubled if naively joined with an output
       * base. Try both with and without the prefix to stay robust. */
      const rel = _normalizeRel(shotOption.manifestPath);
      const stripped = rel.startsWith("output/") ? rel.slice("output/".length) : rel;
      bases.forEach((base) => {
        push(`${base}/${stripped}`);
        const baseEndsWithOutput = /\/output$/.test(base);
        if (stripped !== rel && !baseEndsWithOutput) {
          push(`${base}/${rel}`);
        }
      });
    }
  }

  bases.forEach((base) => {
    push(`${base}/shots/${shotOption.shotId}/viewer_manifest.json`);
  });

  return urls;
}

function getBaseDir(url) {
  const idx = url.lastIndexOf("/");
  return idx >= 0 ? url.slice(0, idx) : "";
}

function runWhenIdle(task, timeout = 1800) {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => {
      void task();
    }, { timeout });
    return;
  }
  setTimeout(() => {
    void task();
  }, 700);
}

function shouldPrefetchLargeAssets() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) {
    return true;
  }
  if (conn.saveData) {
    return false;
  }
  const type = String(conn.effectiveType || "").toLowerCase();
  return type !== "slow-2g" && type !== "2g";
}

async function prefetchManifestAndWarmFilesForShot(shotOption) {
  const candidates = getManifestCandidateUrls(shotOption);
  const manifestRes = await tryLoadJsonFromUrls(candidates);
  if (!manifestRes?.data || !manifestRes?.url) {
    return;
  }

  const manifest = manifestRes.data;
  const baseDir = getBaseDir(manifestRes.url);
  const files = manifest.files || {};
  const prefetchSignal = new AbortController().signal;

  const jsonRel = [
    files.shot_metadata || "shot_metadata.json",
    files.recorders_summary || "recorders_summary.json",
    files.events || "events.json",
    files.situation || "situation.json",
    files.hydrophone_score_metadata_file || files.hydrophone_event_score_metadata || "hydrophone_event_score_metadata.json",
    files.selected_channels_index || "selected_channels_index.json",
    files.selected_channel_bundle || "selected_channel_bundle.json"
  ];

  for (const rel of jsonRel) {
    if (!rel) {
      continue;
    }
    try {
      await fetchJsonFromManifestPaths(baseDir, rel);
    } catch (_error) {
      // Keep warmup best-effort and non-fatal.
    }
  }

  const npzRel = [
    files.hydrophone_score_file || files.hydrophone_event_score || "hydrophone_event_score.npz",
    files.selected_channel_signal || "selected_channel_signal.npz",
    files.selected_channel_spectrogram || "selected_channel_spectrogram.npz",
    files.selected_channel_bandpass_score || "selected_channel_bandpass_score.npz"
  ];
  if (shouldPrefetchLargeAssets()) {
    npzRel.push(files.das_waterfall_preview || files.das_preprocessed_preview_file || "das_waterfall_preview.npz");
  }

  for (const rel of npzRel) {
    if (!rel) {
      continue;
    }
    const urls = manifestRelativeFetchUrls(baseDir, rel);
    for (const url of urls) {
      try {
        await fetchArrayBuffer(url, { signal: prefetchSignal });
        break;
      } catch (_error) {
        // Try fallback URL candidate.
      }
    }
  }
}

async function warmupRuntimeCaches() {
  if (!state.shotOptions?.length) {
    return;
  }
  const currentShotId = state.selectedShotId;
  const otherShot = state.shotOptions.find((option) => option.shotId !== currentShotId);
  if (otherShot) {
    await prefetchManifestAndWarmFilesForShot(otherShot);
  }

  const sac = state.shotBundle?.sourceAudioCompare || state.shotBundle?.orcaAudioCompare;
  const relAudio = sac?.doc?.source_wav_playback_file || sac?.doc?.source_wav_file;
  if (sac?.baseDir && relAudio && shouldPrefetchLargeAssets()) {
    try {
      await fetchArrayBuffer(`${sac.baseDir}/${relAudio}`, { signal: new AbortController().signal });
    } catch (_error) {
      // Audio warmup is optional.
    }
  }

  const outputBase = assetResolver.lockedBases.output || OUTPUT_BASE_CANDIDATES[0] || "output";
  const envFiles = [
    "environmental/environmental_mvp_meta.json",
    "environmental/alplakes_geometry.txt.gz"
  ];
  if (shouldPrefetchLargeAssets()) {
    envFiles.push("environmental/environmental_map_fields.npz");
  }
  for (const rel of envFiles) {
    const url = `${outputBase}/${rel}`;
    try {
      if (rel.endsWith(".json")) {
        await fetchJson(url, { signal: new AbortController().signal });
      } else {
        await fetchArrayBuffer(url, { signal: new AbortController().signal });
      }
    } catch (_error) {
      // Environment warmup is optional.
    }
  }
  console.info("[warmup] runtime cache warmup completed");
}

async function prefetchCurrentShotDasWaterfall(manifest, manifestUrl, shotId) {
  if (!manifest || !manifestUrl || !shotId) {
    return null;
  }
  const files = manifest.files || {};
  const rel = files.das_waterfall_preview || files.das_preprocessed_preview || files.das_preprocessed_preview_file || "das_waterfall_preview.npz";
  const cacheKey = `${shotId}|${rel}`;
  if (state.dasWaterfallCache[cacheKey] || state.dasWaterfallLoading[cacheKey]) {
    return state.dasWaterfallLoading[cacheKey] || state.dasWaterfallCache[cacheKey];
  }
  const loadSeq = state.shotLoadSeq;
  const baseDir = getBaseDir(manifestUrl);
  state.dasWaterfallLoading[cacheKey] = (async () => {
    try {
      const npz =
        (rel && (await fetchNpzFromManifestPaths(baseDir, rel))) ||
        (await fetchNpzFromManifestPaths(baseDir, "das_waterfall_preview.npz")) ||
        (await fetchNpzFromManifestPaths(baseDir, "das_preprocessed_preview.npz"));
      const built = buildDasWaterfallFromNpz(npz);
      if (!built) {
        throw new Error("Waterfall NPZ is missing data/t_s/channel_indices.");
      }
      state.dasWaterfallCache[cacheKey] = built;
      if (state.shotLoadSeq === loadSeq && state.selectedShotId === shotId && state.shotBundle) {
        state.shotBundle.dasWaterfall = built;
        if (state.dasViewMode === "waterfall") {
          renderDasPanel();
        }
      }
      return built;
    } catch (error) {
      console.warn(`[prefetchCurrentShotDasWaterfall] failed for ${shotId}: ${summarizeError(error)}`);
      return null;
    } finally {
      delete state.dasWaterfallLoading[cacheKey];
    }
  })();
  return state.dasWaterfallLoading[cacheKey];
}

function buildMetaFromChannelEntry(entry) {
  if (!entry) {
    return {};
  }
  return {
    selected_channel_label: entry.label,
    selected_preview_col: entry.preview_col,
    selected_raw_channel: entry.raw_das_channel_index,
    selected_distance_m: entry.distance_m
  };
}

function buildSelectedChannelPayloadFromNpz(signalNpz, specNpz, bandNpz) {
  const tSigRec = signalNpz.t_s;
  const sigRec = signalNpz.signal;
  if (!tSigRec?.data || !sigRec?.data) {
    throw new Error("signal NPZ missing t_s/signal arrays");
  }

  const tSpecRec = specNpz.t_s;
  const freqRec = specNpz.freqs_hz;
  const sxxRec = specNpz.Sxx_db;
  if (!tSpecRec?.data || !freqRec?.data || !sxxRec?.data) {
    throw new Error("spectrogram NPZ incomplete");
  }

  const shape = sxxRec.shape || [];
  if (shape.length < 2) {
    throw new Error("Sxx_db must be 2-D");
  }
  const nf = shape[0];
  const nt = shape[1];

  const tBandRec = bandNpz.t_s;
  const scoreRec = bandNpz.bandpass_support_score;
  if (!tBandRec?.data || !scoreRec?.data) {
    throw new Error("band-pass NPZ incomplete");
  }

  let maskArr = null;
  if (bandNpz.signal_present_mask?.data) {
    maskArr = bandNpz.signal_present_mask.data;
  }

  let threshold = null;
  if (bandNpz.threshold?.data?.length) {
    threshold = Number(bandNpz.threshold.data[0]);
  }

  let bandHz = null;
  if (bandNpz.band_hz?.data && bandNpz.band_hz.shape[0] >= 2) {
    bandHz = [Number(bandNpz.band_hz.data[0]), Number(bandNpz.band_hz.data[1])];
  }

  let signalFs = null;
  if (signalNpz.fs_hz?.data?.length) {
    signalFs = Number(signalNpz.fs_hz.data[0]);
  }

  let bandpassAudio = null;
  const bpWf = signalNpz.bandpass_waveform;
  if (bpWf?.data?.length && tSigRec.data?.length && bpWf.data.length === tSigRec.data.length && Number.isFinite(signalFs)) {
    bandpassAudio = {
      t: tSigRec.data,
      y: bpWf.data,
      fs: signalFs
    };
  }

  return {
    signal: {
      t: tSigRec.data,
      y: sigRec.data
    },
    signalFs,
    bandpassAudio,
    spec: {
      t: tSpecRec.data,
      freqs: freqRec.data,
      sxx: sxxRec.data,
      nf,
      nt,
      fortran: !!sxxRec.fortran
    },
    band: {
      t: tBandRec.data,
      score: scoreRec.data,
      mask: maskArr,
      threshold,
      bandHz
    }
  };
}

async function loadSelectedChannelNpzTriple(baseDir, sigRel, specRel, bandRel) {
  if (!sigRel || !specRel || !bandRel) {
    throw new Error("Missing NPZ path for selected-channel triple");
  }
  const [signalNpz, specNpz, bandNpz] = await Promise.all([
    fetchNpz(`${baseDir}/${sigRel}`),
    fetchNpz(`${baseDir}/${specRel}`),
    fetchNpz(`${baseDir}/${bandRel}`)
  ]);
  return buildSelectedChannelPayloadFromNpz(signalNpz, specNpz, bandNpz);
}

function applySelectedChannelPayload(sc, payload, entry) {
  sc.signal = payload.signal;
  sc.spec = payload.spec;
  sc.band = payload.band;
  sc.signalFs = payload.signalFs;
  sc.bandpassAudio = payload.bandpassAudio;
  if (entry) {
    sc.meta = buildMetaFromChannelEntry(entry);
  }
}

async function loadSelectedChannelIfPresent(manifest, manifestUrl) {
  const files = manifest?.files || {};
  const demo = manifest?.selected_channel_demo || null;

  if (manifest?.selected_channel_mode_available === false) {
    return {
      available: false,
      message: "Selected DAS channel is not available for this shot (manifest flag)."
    };
  }

  const baseDir = getBaseDir(manifestUrl);
  const selectedIndexRel = files.selected_channels_index || "selected_channels_index.json";
  const selectedBundleRel = files.selected_channel_bundle || "selected_channel_bundle.json";

  // Frontend compatibility: support selected-channel exports even when
  // viewer_manifest.json has not yet been patched with selected_channel_* keys.
  const index = await fetchJsonFromManifestPaths(baseDir, selectedIndexRel);
  if (index && Array.isArray(index.channels) && index.channels.length > 0) {
    const channels = index.channels;
    const entryByCol = {};
    channels.forEach((ch) => {
      if (ch && Number.isFinite(ch.preview_col)) {
        entryByCol[String(ch.preview_col)] = ch;
      }
    });
    const defaultCol = Number(
      index.default_preview_col ?? demo?.default_preview_col ?? demo?.preview_column ?? channels[0].preview_col
    );
    const defaultEntry = entryByCol[String(defaultCol)];
    if (!defaultEntry?.files) {
      return { available: false, message: `Default preview col ${defaultCol} missing from selected-channels index.` };
    }
    try {
      const f = defaultEntry.files;
      const payload = await loadSelectedChannelNpzTriple(baseDir, f.signal, f.spectrogram, f.bandpass_score);
      return {
        available: true,
        multiChannel: channels.length > 1,
        baseDir,
        manifestDemo:
          demo || {
            mode: "v2",
            default_preview_col: defaultCol,
            available_preview_cols: channels
              .map((ch) => ch?.preview_col)
              .filter((value) => Number.isFinite(value))
          },
        channelsIndex: index,
        entryByCol,
        activePreviewCol: defaultCol,
        channelCache: {
          [String(defaultCol)]: payload
        },
        meta: buildMetaFromChannelEntry(defaultEntry),
        ...payload
      };
    } catch (error) {
      return {
        available: false,
        message: `Selected-channel NPZ load failed: ${summarizeError(error)}`
      };
    }
  }

  let meta;
  try {
    meta = await fetchJsonFromManifestPaths(baseDir, selectedBundleRel);
    if (!meta) {
      return {
        available: false,
        message: "Selected DAS channel is not available for this shot (bundle/index files not found)."
      };
    }
  } catch (error) {
    return { available: false, message: `Could not load selected-channel bundle: ${summarizeError(error)}` };
  }

  const sigRel = files.selected_channel_signal || meta?.bundle_files?.signal_npz || "selected_channel_signal.npz";
  const specRel =
    files.selected_channel_spectrogram || meta?.bundle_files?.spectrogram_npz || "selected_channel_spectrogram.npz";
  const bandRel =
    files.selected_channel_bandpass_score || meta?.bundle_files?.bandpass_score_npz || "selected_channel_bandpass_score.npz";

  if (!sigRel || !specRel || !bandRel) {
    return { available: false, message: "Selected-channel export paths are incomplete in the manifest." };
  }

  try {
    const payload = await loadSelectedChannelNpzTriple(baseDir, sigRel, specRel, bandRel);
    return {
      available: true,
      multiChannel: false,
      baseDir,
      manifestDemo:
        demo || {
          mode: "v1",
          preview_column: meta?.selected_preview_col,
          raw_das_channel: meta?.selected_raw_channel,
          band_hz: meta?.recommended_bandpass_hz,
          channel_label: meta?.selected_channel_label,
          notes: ["Loaded from selected_channel_bundle.json auto-discovery (manifest keys optional)."]
        },
      meta,
      ...payload
    };
  } catch (error) {
    return {
      available: false,
      message: `Selected-channel NPZ load failed: ${summarizeError(error)}`
    };
  }
}

function getSelectedChannelPrefetchEntries(sc) {
  if (!sc?.available || !sc.multiChannel || !sc.entryByCol) {
    return [];
  }
  return Object.entries(sc.entryByCol)
    .map(([previewCol, entry]) => ({ previewCol: Number(previewCol), entry }))
    .filter(({ previewCol, entry }) => Number.isFinite(previewCol) && entry?.files)
    .filter(({ previewCol }) => previewCol !== sc.activePreviewCol);
}

async function prefetchSelectedChannelVariants(sc) {
  const entries = getSelectedChannelPrefetchEntries(sc);
  if (!entries.length) {
    return;
  }
  const startedAt = performance.now();
  const maxConcurrency = 2;
  const queue = entries.slice();
  const workers = Array.from({ length: Math.min(maxConcurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next?.entry?.files) {
        continue;
      }
      const key = String(next.previewCol);
      if (sc.channelCache?.[key]) {
        continue;
      }
      try {
        const f = next.entry.files;
        const payload = await loadSelectedChannelNpzTriple(sc.baseDir, f.signal, f.spectrogram, f.bandpass_score);
        sc.channelCache[key] = payload;
        console.info(`[selected-channel] preloaded preview col ${key}`);
      } catch (error) {
        console.warn(`[selected-channel] preload failed for preview col ${key}: ${summarizeError(error)}`);
      }
    }
  });
  await Promise.all(workers);
  console.info(`[selected-channel] prefetch complete in ${(performance.now() - startedAt).toFixed(1)} ms`);
}

async function switchSelectedChannelToPreviewCol(previewCol) {
  const sc = state.shotBundle?.selectedChannel;
  if (!sc?.available || !sc.multiChannel) {
    return;
  }
  stopSelchDemoAudio();
  const key = String(previewCol);
  const entry = sc.entryByCol?.[key];
  if (!entry?.files) {
    return;
  }
  if (sc.activePreviewCol === previewCol) {
    scheduleMainRender();
    scheduleMapRender();
    return;
  }
  const cached = sc.channelCache[key];
  if (cached) {
    applySelectedChannelPayload(sc, cached, entry);
    sc.activePreviewCol = previewCol;
    if (el.selchChannelSelect) {
      el.selchChannelSelect.value = key;
    }
    scheduleMainRender();
    scheduleMapRender();
    return;
  }
  updateDataStatus(`Loading selected-channel preview col ${previewCol}…`);
  try {
    const f = entry.files;
    const payload = await loadSelectedChannelNpzTriple(sc.baseDir, f.signal, f.spectrogram, f.bandpass_score);
    sc.channelCache[key] = payload;
    applySelectedChannelPayload(sc, payload, entry);
    sc.activePreviewCol = previewCol;
    if (el.selchChannelSelect) {
      el.selchChannelSelect.value = key;
    }
    updateDataStatus(`Selected-channel preview col ${previewCol} loaded.`);
    scheduleMainRender();
    scheduleMapRender();
  } catch (error) {
    updateDataStatus(`Selected-channel load failed: ${summarizeError(error)}`);
  }
}

async function loadManifestForShot(shotOption) {
  const candidates = getManifestCandidateUrls(shotOption);
  const result = await tryLoadJsonFromUrls(candidates);
  if (result.url && !assetResolver.lockedBases.output) {
    /* Infer the output base from the manifest URL by stripping the
     * "/shots/<id>/viewer_manifest.json" tail. */
    const m = result.url.match(/^(.*)\/shots\/[^/]+\/viewer_manifest\.json$/);
    if (m && m[1]) {
      assetResolver.lockedBases.output = m[1];
    }
  }
  return result;
}

async function loadBundleFromManifest(manifest, manifestUrl) {
  const baseDir = getBaseDir(manifestUrl);
  const files = manifest?.files || {};
  const missingCompatibilityFiles = [];

  async function loadFile(fileKey) {
    const relative = files[fileKey];
    if (!relative) {
      missingCompatibilityFiles.push(`${fileKey}: key missing in manifest.files`);
      return null;
    }
    try {
      return await fetchJson(`${baseDir}/${relative}`);
    } catch (_) {
      missingCompatibilityFiles.push(`${fileKey}: ${relative}`);
      return null;
    }
  }

  const [shotMetadata, recordersSummary, events, hydroActivity, situation] = await Promise.all([
    loadFile("shot_metadata"),
    loadFile("recorders_summary"),
    loadFile("events"),
    loadFile("hydrophone_activity"),
    loadFile("situation")
  ]);

  let sourceAudioCompare = null;
  const compareRel = files.source_audio_compare || files.orca_audio_compare;
  if (compareRel) {
    try {
      const doc = await fetchJson(`${baseDir}/${compareRel}`);
      if (doc && doc.schema_version === "orca_audio_compare_v1") {
        sourceAudioCompare = { doc, baseDir };
      }
    } catch (_) {
      sourceAudioCompare = null;
    }
  }

  return {
    shotMetadata,
    recordersSummary,
    events,
    hydroActivity,
    situation,
    sourceAudioCompare,
    orcaAudioCompare: sourceAudioCompare,
    missingCompatibilityFiles,
    mode: "full"
  };
}

async function loadFallbackBundle(shotId) {
  const shotMetadataRes = await tryLoadJsonFromCandidates(`shots/${shotId}/shot_metadata.json`, SAMPLE_BASE_CANDIDATES);
  const recordersRes = await tryLoadJsonFromCandidates(`shots/${shotId}/recorders_summary.json`, SAMPLE_BASE_CANDIDATES);
  const eventsRes = await tryLoadJsonFromCandidates(`shots/${shotId}/events.json`, SAMPLE_BASE_CANDIDATES);

  if (!shotMetadataRes.data && !eventsRes.data) {
    return null;
  }

  return {
    shotMetadata: shotMetadataRes.data,
    recordersSummary: recordersRes.data,
    events: eventsRes.data,
    hydroActivity: null,
    situation: null,
    mode: "fallback"
  };
}

function updateHoverTooltipFromDAS(event) {
  scheduleHoverTooltip("das", event, (latestEvent) => {
    const hit = hitTestDas(latestEvent);
    if (!hit) {
      state.hover.das = null;
      hideTooltip();
      return;
    }

    const axisLine = `Raw channel ${Number(hit.channel).toFixed(0)}`;
    const timeLine = Number.isFinite(Number(hit.sampleOffset))
      ? `Sample ${formatWaterfallAxisNumber(Number(hit.sampleOffset))} (${hit.time.toFixed(2)} s)`
      : `Time ${hit.time.toFixed(2)} s`;
    const valueLine = `Amplitude ${Number(hit.value).toFixed(3)}`;
    const shownInterval = hit.interval || getCurrentInterval();
    showTooltip(
      "DAS waterfall",
      `${timeLine}<br>${axisLine}<br>${valueLine}<br>Preview window ${shownInterval.start.toFixed(2)}-${shownInterval.end.toFixed(2)} s`,
      hit.clientX,
      hit.clientY
    );
  });
}

function updateHoverTooltipFromHydro(event) {
  scheduleHoverTooltip("hydro", event, (latestEvent) => {
    const hit = hitTestHydro(latestEvent);
    if (!hit) {
      state.hover.hydro = null;
      hideTooltip();
      return;
    }

    showTooltip(
      "Hydrophone reference activity",
      `Time ${hit.time.toFixed(2)} s<br>Reference score ${hit.score.toFixed(2)} dB<br>${Number.isFinite(hit.threshold) ? (hit.score >= hit.threshold ? "Above threshold" : "Below threshold") : "Baseline reference"}<br>Shown with selected DAS timeline`,
      hit.clientX,
      hit.clientY
    );
  });
}

async function onShotChanged() {
  if (state.activeShotFetchController) {
    try {
      state.activeShotFetchController.abort();
    } catch (_error) {
      // ignore abort errors
    }
  }
  state.activeShotFetchController = new AbortController();
  state.activeShotFetchSignal = state.activeShotFetchController.signal;

  const selectedShotId = el.shotSelect.value;
  const shotOption = state.shotOptions.find((option) => option.shotId === selectedShotId);
  const loadSeq = state.shotLoadSeq + 1;
  state.shotLoadSeq = loadSeq;
  state.selectedShotId = selectedShotId;
  updateEnvironmentalDashboardLink();
  syncViewerShotUrl(selectedShotId);
  state.selectedManifest = null;
  state.manifestSource = null;
  state.shotBundle = null;
  state.eventCount = null;
  hideTooltip();
  renderDasStatusMessage("Loading synchronized bundle...", "Loading synchronized DAS context...");

  if (!shotOption) {
    updateDataStatus("No shot option selected.");
    return;
  }

  setPlayback(false);
  stopSelchDemoAudio();
  updateDataStatus(`Loading synchronized bundle for ${selectedShotId}...`);

  const manifestResult = await loadManifestForShot(shotOption);
  if (loadSeq !== state.shotLoadSeq || state.selectedShotId !== selectedShotId) {
    return;
  }
  state.selectedManifest = manifestResult.data;
  state.manifestSource = manifestResult.url;

  try {
    if (manifestResult.data && manifestResult.url) {
      const waterfallPrefetch = prefetchCurrentShotDasWaterfall(manifestResult.data, manifestResult.url, selectedShotId);
      const bundle = await loadBundleFromManifest(manifestResult.data, manifestResult.url);
      if (loadSeq !== state.shotLoadSeq || state.selectedShotId !== selectedShotId) {
        return;
      }
      bundle.selectedChannel = {
        loading: true,
        available: false,
        message: "Loading selected DAS channel preview..."
      };
      state.shotBundle = bundle;
      resetMapViewport();
      resetMapTimelineForShot();
      state.eventCount = getEventList().length;
      state.cursorTime = getCurrentInterval().start;
      renderManifestMetadata();
      renderAllPanels();
      scheduleMapRender();

      void waterfallPrefetch;
      void (async () => {
        const [hydroLoaded, selectedChannel] = await Promise.all([
          attachMainPanelsFromNpzFallback(manifestResult.data, manifestResult.url, bundle),
          loadSelectedChannelIfPresent(manifestResult.data, manifestResult.url)
        ]);
        if (loadSeq !== state.shotLoadSeq || state.selectedShotId !== selectedShotId) {
          return;
        }
        if (hydroLoaded) {
          bundle.hydroActivity = bundle.hydroActivity || hydroLoaded.hydroActivity || null;
          bundle.situation = bundle.situation || hydroLoaded.situation || null;
          bundle.sourceAudioCompare = bundle.sourceAudioCompare || hydroLoaded.sourceAudioCompare || null;
          bundle.orcaAudioCompare = bundle.orcaAudioCompare || hydroLoaded.orcaAudioCompare || null;
          bundle.missingCompatibilityFiles = hydroLoaded.missingCompatibilityFiles || bundle.missingCompatibilityFiles || [];
        }
        bundle.selectedChannel = selectedChannel;
        renderManifestMetadata();
        renderAllPanels();
        scheduleMapRender();
        if (selectedChannel?.available && selectedChannel.multiChannel && shouldPrefetchLargeAssets()) {
          runWhenIdle(() => prefetchSelectedChannelVariants(selectedChannel), 1200);
        }
      })();
      scheduleDasWaterfallPrefetch();
      if (state.shotBundle.missingCompatibilityFiles?.length) {
        updateDataStatus(
          `Loaded synchronized viewer bundle for ${selectedShotId}, but missing compatibility files: ${state.shotBundle.missingCompatibilityFiles.join(", ")}.`
        );
      } else {
        updateDataStatus(`Loaded synchronized viewer bundle for ${selectedShotId}.`);
      }
      return;
    }

    const fallbackBundle = await loadFallbackBundle(selectedShotId);
    if (loadSeq !== state.shotLoadSeq || state.selectedShotId !== selectedShotId) {
      return;
    }
    if (fallbackBundle) {
      state.shotBundle = fallbackBundle;
      state.shotBundle.selectedChannel = {
        available: false,
        message: "Selected DAS channel is not available for this shot."
      };
      resetMapViewport();
      resetMapTimelineForShot();
      state.selectedManifest = null;
      state.manifestSource = null;
      state.eventCount = getEventList().length;
      state.cursorTime = getCurrentInterval().start;
      renderManifestMetadata();
      renderAllPanels();
      scheduleMapRender();
      updateDataStatus(`Loaded fallback metadata bundle for ${selectedShotId}; panel rendering uses metadata where full exports are unavailable.`);
      return;
    }

    state.shotBundle = null;
    state.eventCount = null;
    if (el.eventNav) {
      el.eventNav.innerHTML = "";
    }
    el.dasCaption.textContent = "No synchronized data loaded.";
    el.hydroCaption.textContent = "No synchronized data loaded.";
    el.mapCaption.textContent = "No synchronized data loaded.";
    updateDataStatus(`No viewer-compatible files found for ${selectedShotId}.`);
  } catch (error) {
    if (error && error.name === "AbortError") {
      return;
    }
    state.shotBundle = null;
    state.eventCount = null;
    updateDataStatus(`Failed to load shot ${selectedShotId}: ${summarizeError(error)}`);
  }
}

function getRequestedShotIdFromUrl() {
  try {
    const shot = new URLSearchParams(window.location.search).get("shot");
    if (shot && /^[a-zA-Z0-9_-]+$/.test(shot)) {
      return shot;
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function updateEnvironmentalDashboardLink() {
  if (!el.dashboardLink) return;
  const shotId = state.selectedShotId || el.shotSelect?.value || getRequestedShotIdFromUrl();
  const suffix = shotId ? `?shot=${encodeURIComponent(shotId)}` : "";
  el.dashboardLink.href = `environmental-dashboard.html${suffix}`;
}

function syncViewerShotUrl(shotId) {
  if (!shotId || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("shot", shotId);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch (_error) {
    // URL sync is only a convenience; navigation still works without it.
  }
}

function bindEvents() {
  el.shotSelect.addEventListener("change", onShotChanged);
  el.dashboardLink?.addEventListener("click", updateEnvironmentalDashboardLink);
  el.dasModeWaterfall?.addEventListener("click", () => setDasViewMode("waterfall"));

  el.dasCanvas.addEventListener("mousemove", updateHoverTooltipFromDAS, { passive: true });
  el.dasCanvas.addEventListener("mouseleave", () => {
    hideTooltip();
  }, { passive: true });

  if (el.hydroSvg) {
    el.hydroSvg.addEventListener("mousemove", updateHoverTooltipFromHydro, { passive: true });
    el.hydroSvg.addEventListener("mouseleave", () => {
      hideTooltip();
    }, { passive: true });
  }

  bindSelchCanvas(el.selchSpecCanvas);
  bindSelchCanvas(el.selchBandCanvas);
  bindSelchCanvas(el.selchWaveCanvas);

  if (el.selchChannelSelect) {
    el.selchChannelSelect.addEventListener("change", () => {
      const v = Number(el.selchChannelSelect.value);
      if (!Number.isFinite(v)) {
        return;
      }
      void switchSelectedChannelToPreviewCol(v);
    });
  }

  if (el.selchPlayDasAudio) {
    el.selchPlayDasAudio.addEventListener("click", () => {
      startSelchDasPlayback();
    });
  }
  if (el.selchPlaySourceAudio) {
    el.selchPlaySourceAudio.addEventListener("click", () => {
      void playSelchSourceReference();
    });
  }
  if (el.selchStopAudio) {
    el.selchStopAudio.addEventListener("click", () => {
      stopSelchDemoAudio();
    });
  }
  if (el.selchAudioScrubber) {
    el.selchAudioScrubber.addEventListener("input", () => {
      const t = Number(el.selchAudioScrubber.value);
      if (!Number.isFinite(t)) {
        return;
      }
      state.selchCursorTime = t;
      renderSelectedChannelPanel();
      renderHydroPanel();
    });
  }

  if (el.mapSvg) {
    el.mapSvg.addEventListener("dblclick", onMapDoubleClick);
    el.mapSvg.addEventListener("mousedown", onMapPointerDown);
    el.mapSvg.addEventListener("touchstart", onMapTouchStart, { passive: false });
    el.mapSvg.addEventListener("touchmove", onMapTouchMove, { passive: false });
    el.mapSvg.addEventListener("touchend", onMapTouchEnd, { passive: true });
    el.mapSvg.addEventListener("touchcancel", onMapTouchEnd, { passive: true });
  }

  window.addEventListener("mousemove", onMapPointerMove, { passive: true });
  window.addEventListener("mouseup", onGlobalPointerUp, { passive: true });

  bindMapControlHandlers();
  bindMapTimelineHandlers();
  bindMapZoomButtonHandlers();

  window.addEventListener("resize", () => {
    if (state.shotBundle) {
      renderAllPanels();
      scheduleMapRender();
    }
  });
}

async function initialize() {
  setPlayback(false);
  bindEvents();
  el.playBtn.disabled = true;
  el.pauseBtn.disabled = true;
  el.playbackStatus.textContent = "Playback deferred to a later step.";

  updateDataStatus("Loading shot list from viewer index...");
  const indexLoad = await tryLoadJsonFromCandidates("viewer_index.json", OUTPUT_BASE_CANDIDATES);

  if (indexLoad.data) {
    state.shotOptions = parseIndexToShotOptions(indexLoad.data, indexLoad.url);
    updateDataStatus(`Loaded shot list from ${indexLoad.url}.`);
  } else {
    state.indexSource = null;
    state.shotOptions = SHOT_FALLBACK.map((shotId) => ({ shotId, manifestPath: null }));
    const triedShort = (indexLoad.tried || []).map((t) => t.url).slice(0, 4).join(", ");
    const deployHint = assetResolver.isGitHubPages
      ? "GitHub Pages mode: make sure pages-dist includes output/ and viewer_index.json."
      : "Make sure output/ exists at the repo root and you started the server per site/README.md.";
    updateDataStatus(
      `viewer_index.json not found (tried: ${triedShort}). ` +
      "Using fallback shot list (whales_humpback, whales_orca). " +
      deployHint
    );
    console.warn("[initialize] viewer_index.json lookup failed", indexLoad.tried || []);
  }

  renderShotOptions();
  if (state.shotOptions.length > 0) {
    const requestedShotId = getRequestedShotIdFromUrl();
    const initialShot = state.shotOptions.find((option) => option.shotId === requestedShotId)
      ? requestedShotId
      : state.shotOptions[0].shotId;
    el.shotSelect.value = initialShot;
    updateEnvironmentalDashboardLink();
    await onShotChanged();
    runWhenIdle(warmupRuntimeCaches, 2200);
  }

  const summary = assetResolver.summary();
  console.info("[initialize] asset resolver summary", summary);
}

initialize().catch((error) => {
  updateDataStatus(`Initialization failed: ${summarizeError(error)}`);
});
