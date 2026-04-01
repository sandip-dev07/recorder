const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const downloadRawBtn = document.getElementById("downloadRawBtn");
const renderBtn = document.getElementById("renderBtn");
const statusEl = document.getElementById("status");
const zoomInput = document.getElementById("zoomInput");
const clickBoostInput = document.getElementById("clickBoostInput");

const state = {
  tabId: null,
  stream: null,
  recorder: null,
  chunks: [],
  rawBlob: null,
  sessionData: null,
};

function setStatus(text) {
  statusEl.textContent = text;
}

function setRecordingUi(recording) {
  startBtn.disabled = recording;
  stopBtn.disabled = !recording;
}

function setExportUi(enabled) {
  downloadRawBtn.disabled = !enabled;
  renderBtn.disabled = !enabled;
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

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]?.id) {
    throw new Error("Could not detect an active tab.");
  }
  return tabs[0].id;
}

async function sendMessage(payload) {
  return chrome.runtime.sendMessage(payload);
}

function stopTracks(stream) {
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

function createCursorTracker(events, width, height) {
  const moveEvents = events.filter((event) => typeof event.t === "number");
  let index = 0;
  let smoothedX = width / 2;
  let smoothedY = height / 2;

  function findNearest(t) {
    while (index + 1 < moveEvents.length && moveEvents[index + 1].t <= t) {
      index += 1;
    }
    const a = moveEvents[index];
    const b = moveEvents[index + 1];
    if (!a) {
      return null;
    }
    if (!b) {
      return a;
    }
    const span = Math.max(0.001, b.t - a.t);
    const ratio = clamp((t - a.t) / span, 0, 1);
    return {
      t,
      x: a.x + (b.x - a.x) * ratio,
      y: a.y + (b.y - a.y) * ratio,
      vw: a.vw + (b.vw - a.vw) * ratio,
      vh: a.vh + (b.vh - a.vh) * ratio,
    };
  }

  function clickPulseAt(t, windowSeconds = 0.25) {
    let best = 0;
    for (let i = 0; i < moveEvents.length; i += 1) {
      const event = moveEvents[i];
      if (!event.click) {
        continue;
      }
      const dt = Math.abs(event.t - t);
      if (dt > windowSeconds) {
        continue;
      }
      const pulse = 1 - dt / windowSeconds;
      if (pulse > best) {
        best = pulse;
      }
    }
    return best;
  }

  return {
    getFrameState: (t) => {
      const nearest = findNearest(t);
      const clickPulse = clickPulseAt(t);
      if (!nearest) {
        return {
          x: smoothedX,
          y: smoothedY,
          clickPulse,
        };
      }

      const mappedX = (nearest.x / Math.max(1, nearest.vw)) * width;
      const mappedY = (nearest.y / Math.max(1, nearest.vh)) * height;
      const alpha = 0.2;
      smoothedX += (mappedX - smoothedX) * alpha;
      smoothedY += (mappedY - smoothedY) * alpha;

      return {
        x: smoothedX,
        y: smoothedY,
        clickPulse,
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

  const cursor = createCursorTracker(sessionData.events || [], width, height);
  const canvasStream = canvas.captureStream(30);
  const videoStream = video.captureStream();
  for (const audioTrack of videoStream.getAudioTracks()) {
    canvasStream.addTrack(audioTrack);
  }

  const renderChunks = [];
  const outputRecorder = new MediaRecorder(canvasStream, {
    mimeType: getMimeType() || "video/webm",
  });
  outputRecorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      renderChunks.push(event.data);
    }
  };

  let rafId = 0;
  const drawLoop = () => {
    const t = video.currentTime;
    const frame = cursor.getFrameState(t);
    const zoom = Number(options.baseZoom) + frame.clickPulse * Number(options.clickBoost);
    const scale = clamp(zoom, 1, 3);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    const sx = clamp(frame.x - sourceWidth / 2, 0, width - sourceWidth);
    const sy = clamp(frame.y - sourceHeight / 2, 0, height - sourceHeight);

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(video, sx, sy, sourceWidth, sourceHeight, 0, 0, width, height);

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

startBtn.addEventListener("click", async () => {
  try {
    setStatus("Starting capture...");
    setExportUi(false);
    state.rawBlob = null;
    state.sessionData = null;
    state.chunks = [];

    const tabId = await getActiveTabId();
    state.tabId = tabId;
    await sendMessage({ type: "session:start", tabId });

    const stream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture(
        {
          audio: true,
          video: true,
        },
        (capturedStream) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (!capturedStream) {
            reject(new Error("No capture stream available."));
            return;
          }
          resolve(capturedStream);
        }
      );
    });

    state.stream = stream;
    const mimeType = getMimeType();
    const recorder = new MediaRecorder(
      stream,
      mimeType
        ? {
            mimeType,
          }
        : undefined
    );

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
    };

    recorder.start(200);
    setRecordingUi(true);
    setStatus("Recording active...");
  } catch (error) {
    setRecordingUi(false);
    setStatus(`Start failed: ${error.message}`);
  }
});

stopBtn.addEventListener("click", async () => {
  try {
    setStatus("Stopping capture...");
    setRecordingUi(false);
    await sendMessage({ type: "session:stop" });

    if (state.recorder && state.recorder.state !== "inactive") {
      state.recorder.stop();
    }
    if (state.stream) {
      stopTracks(state.stream);
    }
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
    setStatus("Rendering zoomed export...");
    renderBtn.disabled = true;
    const output = await renderZoomedVideo(state.rawBlob, state.sessionData, {
      baseZoom: Number(zoomInput.value),
      clickBoost: Number(clickBoostInput.value),
    });
    await downloadBlob(output, "zoom-recorder/zoomed-export.webm");
    setStatus("Zoomed export downloaded.");
  } catch (error) {
    setStatus(`Render failed: ${error.message}`);
  } finally {
    renderBtn.disabled = false;
  }
});
