if (!globalThis.__zoomRecorderInjected) {
  globalThis.__zoomRecorderInjected = true;

  let trackingEnabled = false;
  let lastMoveAt = 0;
  const MOVE_THROTTLE_MS = 33;

  function postEvent(payload) {
    chrome.runtime.sendMessage({
      type: "cursor:event",
      payload,
    });
  }

  function viewportSnapshot(x, y, click, kind) {
    const node = document.elementFromPoint(x, y);
    const cursorType = node ? getComputedStyle(node).cursor || "default" : "default";
    return {
      x,
      y,
      vw: window.innerWidth,
      vh: window.innerHeight,
      click,
      kind,
      cursorType,
    };
  }

  function onPointerMove(event) {
    if (!trackingEnabled) {
      return;
    }
    const now = Date.now();
    if (now - lastMoveAt < MOVE_THROTTLE_MS) {
      return;
    }
    lastMoveAt = now;
    postEvent(viewportSnapshot(event.clientX, event.clientY, false, "move"));
  }

  function onPointerDown(event) {
    if (!trackingEnabled) {
      return;
    }
    postEvent(viewportSnapshot(event.clientX, event.clientY, true, "down"));
  }

  function onScroll() {
    if (!trackingEnabled) {
      return;
    }
    const x = Math.max(0, Math.min(window.innerWidth, window.innerWidth / 2));
    const y = Math.max(0, Math.min(window.innerHeight, window.innerHeight / 2));
    postEvent(viewportSnapshot(x, y, false, "scroll"));
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "tracking:start") {
      trackingEnabled = true;
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "tracking:stop") {
      trackingEnabled = false;
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  if ("onpointermove" in window) {
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
  } else {
    window.addEventListener("mousemove", onPointerMove, { passive: true });
    window.addEventListener("mousedown", onPointerDown, { passive: true });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
}
