console.log("BACKGROUND LOADED");

let currentJob = {
  status: "idle", // idle | running | done | error | cancelled
  progress: 0,
  result: null,
  error: null,
  timestamp: null,
  tabId: null
};


/* ===============================
   🔥 NEW: Broadcast helper
================================= */
async function broadcastStatus() {
  try {
    await browser.runtime.sendMessage({
      action: "STATUS_UPDATE",
      payload: currentJob
    });
  } catch (e) {
    // popup might be closed — that's fine
  }
}

/* ===============================
   📩 MESSAGE LISTENER
================================= */

browser.runtime.onMessage.addListener(async (request, sender) => {

  console.log("Background received:", request, currentJob);

  /* ===============================
     🔐 CHECK LOGIN
  ================================= */

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

if (request.action === "CANCEL_JOB") {
  try {
    // 🔥 Minimal Change: Use the ID we already have in our state

    if (!currentJob.tabId) {
      return { success: false, error: "No active job tab found" };
    }

    // Send the message directly to the specific tab running the scan
    await browser.tabs.sendMessage(currentJob.tabId, {
      action: "CANCEL_JOB"
    });

    // ✅ Reset job state
    currentJob.status = "cancelled";
    currentJob.progress = 0;
    currentJob.tabId = null; // Clear the reference

    // ✅ Clear badge
    browser.browserAction.setBadgeText({ text: "" });

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

  if (request.action === "GET_STATUS") {
    return currentJob;
  }

  /* ===============================
     ▶ START CHECK
  ================================= */

  if (request.action === "START_CHECK") {
  console.log(request, currentJob)
  

  // ✅ The Popup will send the tabId in the request
    const targetTabId = request.tabId; 
      if (currentJob.status === "running") {
    console.log("already running")
    return Promise.resolve({ status: "already_running" });
  }

    if (!targetTabId) {
    console.log("no tab Id exists")
    return Promise.resolve({ status: "error", message: "No Tab ID provided" });
  }

  // Update our persistent state
  currentJob = {
    status: "running",
    progress: 0,
    result: null,
    tabId: targetTabId // 🔒 Now locked in our "Source of Truth"
  };

  broadcastStatus();

  // Tell the specific tab to start working
  browser.tabs.sendMessage(targetTabId, { action: "RUN_CHECK" });

  return Promise.resolve({ status: "started" });
}

  /* ===============================
     📈 JOB PROGRESS
  ================================= */

  if (request.action === "JOB_PROGRESS") {

    currentJob.progress = request.progress;

    browser.browserAction.setBadgeBackgroundColor({
      color: "#4caf50"
    });

    browser.browserAction.setBadgeText({
      text: currentJob.progress + "%"
    });

    await broadcastStatus(); // 🔥 NEW

    return;
  }

  /* ===============================
     ✅ JOB DONE
  ================================= */

  if (request.action === "JOB_DONE") {

    currentJob.status = "done";
    currentJob.result = request.result;
    currentJob.progress = 100;
    currentJob.timestamp = Date.now();

    browser.notifications.create("scan-results", {
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/icon-128.svg"),
      title: "Scan Complete! 🔍",
      message: `Check the extension for details`,
      priority: 2
    });

    browser.browserAction.setBadgeText({ text: "✓" });

    await broadcastStatus(); // 🔥 NEW

    return;
  }

});