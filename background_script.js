console.log("BACKGROUND LOADED");

let currentJob = {
  status: "idle", // idle | running | done | error | cancelled
  progress: 0,
  result: null,
  error: null,
  timestamp: null
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
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id) {
      return { success: false };
    }

    await browser.tabs.sendMessage(tab.id, {
      action: "CANCEL_JOB"
    });

    // ✅ Reset job state
    currentJob.status = "cancelled";
    currentJob.progress = 0;

    // ✅ Clear badge
    browser.browserAction.setBadgeText({ text: "0%" });

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

  if (currentJob.status === "running") {
    return { status: "already_running" };
  }

  // 1️⃣ Update state immediately
  currentJob = {
    status: "running",
    progress: 0,
    result: null,
    error: null,
    timestamp: Date.now()
  };

  // 2️⃣ Broadcast immediately
  broadcastStatus(); // 🔥 removed await

  // 3️⃣ Start job asynchronously (do NOT await)
  (async () => {
    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true
      });

      if (!tabs.length) {
        throw new Error("No active tab found");
      }

      await browser.tabs.sendMessage(tabs[0].id, {
        action: "RUN_CHECK"
      });

    } catch (err) {
      currentJob.status = "error";
      currentJob.error = err.toString();
      broadcastStatus();
    }
  })();

  // 4️⃣ Return immediately
  return { status: "started" };
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

    await browser.storage.local.set({
      finalResult: request.result
    });

    await broadcastStatus(); // 🔥 NEW

    return;
  }

});