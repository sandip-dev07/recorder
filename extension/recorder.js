const shareBtn = document.getElementById("shareBtn");
const micBtn = document.getElementById("micBtn");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const downloadRawBtn = document.getElementById("downloadRawBtn");
const renderBtn = document.getElementById("renderBtn");
const refreshPreviewBtn = document.getElementById("refreshPreviewBtn");
const statusEl = document.getElementById("status");
const timerEl = document.getElementById("timer");
const shareStateEl = document.getElementById("shareState");
const micStateEl = document.getElementById("micState");
const zoomInput = document.getElementById("zoomInput");
const clickBoostInput = document.getElementById("clickBoostInput");
const smoothnessInput = document.getElementById("smoothnessInput");
const zoomDelayInput = document.getElementById("zoomDelayInput");
const zoomInInput = document.getElementById("zoomInInput");
const zoomHoldInput = document.getElementById("zoomHoldInput");
const zoomOutInput = document.getElementById("zoomOutInput");
const editorPanel = document.getElementById("editorPanel");
const previewVideo = document.getElementById("previewVideo");
const previewMeta = document.getElementById("previewMeta");
const previewKind = document.getElementById("previewKind");

const TARGET_WIDTH = 1920;
const TARGET_HEIGHT = 1080;
const TARGET_FPS = 60;

const params = new URLSearchParams(window.location.search);
const sourceTabIdValue = params.get("sourceTabId");
const sourceTabId = sourceTabIdValue ? Number(sourceTabIdValue) : null;

const state = {
  displayStream: null,
  micStream: null,
  activeStream: null,
  recorder: null,
  chunks: [],
  rawBlob: null,
  sessionData: null,
  timerId: null,
  startedAt: 0,
  previewUrl: null,
  zoomedPreviewBlob: null,
  zoomSignature: null,
};

function setStatus(text) {
  statusEl.textContent = text;
}

function setRecordingUi(recording) {
  startBtn.disabled = recording || !state.displayStream;
  stopBtn.disabled = !recording;
  shareBtn.disabled = recording;
  micBtn.disabled = recording;
}

function setExportUi(enabled) {
  refreshPreviewBtn.disabled = !enabled;
  downloadRawBtn.disabled = !enabled;
  renderBtn.disabled = !enabled;
}

function getRenderOptions() {
  return {
    idleZoom: Number(zoomInput.value),
    clickBoost: Number(clickBoostInput.value),
    smoothness: Number(smoothnessInput.value),
    zoomDelay: Number(zoomDelayInput.value),
    zoomInDuration: Number(zoomInInput.value),
    zoomHoldDuration: Number(zoomHoldInput.value),
    zoomOutDuration: Number(zoomOutInput.value),
    maxZoom: 2.7,
  };
}

function currentZoomSignature() {
  return JSON.stringify(getRenderOptions());
}

function resetEditorPanel() {
  editorPanel.hidden = true;
  previewMeta.textContent = "";
  previewKind.textContent = "";
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }
  previewVideo.removeAttribute("src");
  previewVideo.load();
  state.zoomedPreviewBlob = null;
  state.zoomSignature = null;
}

async function focusRecorderTab() {
  if (!chrome.tabs?.getCurrent) {
    return;
  }
  await new Promise((resolve) => {
    chrome.tabs.getCurrent((tab) => {
      if (chrome.runtime.lastError || !tab?.id) {
        resolve();
        return;
      }
      chrome.tabs.update(tab.id, { active: true }, () => resolve());
    });
  });
}

function openPreviewEditor(blob, kindLabel) {
  if (!blob || !state.sessionData) {
    return;
  }
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
  }
  state.previewUrl = URL.createObjectURL(blob);
  previewVideo.src = state.previewUrl;
  previewVideo.currentTime = 0;
  previewVideo.pause();

  const duration = (state.sessionData.duration || 0).toFixed(1);
  const eventCount = state.sessionData.events?.length || 0;
  previewMeta.textContent = `Duration: ${duration}s  |  Cursor events: ${eventCount}`;
  previewKind.textContent = kindLabel;
  editorPanel.hidden = false;
  editorPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateTimer() {
  if (!state.startedAt) {
    timerEl.textContent = "00:00";
    return;
  }
  const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");
  timerEl.textContent = `${minutes}:${seconds}`;
}

