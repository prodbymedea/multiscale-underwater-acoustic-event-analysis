const requestCache = {
  json: new Map(),
  arrayBuffer: new Map(),
  inFlightJson: new Map(),
  inFlightArrayBuffer: new Map()
};

function _activeFetchSignal(options) {
  if (options && options.signal) {
    return options.signal;
  }
  if (typeof state !== "undefined" && state.activeShotFetchSignal) {
    return state.activeShotFetchSignal;
  }
  return undefined;
}

async function fetchJson(url, options = {}) {
  if (!options.noMemoryCache && requestCache.json.has(url)) {
    return requestCache.json.get(url);
  }
  if (!options.noMemoryCache && requestCache.inFlightJson.has(url)) {
    return requestCache.inFlightJson.get(url);
  }
  const signal = _activeFetchSignal(options);
  const startedAt = performance.now();
  const promise = (async () => {
    const response = await fetch(url, { cache: "default", signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    if (!options.noMemoryCache) {
      requestCache.json.set(url, payload);
    }
    console.debug(`[fetchJson] ${url} (${(performance.now() - startedAt).toFixed(1)} ms)`);
    return payload;
  })();
  if (!options.noMemoryCache) {
    requestCache.inFlightJson.set(url, promise);
  }
  try {
    return await promise;
  } finally {
    requestCache.inFlightJson.delete(url);
  }
}

async function fetchArrayBuffer(url, options = {}) {
  if (!options.noMemoryCache && requestCache.arrayBuffer.has(url)) {
    return requestCache.arrayBuffer.get(url);
  }
  if (!options.noMemoryCache && requestCache.inFlightArrayBuffer.has(url)) {
    return requestCache.inFlightArrayBuffer.get(url);
  }
  const signal = _activeFetchSignal(options);
  const startedAt = performance.now();
  const promise = (async () => {
    const response = await fetch(url, { cache: "default", signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.arrayBuffer();
    if (!options.noMemoryCache) {
      requestCache.arrayBuffer.set(url, payload);
    }
    console.debug(`[fetchArrayBuffer] ${url} (${(performance.now() - startedAt).toFixed(1)} ms)`);
    return payload;
  })();
  if (!options.noMemoryCache) {
    requestCache.inFlightArrayBuffer.set(url, promise);
  }
  try {
    return await promise;
  } finally {
    requestCache.inFlightArrayBuffer.delete(url);
  }
}

function getNumpyDescrInfo(descrRaw) {
  const descr = String(descrRaw || "").trim();
  if (!descr) {
    return null;
  }
  const map = {
    "<f4": { bytes: 4, kind: "f32" },
    float32: { bytes: 4, kind: "f32" },
    "<f8": { bytes: 8, kind: "f64" },
    float64: { bytes: 8, kind: "f64" },
    "<i4": { bytes: 4, kind: "i32" },
    int32: { bytes: 4, kind: "i32" },
    "<i2": { bytes: 2, kind: "i16" },
    int16: { bytes: 2, kind: "i16" },
    "<u2": { bytes: 2, kind: "u16" },
    uint16: { bytes: 2, kind: "u16" },
    "|u1": { bytes: 1, kind: "u8" },
    uint8: { bytes: 1, kind: "u8" },
    "|i1": { bytes: 1, kind: "i8" },
    int8: { bytes: 1, kind: "i8" },
    "|b1": { bytes: 1, kind: "u8" },
    bool: { bytes: 1, kind: "u8" },
    "?": { bytes: 1, kind: "u8" }
  };
  if (map[descr]) {
    return { ...map[descr], descr, bigEndian: false };
  }
  if (descr.startsWith(">f4")) {
    return { bytes: 4, kind: "f32be", descr, bigEndian: true };
  }
  if (descr.startsWith(">f8")) {
    return { bytes: 8, kind: "f64be", descr, bigEndian: true };
  }
  return null;
}

function shouldSkipNumpyDescr(descr) {
  const d = String(descr || "");
  return /^[|<]U\d/.test(d) || /^[|<]S\d/.test(d) || d.includes("object") || d === "|O8";
}

function parseNpyArrayBuffer(buffer) {
  const u8 = new Uint8Array(buffer);
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3], u8[4], u8[5]);
  if (magic !== "\x93NUMPY") {
    throw new Error("Invalid NPY file");
  }
  const major = u8[6];
  let headerLen;
  let headerOffset;
  if (major === 1) {
    headerLen = u8[8] | (u8[9] << 8);
    headerOffset = 10;
  } else if (major === 2) {
    const dv0 = new DataView(buffer);
    headerLen = dv0.getUint32(8, true);
    headerOffset = 12;
  } else {
    throw new Error(`Unsupported NPY version ${major}.${u8[7]}`);
  }

  const headerStr = new TextDecoder("latin1").decode(u8.subarray(headerOffset, headerOffset + headerLen));
  const descrMatch = headerStr.match(/'descr':\s*'((?:\\'|[^'])*)'|"descr":\s*"((?:\\"|[^"])*)"/);
  const descrRaw = descrMatch ? descrMatch[1] || descrMatch[2] : null;
  const descr = descrRaw ? descrRaw.replace(/\\'/g, "'") : null;
  if (!descr) {
    throw new Error("NPY missing descr");
  }
  if (shouldSkipNumpyDescr(descr)) {
    return { skipped: true, descr };
  }

  const shapeMatch = headerStr.match(/'shape':\s*\(([^)]*)\)/);
  const inner = shapeMatch ? shapeMatch[1].trim() : "";
  let shape = [];
  if (inner) {
    shape = inner
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((x) => Number.parseInt(x, 10))
      .filter((n) => Number.isFinite(n));
  }
  let nElems = 1;
  for (const dim of shape) {
    nElems *= dim;
  }

  const fortran = /'fortran_order':\s*True/.test(headerStr);
  let dataOffset = headerOffset + headerLen;
  while (dataOffset % 16 !== 0) {
    dataOffset += 1;
  }

  const info = getNumpyDescrInfo(descr);
  if (!info) {
    throw new Error(`Unsupported NPY dtype ${descr}`);
  }
  if (dataOffset + nElems * info.bytes > buffer.byteLength) {
    throw new Error("NPY payload exceeds buffer");
  }

  const dv = new DataView(buffer);

  function readBigF32(idx) {
    return dv.getFloat32(dataOffset + idx * 4, false);
  }
  function readBigF64(idx) {
    return dv.getFloat64(dataOffset + idx * 8, false);
  }

  let data;
  if (!info.bigEndian && info.kind === "f32") {
    data = new Float32Array(buffer, dataOffset, nElems);
  } else if (!info.bigEndian && info.kind === "f64") {
    data = new Float64Array(buffer, dataOffset, nElems);
  } else if (!info.bigEndian && info.kind === "i32") {
    data = new Int32Array(buffer, dataOffset, nElems);
  } else if (!info.bigEndian && info.kind === "i16") {
    data = new Int16Array(buffer, dataOffset, nElems);
  } else if (!info.bigEndian && info.kind === "u16") {
    data = new Uint16Array(buffer, dataOffset, nElems);
  } else if (!info.bigEndian && info.kind === "u8") {
    data = new Uint8Array(buffer, dataOffset, nElems);
  } else if (!info.bigEndian && info.kind === "i8") {
    data = new Int8Array(buffer, dataOffset, nElems);
  } else if (info.kind === "f32be") {
    data = new Float32Array(nElems);
    for (let i = 0; i < nElems; i += 1) {
      data[i] = readBigF32(i);
    }
  } else if (info.kind === "f64be") {
    data = new Float64Array(nElems);
    for (let i = 0; i < nElems; i += 1) {
      data[i] = readBigF64(i);
    }
  } else {
    throw new Error(`Unhandled NPY layout ${descr}`);
  }

  return { data, shape, descr, fortran };
}

function unzipNpzToArrays(arrayBuffer) {
  const lib = typeof fflate !== "undefined" ? fflate : globalThis.fflate;
  if (!lib || typeof lib.unzipSync !== "function") {
    throw new Error("fflate.unzipSync is not available");
  }
  const bytes = new Uint8Array(arrayBuffer);
  const entries = lib.unzipSync(bytes);
  const out = {};
  for (const name of Object.keys(entries || {})) {
    if (!name.toLowerCase().endsWith(".npy")) {
      continue;
    }
    const key = name.replace(/\.npy$/i, "");
    const zbuf = entries[name];
    const ab = zbuf.buffer.slice(zbuf.byteOffset, zbuf.byteOffset + zbuf.byteLength);
    let parsed;
    try {
      parsed = parseNpyArrayBuffer(ab);
    } catch (_) {
      continue;
    }
    if (parsed.skipped) {
      continue;
    }
    out[key] = parsed;
  }
  return out;
}

async function fetchNpz(url, options = {}) {
  const ab = await fetchArrayBuffer(url, options);
  return unzipNpzToArrays(ab);
}

function manifestRelativeFetchUrls(baseDir, relPath) {
  if (!relPath || typeof relPath !== "string") {
    return [];
  }
  const trimmed = relPath.trim().replace(/^\.\//, "");
  const urls = [];
  const seen = new Set();
  const push = (u) => {
    if (!u || seen.has(u)) {
      return;
    }
    seen.add(u);
    urls.push(u);
  };
  push(`${baseDir}/${trimmed}`);
  if (trimmed.startsWith("output/") || trimmed.includes("output/shots/")) {
    const slashIdx = trimmed.lastIndexOf("/");
    const baseName = slashIdx >= 0 ? trimmed.slice(slashIdx + 1) : trimmed;
    const alt = `${baseDir}/${baseName}`;
    push(alt);
  }
  return urls;
}

async function fetchNpzFromManifestPaths(baseDir, relPath) {
  const urls = manifestRelativeFetchUrls(baseDir, relPath);
  const failures = [];
  for (const url of urls) {
    try {
      const data = await fetchNpz(url);
      if (failures.length > 0) {
        console.info(`[fetchNpzFromManifestPaths] fallback succeeded: ${url}`);
      }
      return data;
    } catch (error) {
      failures.push({ url, error: summarizeError(error) });
    }
  }
  if (failures.length > 0) {
    console.warn(`[fetchNpzFromManifestPaths] all failed for ${relPath}`, failures);
  }
  return null;
}

async function fetchJsonFromManifestPaths(baseDir, relPath) {
  const urls = manifestRelativeFetchUrls(baseDir, relPath);
  const failures = [];
  for (const url of urls) {
    try {
      const data = await fetchJson(url);
      if (failures.length > 0) {
        console.info(`[fetchJsonFromManifestPaths] fallback succeeded: ${url}`);
      }
      return data;
    } catch (error) {
      failures.push({ url, error: summarizeError(error) });
    }
  }
  if (failures.length > 0) {
    console.warn(`[fetchJsonFromManifestPaths] all failed for ${relPath}`, failures);
  }
  return null;
}

function buildDasWaterfallFromNpz(npz) {
  if (!npz) {
    return null;
  }
  const wf = npz.data || npz.preprocessed_preview || npz.raw_preview;
  const t = npz.t_s;
  const ch = npz.channel_indices || npz.preview_cols;
  if (!wf?.data || !t?.data || !ch?.data || wf.shape?.length !== 2) {
    return null;
  }

  const shape = wf.shape;
  const nt = t.data.length;
  const nc = ch.data.length;
  let orientation = null;
  if (shape[0] === nt && shape[1] === nc) {
    orientation = "time_channel";
  } else if (shape[0] === nc && shape[1] === nt) {
    orientation = "channel_time";
  } else {
    return null;
  }

  const distances = npz.distances_m?.data && npz.distances_m.data.length === nc
    ? Array.from(npz.distances_m.data)
    : null;
  let fsHz = Number(npz.fs_hz?.data?.[0] ?? npz.sample_rate_hz?.data?.[0]);
  if (!Number.isFinite(fsHz) && nt > 1) {
    const dt = Number(t.data[1]) - Number(t.data[0]);
    fsHz = dt > 0 ? 1 / dt : null;
  }

  return {
    axes: {
      t_s: Array.from(t.data),
      channel_indices: Array.from(ch.data),
      sample_indices: npz.sample_indices?.data ? Array.from(npz.sample_indices.data) : null,
      distances_m: distances
    },
    data: wf.data,
    shape,
    fortran: !!wf.fortran,
    orientation,
    fsHz,
    sourceKey: npz.data ? "data" : (npz.preprocessed_preview ? "preprocessed_preview" : "raw_preview"),
    amplitudeUnits: npz.data ? "native DAS counts" : (npz.preprocessed_preview ? "robust-normalized amplitude" : "DAS amplitude"),
    colorScale: null
  };
}

function buildHydroActivityFromNpz(npz, scoreMetadata) {
  if (!npz) {
    return null;
  }
  const t = npz.t_s?.data;
  const raw = npz.raw_score?.data;
  if (!t || !raw || t.length !== raw.length) {
    return null;
  }
  const thresholdDb = Number(scoreMetadata?.detector?.threshold_db);
  const hydro = {
    t_s: Array.from(t),
    score_db: Array.from(raw),
    normalization: {}
  };
  if (Number.isFinite(thresholdDb)) {
    hydro.normalization.threshold_db = thresholdDb;
  }
  return hydro;
}

async function attachMainPanelsFromNpzFallback(manifest, manifestUrl, bundle) {
  const baseDir = getBaseDir(manifestUrl);
  const files = manifest?.files || {};

  if (!bundle.hydroActivity) {
    const rel = files.hydrophone_score_file || files.hydrophone_event_score;
    const npz =
      (rel && (await fetchNpzFromManifestPaths(baseDir, rel))) ||
      (await fetchNpzFromManifestPaths(baseDir, "hydrophone_event_score.npz"));
    if (npz) {
      const metaRel = files.hydrophone_score_metadata_file || files.hydrophone_event_score_metadata;
      const scoreMeta =
        (metaRel && (await fetchJsonFromManifestPaths(baseDir, metaRel))) ||
        (await fetchJsonFromManifestPaths(baseDir, "hydrophone_event_score_metadata.json"));
      const built = buildHydroActivityFromNpz(npz, scoreMeta);
      if (built) {
        bundle.hydroActivity = built;
      }
    }
  }

  if (Array.isArray(bundle.missingCompatibilityFiles)) {
    const hasHydro = Boolean(bundle.hydroActivity?.t_s?.length && bundle.hydroActivity?.score_db?.length);
    bundle.missingCompatibilityFiles = bundle.missingCompatibilityFiles.filter((line) => {
      if (hasHydro && line.startsWith("hydrophone_activity:")) {
        return false;
      }
      return true;
    });
  }
}