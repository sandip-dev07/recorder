const state = {
  active: false,
  tabId: null,
  startedAt: 0,
  events: [],
};

chrome.action.onClicked.addListener((tab) => {
  const sourceTabId = tab?.id ?? "";
  const targetUrl = chrome.runtime.getURL(`recorder.html?sourceTabId=${sourceTabId}`);
  chrome.tabs.create({ url: targetUrl });
});

function nowSeconds() {
  return (Date.now() - state.startedAt) / 1000;
}

function resetSession(tabId) {
  state.active = true;
  state.tabId = tabId;
  state.startedAt = 0;
  state.events = [];
}

function stopSession() {
  state.active = false;
}

function pushEvent(event) {
  if (!state.active || !state.startedAt) {
    return;
  }
  state.events.push({
    ...event,
    t: nowSeconds(),
  });
}

async function ensureTrackingReady(tabId) {
  if (typeof tabId !== "number") {
    return;
  }

  await new Promise((resolve) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        files: ["content.js"],
      },
      () => {
        // Some pages cannot be scripted (chrome:// etc). Ignore and continue.
        if (chrome.runtime.lastError) {
          // no-op
        }
        resolve();
      }
    );
  });

  await new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "tracking:start" }, () => {
      if (chrome.runtime.lastError) {
        // no-op
      }
      resolve();
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "session:start") {
    resetSession(message.tabId);
    ensureTrackingReady(message.tabId).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === "session:started") {
    state.startedAt = Date.now();
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "session:stop") {
    stopSession();
    if (state.tabId != null) {
      chrome.tabs.sendMessage(state.tabId, { type: "tracking:stop" }, () => {
        if (chrome.runtime.lastError) {
          // no-op
        }
      });
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "cursor:event") {
    if (sender.tab?.id === state.tabId && state.active) {
      pushEvent(message.payload);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === "session:data") {
    const duration = state.startedAt ? nowSeconds() : 0;
    sendResponse({
      ok: true,
      data: {
        duration,
        events: state.events,
      },
    });
    return false;
  }

  sendResponse({ ok: false, error: "Unknown message type" });
  return false;
});