function startTimer() {
  clearInterval(state.timerId);
  state.startedAt = Date.now();
  updateTimer();
  state.timerId = setInterval(updateTimer, 1000);
}

function stopTimer() {
  clearInterval(state.timerId);
  state.timerId = null;
  state.startedAt = 0;
  updateTimer();
}

function getMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return "";
}

function getRecorderConfig() {
  const mimeType = getMimeType();
  const config = {
    videoBitsPerSecond: 12_000_000,
    audioBitsPerSecond: 192_000,
  };
  if (mimeType) {
    config.mimeType = mimeType;
  }
  return config;
}

async function sendMessage(payload) {
  return chrome.runtime.sendMessage(payload);
}

function stopTracks(stream) {
  if (!stream) {
    return;
  }
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function waitForLoadedMetadata(video) {
  return new Promise((resolve) => {
    if (video.readyState >= 1) {
      resolve();
      return;
    }
    video.addEventListener("loadedmetadata", () => resolve(), { once: true });
  });
}

function waitForVideoEnded(video) {
  return new Promise((resolve) => {
    video.addEventListener("ended", () => resolve(), { once: true });
  });
}

function waitRecorderStop(recorder) {
  return new Promise((resolve) => {
    recorder.addEventListener("stop", () => resolve(), { once: true });
  });
}

function coalesceClicks(clickPoints, minGapSeconds = 0.45) {
  const result = [];
  let lastAccepted = -Infinity;
  for (let i = 0; i < clickPoints.length; i += 1) {
    const click = clickPoints[i];
    if (click.t - lastAccepted < minGapSeconds) {
      continue;
    }
    result.push(click);
    lastAccepted = click.t;
  }
  return result;
}

function createAutoCameraEngine(events, width, height, options) {
  const config = {
    idleZoom: Math.max(1, Number(options.idleZoom) || 1),
    clickBoost: Math.max(0, Number(options.clickBoost) || 0),
    maxZoom: Math.max(1, Number(options.maxZoom) || 2.5),
    smoothness: clamp(Number(options.smoothness) || 0, 0, 100) / 100,
    zoomDelay: clamp(Number(options.zoomDelay) || 0, 0, 1.5),
    zoomInDuration: clamp(Number(options.zoomInDuration) || 0.2, 0.05, 2.5),
    zoomHoldDuration: clamp(Number(options.zoomHoldDuration) || 1.8, 0.05, 5),
    zoomOutDuration: clamp(Number(options.zoomOutDuration) || 1.3, 0.05, 5),
  };

  const ordered = [...events]
    .filter((event) => typeof event.t === "number")
    .sort((a, b) => a.t - b.t);
  const clickPoints = ordered
    .filter((event) => event.click)
    .map((event) => ({
      t: event.t,
      x: (event.x / Math.max(1, event.vw)) * width,
      y: (event.y / Math.max(1, event.vh)) * height,
    }));
  const filteredClicks = coalesceClicks(clickPoints, 0.45);
  const clickTimes = filteredClicks.map((point) => point.t);
  let pointerIndex = 0;

  let camX = width / 2;
  let camY = height / 2;
  let camScale = config.idleZoom;
  let lastT = null;

  function samplePointer(t) {
    while (pointerIndex + 1 < ordered.length && ordered[pointerIndex + 1].t <= t) {
      pointerIndex += 1;
    }

    const a = ordered[pointerIndex];
    const b = ordered[pointerIndex + 1];
    if (!a) {
      return {
        x: width / 2,
        y: height / 2,
      };
    }

    if (!b) {
      return {
        x: (a.x / Math.max(1, a.vw)) * width,
        y: (a.y / Math.max(1, a.vh)) * height,
      };
    }

    const span = Math.max(0.001, b.t - a.t);
    const ratio = clamp((t - a.t) / span, 0, 1);
    const lerpX = a.x + (b.x - a.x) * ratio;
    const lerpY = a.y + (b.y - a.y) * ratio;
    const lerpVw = a.vw + (b.vw - a.vw) * ratio;
    const lerpVh = a.vh + (b.vh - a.vh) * ratio;

    return {
      x: (lerpX / Math.max(1, lerpVw)) * width,
      y: (lerpY / Math.max(1, lerpVh)) * height,
    };
  }

  function clickEnvelope(t) {
    // Screen Studio-style timing: delay -> zoom in -> hold -> zoom out.
    const delay = config.zoomDelay;
    const attack = config.zoomInDuration;
    const hold = config.zoomHoldDuration;
    const release = config.zoomOutDuration;

    for (let i = clickTimes.length - 1; i >= 0; i -= 1) {
      const elapsed = t - clickTimes[i] - delay;
      if (elapsed < 0 || elapsed > attack + hold + release) {
        continue;
      }

      if (elapsed < attack) {
        const p = clamp(elapsed / attack, 0, 1);
        return p * p * (3 - 2 * p);
      }
      if (elapsed < attack + hold) {
        return 1;
      }

      const releaseProgress = (elapsed - attack - hold) / release;
      const easedOut = Math.pow(1 - clamp(releaseProgress, 0, 1), 2);
      return clamp(easedOut, 0, 1);
    }

    return 0;
  }

  function clickAnchor(t) {
    // Keeps camera attention around the latest click briefly before releasing.
    const delay = config.zoomDelay;
    const hold = config.zoomHoldDuration;
    const release = config.zoomOutDuration;
    const total = hold + release;
    const fadeIn = 0.12;
    const fadeOut = Math.max(0.32, release * 0.75);
    for (let i = filteredClicks.length - 1; i >= 0; i -= 1) {
      const click = filteredClicks[i];
      const elapsed = t - click.t - delay;
      if (elapsed < 0 || elapsed > total) {
        continue;
      }
      let weight = 1;
      if (elapsed < fadeIn) {
        weight = elapsed / fadeIn;
      } else if (elapsed > total - fadeOut) {
        weight = (total - elapsed) / fadeOut;
      }
      return {
        x: click.x,
        y: click.y,
        weight: clamp(weight, 0, 1),
      };
    }
    return { x: 0, y: 0, weight: 0 };
  }

  return {
    getFrame(t) {
      const dt = lastT == null ? 1 / TARGET_FPS : Math.max(1 / 240, t - lastT);
      lastT = t;

      const pointer = samplePointer(t);
      const clickPulse = clickEnvelope(t);
      const anchor = clickAnchor(t);

      const targetScale = clamp(
        config.idleZoom + clickPulse * config.clickBoost,
        1,
        config.maxZoom
      );

      const guidedX = pointer.x + (anchor.x - pointer.x) * anchor.weight * 0.9;
      const guidedY = pointer.y + (anchor.y - pointer.y) * anchor.weight * 0.9;

      const smoothness = config.smoothness;
      // Higher smoothness = larger dead-zone and longer easing response.
      const deadZoneRatioX = 0.14 + smoothness * 0.12;
      const deadZoneRatioY = 0.12 + smoothness * 0.1;
      const deadZoneX = (width / camScale) * deadZoneRatioX;
      const deadZoneY = (height / camScale) * deadZoneRatioY;
      let targetCamX = camX;
      let targetCamY = camY;

      const dx = guidedX - camX;
      const dy = guidedY - camY;

      if (Math.abs(dx) > deadZoneX) {
        targetCamX = guidedX - Math.sign(dx) * deadZoneX;
      }
      if (Math.abs(dy) > deadZoneY) {
        targetCamY = guidedY - Math.sign(dy) * deadZoneY;
      }

      const panTau = 0.1 + smoothness * 0.35;
      const zoomTau = 0.14 + smoothness * 0.42;
      const panAlpha = 1 - Math.exp(-dt / panTau);
      const zoomAlpha = 1 - Math.exp(-dt / zoomTau);
      camX += (targetCamX - camX) * panAlpha;
      camY += (targetCamY - camY) * panAlpha;
      camScale += (targetScale - camScale) * zoomAlpha;

      const sourceWidth = width / camScale;
      const sourceHeight = height / camScale;
      const sx = clamp(camX - sourceWidth / 2, 0, width - sourceWidth);
      const sy = clamp(camY - sourceHeight / 2, 0, height - sourceHeight);

      return {
        sx,
        sy,
        sourceWidth,
        sourceHeight,
      };
    },
  };
}

async function renderZoomedVideo(rawBlob, sessionData, options) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.src = URL.createObjectURL(rawBlob);
  await waitForLoadedMetadata(video);

  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas context not available.");
  }

  const camera = createAutoCameraEngine(sessionData.events || [], width, height, {
    idleZoom: options.idleZoom,
    clickBoost: options.clickBoost,
    smoothness: options.smoothness,
    zoomDelay: options.zoomDelay,
    zoomInDuration: options.zoomInDuration,
    zoomHoldDuration: options.zoomHoldDuration,
    zoomOutDuration: options.zoomOutDuration,
    maxZoom: options.maxZoom,
  });
  const canvasStream = canvas.captureStream(TARGET_FPS);
  const videoStream = video.captureStream();
  for (const audioTrack of videoStream.getAudioTracks()) {
    canvasStream.addTrack(audioTrack);
  }

  const renderChunks = [];
  const outputRecorder = new MediaRecorder(canvasStream, getRecorderConfig());
  outputRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      renderChunks.push(event.data);
    }
  };

  const clickEvents = coalesceClicks(
    (sessionData.events || [])
      .filter((event) => event.click && typeof event.t === "number")
      .map((event) => ({
        t: event.t,
        x: (event.x / Math.max(1, event.vw)) * width,
        y: (event.y / Math.max(1, event.vh)) * height,
      }))
      .sort((a, b) => a.t - b.t),
    0.45
  );
  const clickFadeSeconds = 0.52;
  let nextClickIndex = 0;
  const activeClicks = [];

  function drawClickEffects(frameTime, sourceRect) {
    while (nextClickIndex < clickEvents.length && clickEvents[nextClickIndex].t <= frameTime) {
      activeClicks.push(clickEvents[nextClickIndex]);
      nextClickIndex += 1;
    }

    for (let i = activeClicks.length - 1; i >= 0; i -= 1) {
      const click = activeClicks[i];
      const dt = frameTime - click.t;
      if (dt < 0 || dt > clickFadeSeconds) {
        activeClicks.splice(i, 1);
        continue;
      }

      const p = dt / clickFadeSeconds;
      const eased = 1 - Math.pow(1 - p, 2);
      const baseRadius = 14 + eased * 46;
      const alpha = 0.55 * (1 - eased);

      const rx = ((click.x - sourceRect.sx) / sourceRect.sourceWidth) * width;
      const ry = ((click.y - sourceRect.sy) / sourceRect.sourceHeight) * height;

      if (rx < -80 || rx > width + 80 || ry < -80 || ry > height + 80) {
        continue;
      }

      ctx.save();
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(66, 220, 140, ${alpha})`;
      ctx.beginPath();
      ctx.arc(rx, ry, baseRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = `rgba(66, 220, 140, ${0.2 * (1 - eased)})`;
      ctx.beginPath();
      ctx.arc(rx, ry, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  let rafId = 0;
  const drawLoop = () => {
    const t = video.currentTime;
    const frame = camera.getFrame(t);

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(
      video,
      frame.sx,
      frame.sy,
      frame.sourceWidth,
      frame.sourceHeight,
      0,
      0,
      width,
      height
    );

    drawClickEffects(t, frame);

    rafId = requestAnimationFrame(drawLoop);
  };

  const stopPromise = waitRecorderStop(outputRecorder);
  const endedPromise = waitForVideoEnded(video);

  outputRecorder.start(200);
  await video.play();
  drawLoop();

  await endedPromise;
  cancelAnimationFrame(rafId);
  outputRecorder.stop();
  await stopPromise;

  URL.revokeObjectURL(video.src);
  return new Blob(renderChunks, { type: outputRecorder.mimeType || "video/webm" });
}

async function buildZoomPreview({ force = false } = {}) {
  if (!state.rawBlob || !state.sessionData) {
    throw new Error("No recording available.");
  }

  const signature = currentZoomSignature();
  if (!force && state.zoomedPreviewBlob && state.zoomSignature === signature) {
    return state.zoomedPreviewBlob;
  }

  const output = await renderZoomedVideo(
    state.rawBlob,
    state.sessionData,
    getRenderOptions()
  );
  state.zoomedPreviewBlob = output;
  state.zoomSignature = signature;
  return output;
}

async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({
      url,
      filename,
      saveAs: true,
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function buildRecordingStream() {
  if (!state.displayStream) {
    throw new Error("Display stream not ready.");
  }
  const combined = new MediaStream();
  const videoTrack = state.displayStream.getVideoTracks()[0];
  if (videoTrack) {
    combined.addTrack(videoTrack);
  }

  const micTrack = state.micStream?.getAudioTracks()[0] || null;
  const displayAudioTrack = state.displayStream.getAudioTracks()[0] || null;
  const selectedAudio = micTrack || displayAudioTrack;
  if (selectedAudio) {
    combined.addTrack(selectedAudio);
  }
  return combined;
}

async function openDisplayStream() {
  if (state.displayStream) {
    stopTracks(state.displayStream);
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { ideal: TARGET_WIDTH, max: TARGET_WIDTH },
      height: { ideal: TARGET_HEIGHT, max: TARGET_HEIGHT },
      frameRate: {
        ideal: TARGET_FPS,
        max: TARGET_FPS,
      },
    },
    audio: true,
  });

  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack?.applyConstraints) {
    try {
      await videoTrack.applyConstraints({
        width: { ideal: TARGET_WIDTH },
        height: { ideal: TARGET_HEIGHT },
        frameRate: { ideal: TARGET_FPS, max: TARGET_FPS },
      });
    } catch {
      // Some capture surfaces ignore/deny strict constraints.
    }
  }

  state.displayStream = stream;
  const settings = videoTrack?.getSettings?.() || {};
  const actualW = settings.width || "n/a";
  const actualH = settings.height || "n/a";
  const actualFps = settings.frameRate || "n/a";
  const surface = settings.displaySurface || "unknown";
  shareStateEl.textContent = `${surface}  ${actualW}x${actualH} @ ${actualFps}fps`;
  startBtn.disabled = false;
  if (surface !== "browser") {
    setStatus("Tip: choose a Browser Tab in the picker for accurate follow-cursor zoom.");
  }
  stream.getVideoTracks()[0]?.addEventListener("ended", () => {
    if (state.recorder && state.recorder.state === "recording") {
      stopBtn.click();
    }
  });
}

async function toggleMic() {
  if (state.micStream) {
    stopTracks(state.micStream);
    state.micStream = null;
    micStateEl.textContent = "Off";
    return;
  }
  const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  state.micStream = mic;
  micStateEl.textContent = "Microphone on";
}

async function startRecording() {
  if (!state.displayStream) {
    setStatus("Select a screen first.");
    return;
  }
  setStatus("Starting recording...");
  setExportUi(false);
  state.rawBlob = null;
  state.sessionData = null;
  state.chunks = [];
  state.zoomedPreviewBlob = null;
  state.zoomSignature = null;
  resetEditorPanel();

  await sendMessage({
    type: "session:start",
    tabId: Number.isFinite(sourceTabId) ? sourceTabId : null,
  });

  state.activeStream = buildRecordingStream();
  const recorder = new MediaRecorder(state.activeStream, getRecorderConfig());

  state.recorder = recorder;
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      state.chunks.push(event.data);
    }
  };

  recorder.onstop = async () => {
    const rawBlob = new Blob(state.chunks, { type: recorder.mimeType || "video/webm" });
    state.rawBlob = rawBlob;
    const response = await sendMessage({ type: "session:data" });
    state.sessionData = response?.data || { duration: 0, events: [] };
    setExportUi(true);
    setStatus(
      `Recorded ${(state.sessionData.duration || 0).toFixed(1)}s with ${
        state.sessionData.events?.length || 0
      } cursor events.`
    );
    await focusRecorderTab();
    try {
      setStatus("Building zoom preview...");
      const zoomedBlob = await buildZoomPreview({ force: true });
      openPreviewEditor(zoomedBlob, "Preview: Zoomed auto-camera");
      setStatus("Zoom preview ready.");
    } catch (error) {
      openPreviewEditor(state.rawBlob, "Preview fallback: Raw video");
      setStatus(`Zoom preview failed, showing raw video: ${error.message}`);
    }
    stopTracks(state.activeStream);
    state.activeStream = null;
  };

  recorder.start(200);
  await sendMessage({ type: "session:started" });
  setRecordingUi(true);
  startTimer();
  setStatus("Recording active...");

  if (Number.isFinite(sourceTabId)) {
    chrome.tabs.update(sourceTabId, { active: true }, () => {
      if (chrome.runtime.lastError) {
        // no-op
      }
    });
  }
}

async function stopRecording() {
  setStatus("Stopping recording...");
  await sendMessage({ type: "session:stop" });
  if (state.recorder && state.recorder.state !== "inactive") {
    state.recorder.stop();
  }
  stopTimer();
  setRecordingUi(false);
}

shareBtn.addEventListener("click", async () => {
  try {
    await openDisplayStream();
    setStatus("Screen selected. You can start recording.");
  } catch (error) {
    setStatus(`Share screen failed: ${error.message}`);
  }
});

micBtn.addEventListener("click", async () => {
  try {
    await toggleMic();
  } catch (error) {
    setStatus(`Mic failed: ${error.message}`);
  }
});

startBtn.addEventListener("click", async () => {
  try {
    await startRecording();
  } catch (error) {
    setRecordingUi(false);
    stopTimer();
    setStatus(`Start failed: ${error.message}`);
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    await stopRecording();
  } catch (error) {
    setStatus(`Stop failed: ${error.message}`);
  }
});

downloadRawBtn.addEventListener("click", async () => {
  if (!state.rawBlob) {
    return;
  }
  setStatus("Downloading raw recording...");
  await downloadBlob(state.rawBlob, "zoom-recorder/raw-recording.webm");
  setStatus("Raw recording downloaded.");
});

renderBtn.addEventListener("click", async () => {
  if (!state.rawBlob || !state.sessionData) {
    return;
  }
  try {
    const eventCount = state.sessionData.events?.length || 0;
    if (!eventCount) {
      setStatus("No cursor events captured. Record a browser tab and interact with mouse clicks.");
      return;
    }

    setStatus("Rendering zoomed export...");
    renderBtn.disabled = true;
    const output = await buildZoomPreview({ force: false });
    await downloadBlob(output, "zoom-recorder/zoomed-export.webm");
    setStatus("Zoomed export downloaded.");
  } catch (error) {
    setStatus(`Render failed: ${error.message}`);
  } finally {
    renderBtn.disabled = false;
  }
});

refreshPreviewBtn.addEventListener("click", async () => {
  if (!state.rawBlob || !state.sessionData) {
    return;
  }
  try {
    setStatus("Updating zoom preview...");
    refreshPreviewBtn.disabled = true;
    const zoomedBlob = await buildZoomPreview({ force: true });
    openPreviewEditor(zoomedBlob, "Preview: Zoomed auto-camera");
    setStatus("Zoom preview updated.");
  } catch (error) {
    setStatus(`Preview update failed: ${error.message}`);
  } finally {
    refreshPreviewBtn.disabled = false;
  }
});

function invalidateZoomPreviewCache() {
  state.zoomedPreviewBlob = null;
  state.zoomSignature = null;
}

zoomInput.addEventListener("input", invalidateZoomPreviewCache);
clickBoostInput.addEventListener("input", invalidateZoomPreviewCache);
smoothnessInput.addEventListener("input", invalidateZoomPreviewCache);
zoomDelayInput.addEventListener("input", invalidateZoomPreviewCache);
zoomInInput.addEventListener("input", invalidateZoomPreviewCache);
zoomHoldInput.addEventListener("input", invalidateZoomPreviewCache);
zoomOutInput.addEventListener("input", invalidateZoomPreviewCache);

window.addEventListener("beforeunload", () => {
  stopTracks(state.displayStream);
  stopTracks(state.micStream);
  stopTracks(state.activeStream);
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
  }
});

setRecordingUi(false);
setExportUi(false);
resetEditorPanel();
if (!Number.isFinite(sourceTabId)) {
  setStatus("Open this page from the extension icon on the tab you want to track.");
}
