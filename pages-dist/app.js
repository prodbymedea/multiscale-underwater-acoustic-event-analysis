const VIEWER_SCRIPT_ORDER = [
  "js/app/viewer-core.js",
  "js/app/viewer-loading.js",
  "js/app/shared/math-utils.js",
  "js/app/shared/canvas-utils.js",
  "js/app/data/shot-options.js",
  "js/app/state/shot-state.js",
  "js/app/state/event-navigation.js",
  "js/app/graphs/map-timeline.js",
  "js/app/graphs/map-summary.js",
  "js/app/graphs/graph-das.js",
  "js/app/graphs/graph-hydro.js",
  "js/app/graphs/graph-map.js",
  "js/app/graphs/map-interactions.js",
  "js/app/graphs/graph-hit-tests.js",
  "js/app/graphs/graph-selected-channel.js",
  "js/app/graphs/selected-channel-audio.js",
  "js/app/viewer-interactions.js"
];

function loadViewerScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = () => resolve(src);
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

(async () => {
  try {
    for (const src of VIEWER_SCRIPT_ORDER) {
      await loadViewerScript(src);
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    const status = document.getElementById("data-status");
    if (status) {
      status.textContent = `Viewer bootstrap failed: ${message}`;
    }
    throw error;
  }
})();
