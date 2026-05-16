function renderEventNavigation() {
  if (!el.eventNav) {
    return;
  }
  const events = getEventList();
  const current = getCurrentInterval();

  const shouldRebuild = el.eventNav.dataset.shotId !== String(state.selectedShotId) || el.eventNav.children.length !== events.length;

  if (events.length === 0) {
    if (el.eventNav.dataset.empty !== "true") {
      el.eventNav.innerHTML = "";
      const empty = document.createElement("span");
      empty.className = "placeholder-note";
      empty.textContent = "No candidate events for this shot.";
      el.eventNav.appendChild(empty);
      el.eventNav.dataset.empty = "true";
      el.eventNav.dataset.shotId = String(state.selectedShotId || "");
    }
    return;
  }

  if (shouldRebuild || el.eventNav.dataset.empty === "true") {
    el.eventNav.innerHTML = "";
    for (const event of events) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "event-chip";
      chip.dataset.eventId = event.event_id;
      chip.textContent = `${event.event_id.split("_").slice(-1)[0]}: ${event.start_time_s.toFixed(1)}-${event.end_time_s.toFixed(1)} s`;
      chip.addEventListener("click", () => {
        const timeExtent = getTimeExtentFromShotBundle(state.shotBundle);
        state.cursorTime = clamp(0.5 * (event.start_time_s + event.end_time_s), timeExtent.start, timeExtent.end);
        renderAllPanels();
        updateDataStatus(`Jumped to ${event.event_id} at ${state.cursorTime.toFixed(2)} s.`);
      });
      el.eventNav.appendChild(chip);
    }
    el.eventNav.dataset.empty = "false";
    el.eventNav.dataset.shotId = String(state.selectedShotId || "");
  }

  const chips = Array.from(el.eventNav.querySelectorAll(".event-chip"));
  for (let idx = 0; idx < chips.length && idx < events.length; idx += 1) {
    const chip = chips[idx];
    const event = events[idx];
    const active = state.cursorTime >= event.start_time_s && state.cursorTime <= event.end_time_s;
    const inInterval = event.end_time_s >= current.start && event.start_time_s <= current.end;
    chip.classList.toggle("active", active);
    chip.classList.toggle("in-interval", inInterval);
  }

  const overlapCount = events.filter((event) => event.end_time_s >= current.start && event.start_time_s <= current.end).length;
  updateDataStatus(`Selected shot ${state.selectedShotId}; interval ${current.start.toFixed(2)}-${current.end.toFixed(2)} s; ${overlapCount} candidate event(s) overlap.`);
}
