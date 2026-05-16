let selchDemoAudioSource = null;
let selchDemoAudioState = null;
let selchDemoAudioPlaySeq = 0;

function stopSelchDemoAudio(options = {}) {
  const { silent = false } = options;
  selchDemoAudioPlaySeq += 1;
  if (selchDemoAudioState?.frame) {
    cancelAnimationFrame(selchDemoAudioState.frame);
  }
  selchDemoAudioState = null;
  const src = selchDemoAudioSource;
  selchDemoAudioSource = null;
  if (!src) {
    return;
  }
  src.onended = null;
  try {
    src.stop(0);
  } catch (_) {
    /* already stopped */
  }
  try {
    src.disconnect();
  } catch (_) {
    /* ignore */
  }
  if (!silent) {
    updateDataStatus("Selected-channel audio stopped.");
  }
}

function getSharedAudioContext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) {
    return null;
  }
  if (!getSharedAudioContext._ctx) {
    getSharedAudioContext._ctx = new AC();
  }
  const ctx = getSharedAudioContext._ctx;
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  return ctx;
}

function getSelectedChannelDasAudioPayload(sc) {
  const ba = sc?.bandpassAudio;
  let t = ba?.t;
  let y = ba?.y;
  let fs = Number.isFinite(ba?.fs) ? ba.fs : sc?.signalFs;
  let label = "band-pass DAS";
  if (!y?.length) {
    t = sc?.signal?.t;
    y = sc?.signal?.y;
    label = "median-centered DAS (wideband)";
  }
  if (!t?.length || !y?.length || t.length !== y.length || !Number.isFinite(fs) || fs <= 0) {
    return null;
  }
  return {
    t,
    y,
    fs,
    label,
    timeStart: Number(t[0]),
    timeEnd: Number(t[t.length - 1]),
    duration: y.length / fs
  };
}

function tickSelchDasPlaybackCursor() {
  const playback = selchDemoAudioState;
  if (!playback?.ctx) {
    return;
  }
  const elapsed = playback.ctx.currentTime - playback.ctxStartedAt;
  const nextTime = Math.min(playback.endTime, playback.startTime + Math.max(0, elapsed));
  state.selchCursorTime = nextTime;
  renderSelectedChannelPanel();
  renderHydroPanel();
  if (nextTime >= playback.endTime - 0.005) {
    finishSelchDasPlayback();
    return;
  }
  playback.frame = requestAnimationFrame(tickSelchDasPlaybackCursor);
}

function finishSelchDasPlayback() {
  const playback = selchDemoAudioState;
  if (!playback) {
    return;
  }
  const resetTime = Number(playback.resetTime);
  const label = playback.label;
  stopSelchDemoAudio({ silent: true });
  if (Number.isFinite(resetTime)) {
    state.selchCursorTime = resetTime;
    renderSelectedChannelPanel();
    renderHydroPanel();
  }
  updateDataStatus(`Finished ${label}; cursor reset to start.`);
}

function syncSelchAudioScrubber(sc = state.shotBundle?.selectedChannel) {
  if (!el.selchAudioScrubber) {
    return;
  }
  const range = getSelectedChannelFullTimeRange(sc);
  const rawCursor = Number.isFinite(state.selchCursorTime) ? state.selchCursorTime : range.start;
  const cursor = clamp(rawCursor, range.start, range.end);
  el.selchAudioScrubber.min = range.start.toFixed(3);
  el.selchAudioScrubber.max = range.end.toFixed(3);
  el.selchAudioScrubber.step = "0.01";
  el.selchAudioScrubber.value = cursor.toFixed(3);
  if (el.selchAudioScrubberTime) {
    el.selchAudioScrubberTime.textContent = `${cursor.toFixed(2)} s`;
  }
}

