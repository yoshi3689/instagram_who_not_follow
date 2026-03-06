// ========================================
// 🧠 GLOBAL JOB STATE (BACKGROUND ONLY)
// ========================================
// This is the single source of truth for the scan lifecycle.
// Popup reads from this.
// Content script only reports progress.
// Background owns and controls it.

/* =====================================================
   ERROR CODES
===================================================== */

const ERROR_CODES = {
  REQUEST_CANCELLED: "REQUEST_CANCELLED",
  ACCOUNT_TOO_LARGE: "ACCOUNT_TOO_LARGE",
  NETWORK_ERROR: "NETWORK_ERROR",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  SEARCH_FAILED: "SEARCH_FAILED",
  SCAN_FAILED: "SCAN_FAILED",
  LOGIN_CHECK_FAILED: "LOGIN_CHECK_FAILED",
  START_CHECK_FAILED: "START_CHECK_FAILED",
  CANCEL_FAILED: "CANCEL_FAILED",
  INTERNAL_ERROR: "INTERNAL_ERROR"
};

/* =====================================================
   🧠 JOB STATE
===================================================== */

let currentJob = getInitialState();

function getInitialState() {
  return {
    status: "idle",      // idle | running | done | error | cancelled
    progress: 0,
    result: null,
    error: null,
    timestamp: null,
    tabId: null
  };
}

/* =====================================================
   ♻ RESET STATE HELPER
===================================================== */

function resetJobState(newStatus = "idle") {
  currentJob = getInitialState();
  currentJob.status = newStatus;

  // Clear badge
  browser.browserAction.setBadgeText({ text: "" });
}

function updateJob(patch) {
  currentJob = {
    ...currentJob,
    ...patch,
    timestamp: Date.now()
  };
}

function success(data = null) {
  return { ok: true, data };
}

function failure(code, message = code) {
  return {
    ok: false,
    error: {
      code,
      message
    }
  };
}

/* =====================================================
   📡 BROADCAST STATUS TO POPUP
===================================================== */

async function broadcastStatus() {
  try {
    await browser.runtime.sendMessage({
      action: "STATUS_UPDATE",
      payload: currentJob
    });
  } catch {
    // Popup might be closed — that's fine
  }
}

/* =====================================================
   ACTION HANDLERS
===================================================== */

const actionHandlers = {

  async CHECK_LOGIN(request, sender) {
    try {
      const response = await browser.tabs.sendMessage(
        sender.tab.id,
        { action: "CHECK_LOGIN" }
      );

      return success(response);

    } catch (err) {
      return failure(
        ERROR_CODES.LOGIN_CHECK_FAILED,
        "Login check failed"
      );
    }
  },


  async START_CHECK(request) {

    if (currentJob.status === "running") {
      return success({ status: "already_running" });
    }

    if (!request.tabId) {
      return failure(
        ERROR_CODES.NO_TAB_ID,
        "No Tab ID provided"
      );
    }

    updateJob({
      ...getInitialState(),
      status: "running",
      tabId: request.tabId,
      progress: 0,
      result: null,
      error: null
    });

    await broadcastStatus();

    try {

      const response = await browser.tabs.sendMessage(
        request.tabId,
        {
          action: "RUN_CHECK",
          username: request.username
        }
      );

      if (!response?.ok) {

        const errorObj = response?.error || {
          code: ERROR_CODES.SCAN_FAILED,
          message: "Scan failed"
        };

        updateJob({
          status: "error",
          error: errorObj,
          progress: 0
        });

        await broadcastStatus();

        return failure(errorObj.code, errorObj.message);
      }


      updateJob({
        status: "done",
        result: response.data,
        progress: 100
      });

      await broadcastStatus();


      browser.browserAction.setBadgeText({ text: "✓" });

      browser.notifications.create("scan-results", {
        type: "basic",
        iconUrl: browser.runtime.getURL("icons/icon-128.svg"),
        title: "Scan Complete",
        message: "Check the extension for details"
      });

      return success({ status: "done" });

    } catch (err) {

      const message = err.message || "Failed to start scan";

      updateJob({
        status: "error",
        error: {
          code: ERROR_CODES.SCAN_FAILED,
          message
        }
      });

      await broadcastStatus();

      return failure(ERROR_CODES.SCAN_FAILED, message);
    }
  },


  async CANCEL_JOB() {

    if (!currentJob.tabId) {
      return failure(
        ERROR_CODES.NO_ACTIVE_JOB,
        "No active job tab found"
      );
    }

    try {

      await browser.tabs.sendMessage(
        currentJob.tabId,
        { action: "CANCEL_JOB" }
      );

      updateJob({
        status: "cancelled",
        progress: 0
      });

      await broadcastStatus();

      return success({ status: "cancelled" });

    } catch (err) {

      return failure(
        ERROR_CODES.CANCEL_FAILED,
        "Cancel failed"
      );
    }
  },


  GET_STATUS() {
    return success(currentJob);
  },


  async JOB_PROGRESS(request) {

    if (currentJob.status !== "running") {
      return success({ ignored: true });
    }

    updateJob({
      progress: request.progress
    });

    await broadcastStatus();

    return success({ progress: request.progress });
  }
};



/* =====================================================
   GLOBAL MESSAGE LISTENER
===================================================== */

browser.runtime.onMessage.addListener(async (request, sender) => {

  const handler = actionHandlers[request.action];

  if (!handler) {
    return failure(
      ERROR_CODES.UNKNOWN_ACTION,
      `Unknown action: ${request.action}`
    );
  }

  try {

    const result = await handler(request, sender);

    if (!result || typeof result.ok !== "boolean") {
      return failure(
        ERROR_CODES.INVALID_HANDLER_RESPONSE,
        "Invalid handler response"
      );
    }

    return result;

  } catch (err) {

    console.error("Handler error:", err);

    return failure(
      ERROR_CODES.INTERNAL_ERROR,
      err.message || "Internal error"
    );
  }
});