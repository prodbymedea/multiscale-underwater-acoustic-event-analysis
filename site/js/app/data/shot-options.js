async function tryLoadJsonFromCandidates(relativePath, baseCandidates) {
  let kind = null;
  if (baseCandidates === ASSET_BASE_CANDIDATES.output || baseCandidates === OUTPUT_BASE_CANDIDATES) {
    kind = "output";
  } else if (baseCandidates === ASSET_BASE_CANDIDATES.samples || baseCandidates === SAMPLE_BASE_CANDIDATES) {
    kind = "samples";
  }
  if (kind) {
    const res = await loadAssetJson(kind, relativePath);
    return { data: res.data, url: res.url, tried: res.tried };
  }

  const tried = [];
  for (const base of baseCandidates) {
    const url = `${base}/${_normalizeRel(relativePath)}`;
    try {
      const data = await _probeJson(url);
      return { data, url, tried };
    } catch (err) {
      tried.push({ url, error: String((err && err.message) || err) });
    }
  }
  return { data: null, url: null, tried };
}

async function tryLoadJsonFromUrls(urls) {
  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      return { data, url };
    } catch (_) {
      // Continue trying other candidates.
    }
  }
  return { data: null, url: null };
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