function startSelchDasPlayback() {
  const sc = state.shotBundle?.selectedChannel;
  if (!sc?.available) {
    return;
  }
  const restartDasFromBeginning = selchDemoAudioState?.kind === "das";
  stopSelchDemoAudio({ silent: true });
  const ctx = getSharedAudioContext();
  if (!ctx) {
    updateDataStatus("Web Audio API not available in this browser.");
    return;
  }
  const audio = getSelectedChannelDasAudioPayload(sc);
  if (!audio) {
    updateDataStatus("No DAS waveform available for audio.");
    return;
  }
  const rawStartTime = restartDasFromBeginning
    ? audio.timeStart
    : (Number.isFinite(state.selchCursorTime) ? state.selchCursorTime : audio.timeStart);
  const cursorStartTime = clamp(rawStartTime, audio.timeStart, audio.timeEnd);
  const startTime = cursorStartTime >= audio.timeEnd - 0.005 ? audio.timeStart : cursorStartTime;
  const endTime = audio.timeEnd;
  state.selchCursorTime = startTime;
  renderSelectedChannelPanel();
  renderHydroPanel();

  const { y, fs, label } = audio;
  const n = y.length;
  const buf = ctx.createBuffer(1, n, fs);
  const ch = buf.getChannelData(0);
  let mx = 0;
  for (let i = 0; i < n; i++) {
    mx = Math.max(mx, Math.abs(y[i]));
  }
  const gain = mx > 0 ? 0.88 / mx : 1;
  for (let i = 0; i < n; i++) {
    ch[i] = y[i] * gain;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  selchDemoAudioSource = src;
  const playbackId = ++selchDemoAudioPlaySeq;
  const offset = clamp(startTime - audio.timeStart, 0, Math.max(0, buf.duration - 0.001));
  const duration = Math.max(0.01, Math.min(endTime - startTime, buf.duration - offset));
  const playbackEnd = Math.min(endTime, startTime + duration);
  selchDemoAudioState = {
    id: playbackId,
    kind: "das",
    ctx,
    ctxStartedAt: ctx.currentTime,
    startTime,
    endTime: playbackEnd,
    label,
    resetTime: audio.timeStart,
    frame: 0
  };
  src.onended = () => {
    if (selchDemoAudioState?.id !== playbackId) {
      return;
    }
    selchDemoAudioSource = null;
    finishSelchDasPlayback();
  };
  src.start(0, offset, duration);
  tickSelchDasPlaybackCursor();
  updateDataStatus(`Playing ${label} from ${startTime.toFixed(2)} s to ${playbackEnd.toFixed(2)} s.`);
}

function getSourceAudioCompare() {
  const b = state.shotBundle;
  return b?.sourceAudioCompare || b?.orcaAudioCompare || null;
}

async function playSelchSourceReference() {
  const sac = getSourceAudioCompare();
  const rel = sac?.doc?.source_wav_playback_file || sac?.doc?.source_wav_file;
  if (!rel || !sac.baseDir) {
    updateDataStatus("Source reference audio not loaded (re-run build_selected_channel_bundle for this shot).");
    return;
  }
  stopSelchDemoAudio();
  const ctx = getSharedAudioContext();
  if (!ctx) {
    updateDataStatus("Web Audio API not available in this browser.");
    return;
  }
  try {
    // Assign a play id early so concurrent/overlapping clicks can invalidate this request.
    const playbackId = ++selchDemoAudioPlaySeq;
    // Mark pending state so UI can reflect an in-progress play request.
    selchDemoAudioState = { id: playbackId, kind: "source", frame: 0, pending: true };
    const url = `${sac.baseDir}/${rel}`;
    const res = await fetch(url);
    if (!res.ok) {
      // If another play was requested while fetching, bail out.
      if (selchDemoAudioPlaySeq !== playbackId) {
        return;
      }
      throw new Error(`HTTP ${res.status}`);
    }
    const arr = await res.arrayBuffer();
    // If a newer play request arrived while fetching, cancel this one.
    if (selchDemoAudioPlaySeq !== playbackId) {
      return;
    }
    const audioBuf = await ctx.decodeAudioData(arr.slice(0));
    // If a newer play request arrived while decoding, cancel this one.
    if (selchDemoAudioPlaySeq !== playbackId) {
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(ctx.destination);
    selchDemoAudioSource = src;
    selchDemoAudioState = { id: playbackId, kind: "source", frame: 0 };
    src.onended = () => {
      if (selchDemoAudioState?.id !== playbackId) {
        return;
      }
      selchDemoAudioSource = null;
      selchDemoAudioState = null;
    };
    src.start(0);
    updateDataStatus("Playing source reference segment (demo)...");
  } catch (error) {
    updateDataStatus(`Source playback failed: ${summarizeError(error)}`);
  }
}
