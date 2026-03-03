// ========================================
// 🧠 GLOBAL JOB STATE (BACKGROUND ONLY)
// ========================================
// This is the single source of truth for the scan lifecycle.
// Popup reads from this.
// Content script only reports progress.
// Background owns and controls it.

let currentJob = getInitialState()

function getInitialState() {
  return {
    status: "idle",      // idle | running | done | error | cancelled
    progress: 0,         // 0–100
    result: null,        // final scan result
    error: null,         // error message if failed
    timestamp: null,     // completion time
    tabId: null          // tab currently running the scan
  }
}

/* ===============================
   🔄 Broadcast state to popup
================================= */
// Sends the latest job state to any open popup.
// If popup is closed, this safely fails silently.
async function broadcastStatus() {
  try {
    await browser.runtime.sendMessage({
      action: "STATUS_UPDATE",
      payload: currentJob
    });
  } catch (e) {
    // Popup might not be open — that's fine.
  }
}

/* ===============================
   📩 MESSAGE LISTENER (Background)
================================= */
// Background acts as:
// - State manager
// - Job controller
// - Router between popup and content script

browser.runtime.onMessage.addListener(async (request, sender) => {

  /* ===============================
     🔐 CHECK LOGIN
  ================================= */
  // Popup asks background.
  // Background forwards the request to the active tab.
  // Content script performs actual DOM check.

  if (request.action === "CHECK_LOGIN") {

    const tabId = sender.tab?.id;

    if (!tabId) {
      return { loggedIn: false };
    }

    try {
      const response = await browser.tabs.sendMessage(tabId, {
        action: "CHECK_LOGIN"
      });

      return response || { loggedIn: false };

    } catch {
      return { loggedIn: false };
    }
  }

  /* ===============================
     ❌ CANCEL JOB
  ================================= */
  // Popup → Background → Content Script
  // Background also resets its own state.

  if (request.action === "CANCEL_JOB") {

    if (!currentJob.tabId) {
      return { success: false, error: "No active job tab found" };
    }

    try {
      // Tell content script to stop scanning
      await browser.tabs.sendMessage(currentJob.tabId, {
        action: "CANCEL_JOB"
      });

      // Reset internal state
      currentJob = getInitialState();
      currentJob.status = "cancelled";

      // Clear badge
      browser.browserAction.setBadgeText({ text: "" });

      // Notify popup
      await broadcastStatus();

      return { success: true };

    } catch (err) {
      console.error("Cancel failed:", err);
      return { success: false };
    }
  }

  /* ===============================
     📊 GET STATUS
  ================================= */
  // Popup uses this when opened to sync UI with background state.

  if (request.action === "GET_STATUS") {
    return currentJob;
  }

  /* ===============================
     ▶ START CHECK
  ================================= */
  // Popup → Background
  // Background validates state
  // Background tells specific tab to start scanning

  if (request.action === "START_CHECK") {

    // Prevent duplicate jobs
    if (currentJob && currentJob.status === "running") {
      return Promise.resolve({ status: "already_running" });
    }

    const targetTabId = request.tabId;

    if (!targetTabId) {
      return Promise.resolve({
        status: "error",
        message: "No Tab ID provided"
      });
    }

    // Initialize new job
    currentJob = {
      status: "running",
      progress: 0,
      result: null,
      error: null,
      timestamp: null,
      tabId: targetTabId
    };

    await broadcastStatus();

    // Tell content script to begin
    browser.tabs.sendMessage(targetTabId, {
      action: "RUN_CHECK"
    });

    return Promise.resolve({ status: "started" });
  }

  /* ===============================
     📈 JOB PROGRESS
  ================================= */
  // Content Script → Background
  // Background updates state and badge.

  if (request.action === "JOB_PROGRESS") {

    currentJob.progress = request.progress;

    // Visual badge feedback
    browser.browserAction.setBadgeBackgroundColor({
      color: "#4caf50"
    });

    browser.browserAction.setBadgeText({
      text: currentJob.progress + "%"
    });

    await broadcastStatus();

    return;
  }

  /* ===============================
     ✅ JOB DONE
  ================================= */
  // Content Script → Background
  // Finalizes state and triggers notification.

  if (request.action === "JOB_DONE") {

    // Safety guard:
    // Ignore if job was already cancelled or replaced
    if (!currentJob || currentJob.status !== "running") {
      return;
    }

    currentJob.status = "done";
    currentJob.result = request.result;
    currentJob.progress = 100;
    currentJob.timestamp = Date.now();

    // User notification
    browser.notifications.create("scan-results", {
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/icon-128.svg"),
      title: "Scan Complete! 🔍",
      message: `Check the extension for details`,
      priority: 2
    });

    // Badge shows completion
    browser.browserAction.setBadgeText({ text: "✓" });

    await broadcastStatus();

    return;
  }

});