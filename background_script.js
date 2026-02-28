// Put all the javascript code here, that you want to execute in background.

console.log("BACKGROUND LOADED");

let currentJob = {
  status: "idle", // idle | running | done | error'
  progress: 0,
  result: null,
  error: null,
  timestamp: null
};

browser.runtime.onMessage.addListener(async (request, sender) => {

  console.log("Background received:", request);

  // 🔐 NEW: Check login status
  if (request.action === "CHECK_LOGIN") {

  const tabId = sender.tab?.id;

    if (!tabId) {
    console.log("tab id not found, so not logged in");
    return { loggedIn: false };
  }

    try {
    console.log("about to check login status");
    const response = await browser.tabs.sendMessage(tabId, {
      action: "CHECK_LOGIN"
    });

    return response || { loggedIn: false };

  } catch (err) {
    return { loggedIn: false };
  }
  }

if (request.action === "CANCEL_JOB") {
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab?.id) {
      console.log("No active tab found for cancel.");
      return { success: false };
    }

    const response = await browser.tabs.sendMessage(tab.id, {
      action: "CANCEL_JOB"
    });
    currentJob.status = "cancelled";
    currentJob.progress = 0;

    return response || { success: true };

  } catch (err) {
    console.error("Cancel failed:", err);
    return { success: false };
  }
}


  // 🔎 Get job status
  if (request.action === "GET_STATUS") {
    return currentJob;
  }

  // ▶ Start job
  if (request.action === "START_CHECK") {

    if (currentJob.status === "running") {
      return { status: "already_running" };
    }

    currentJob = {
      status: "running",
      result: null,
      error: null,
      timestamp: Date.now()
    };

    try {
      const tabs = await browser.tabs.query({
        active: true,
        currentWindow: true
      });

      if (!tabs.length) {
        throw new Error("No active tab found");
      }

      const activeTab = tabs[0];
      browser.tabs.sendMessage(activeTab.id, {
  action: "RUN_CHECK"
});
    } catch (err) {
      console.log("Background error:", err);
      currentJob.status = "error";
      currentJob.error = err.toString();
    }

    return { status: "started" };
  }

  if (request.action === "JOB_PROGRESS") {
    currentJob.progress = request.progress;
    browser.browserAction.setBadgeBackgroundColor({
  color: "#4caf50"
});
        browser.browserAction.setBadgeText({
  text: currentJob.progress + "%"
});
  return;
}

if (request.action === "JOB_DONE") {
  currentJob.status = "done";
  currentJob.result = request.result;
  currentJob.progress = 100;
  currentJob.timestamp = Date.now();
  browser.notifications.create({
    type: "basic",
    iconUrl: "icons/icon-128.svg",
    title: "Follower Scan Complete",
    message: `Found ${request.result.dontFollowMeBack.length} followers not following you back.`,
  });
  browser.browserAction.setBadgeText({ text: "✓" });
  await browser.storage.local.set({
    finalResult: request.result
  })
  return;
}
});