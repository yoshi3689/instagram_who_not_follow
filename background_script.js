/* =========================================================
   BACKGROUND SCRIPT — EXTENSION CONTROLLER

   This file acts as the central controller of the extension.
   It manages the scan job lifecycle, coordinates communication
   between the popup UI and the content script, and maintains
   the global job state.

   ---------------------------------------------------------
   ARCHITECTURE OVERVIEW
   ---------------------------------------------------------

   Popup UI (popup.js)
        │
        │ START_JOB / CANCEL_JOB
        ▼
   Background Script (this file)
        │
        │ RUN_CHECK / CHECK_LOGIN
        ▼
   Content Script (content_script.js)
        │
        │ performs Instagram data fetching
        │
        │ JOB_PROGRESS / JOB_DONE
        ▼
   Background Script
        │
        │ broadcastStatus()
        ▼
   Popup UI updates


   ---------------------------------------------------------
   JOB LIFECYCLE
   ---------------------------------------------------------

   1. User clicks "Start Scan" in the popup
   2. Popup sends START_JOB to background
   3. Background sets job state to "running"
   4. Background sends RUN_CHECK to the content script
   5. Content script performs the scan
   6. Content script sends progress updates (JOB_PROGRESS)
   7. Background broadcasts progress to popup(s)
   8. When finished, content script sends JOB_DONE
   9. Background updates state to "done" and stores result

   If the user cancels:
   - Popup sends CANCEL_JOB
   - Background forwards cancel message to content script
   - Job state becomes "cancelled"


   ---------------------------------------------------------
   RESPONSIBILITIES OF THIS FILE
   ---------------------------------------------------------

   • Maintain the global job state
   • Route messages between popup and content scripts
   • Ensure only one scan job runs at a time
   • Broadcast job progress and status updates
   • Handle job cancellation
   • Store final scan results


   ---------------------------------------------------------
   IMPORTANT NOTE
   ---------------------------------------------------------

   The actual Instagram scraping logic lives inside
   content_script.js. The background script only manages
   state and communication between extension components.

========================================================= */

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

/* =========================================================
   JOB STATE
   =========================================================

   The background script maintains a single job state object
   representing the current scan lifecycle.

   The popup UI can be opened or closed at any time, so the
   scan state must live in the background script rather than
   the popup.

   The popup retrieves this state by sending:
       GET_STATUS

   Possible job states:

   idle
       No scan has started.

   running
       A scan is currently executing in the content script.
       Progress updates will be received periodically.

   done
       The scan finished successfully and `result` is available.

   error
       The scan failed due to an unexpected error.

   cancelled
       The user stopped the scan before completion.

   This state object is reset whenever a new scan begins.
========================================================= */

let currentJob = getInitialState();

/**
 * Creates a fresh job state object.
 *
 * Called when:
 *  - the extension initializes
 *  - a new scan starts
 *  - the previous job is reset
 *
 * Keeping this logic in a function ensures the job state
 * structure remains consistent across resets.
 *
 * @returns {Object} initial job state
 */
function getInitialState() {
  return {
    status: "idle",     // current lifecycle state of the scan job
    progress: 0,        // progress percentage (0–100) reported by content script
    result: null,       // final scan results when status === "done"
    error: null,        // error message when status === "error"
    timestamp: null,    // timestamp of when the job started
    tabId: null         // Instagram tab where the scan is running
  };
}


/* =====================================================
   HELPER FUNCTIONS
=====================================================

These helper functions provide small utilities used
throughout the background script to keep the code
consistent and easier to maintain.

Responsibilities include:

• Managing the global job state
• Broadcasting status updates to the popup UI
• Standardizing success/error response objects

All background message handlers rely on these helpers
to avoid duplicating logic.
*/

/**
 * Resets the global job state to a fresh initial state.
 *
 * This is used when starting a new scan or when the
 * extension needs to clear any previous job data.
 *
 * The browser badge is also cleared so the extension
 * icon reflects the reset state.
 *
 * @param {string} newStatus - optional status to assign
 * after reset (default: "idle")
 */
function resetJobState(newStatus = "idle") {
  currentJob = getInitialState();
  currentJob.status = newStatus;

  // Clear badge
  browser.browserAction.setBadgeText({ text: "" });
}

/**
 * Updates the current job state with new values.
 *
 * This function merges a partial state update into the
 * existing `currentJob` object and refreshes the timestamp.
 *
 * Used throughout the background script when:
 * • progress updates arrive
 * • scan results are returned
 * • an error occurs
 *
 * @param {Object} patch - partial job state update
 */
function updateJob(patch) {
  currentJob = {
    ...currentJob,
    ...patch,
    timestamp: Date.now()
  };
}

/**
 * Creates a standardized success response.
 *
 * All message handlers return objects following this format
 * so popup and content scripts can reliably detect success.
 *
 * @param {*} data - optional payload
 * @returns {Object} standardized success response
 */
function success(data = null) {
  return { ok: true, data };
}

/**
 * Creates a standardized error response.
 *
 * Errors are returned in a consistent format so the popup
 * UI can display appropriate error messages.
 *
 * @param {string} code - error code from ERROR_CODES
 * @param {string} message - human readable error message
 * @returns {Object} standardized failure response
 */
function failure(code, message = code) {
  return {
    ok: false,
    error: {
      code,
      message
    }
  };
}

/**
 * Sends the current job state to the popup UI.
 *
 * The popup may open while a scan is already running,
 * so broadcasting updates ensures the UI stays in sync
 * with the background job state.
 *
 * If the popup is closed, the message will fail silently.
 * This is expected behavior and therefore ignored.
 */
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
=====================================================

This object maps incoming extension messages to the
functions responsible for handling them.

The background script acts as the central coordinator
between the popup UI and the Instagram content script.

Message Flow Architecture

Popup UI
   │
   │ browser.runtime.sendMessage()
   ▼
Background Script (this file)
   │
   │ browser.tabs.sendMessage()
   ▼
Content Script (Instagram page)

Each handler here processes one specific action.

Handlers may:
• start or cancel a scan
• forward messages to the content script
• update the global job state
• return standardized responses

All handlers must return an object in the format:

{
  ok: true,
  data: ...
}

or

{
  ok: false,
  error: { code, message }
}

This guarantees consistent communication between
all parts of the extension.
*/
const actionHandlers = {

  /**
   * CHECK_LOGIN
   * Verifies whether the user is currently logged into Instagram.
   *
   * The popup triggers this check during initialization to ensure
   * the extension can access the user's follower data.
   *
   * The background forwards the request to the content script
   * running on the Instagram page, which performs the actual
   * DOM/session check.
   *
   * Called by:
   *   popup script during init()
   *
   * Flow:
   *   Popup → Background → Content Script
   *
   * @returns {Object} success({ loggedIn: boolean }) or failure()
   */
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


  /**
   * START_CHECK
   * Starts a new Instagram scan job.
   *
   * This handler initializes the global job state and then
   * instructs the content script to begin scanning the
   * followers and following lists.
   *
   * Responsibilities:
   *   • Prevent starting multiple scans simultaneously
   *   • Initialize job state
   *   • Forward the RUN_CHECK request to the content script
   *   • Process the final scan result
   *   • Notify the popup UI of status changes
   *   • Show a completion badge + notification
   *
   * Called by:
   *   popup → startCheck()
   *
   * Flow:
   *   Popup → Background → Content Script
   */
  async START_CHECK(request) {

    // Prevent multiple scans from running simultaneously
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

      // Forward scan request to the content script running on the Instagram tab
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

      // Notify the user that the scan has finished
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


  /**
   * Cancels the currently running scan job.
   *
   * The popup triggers this when the user presses the
   * "Cancel Scan" button.
   *
   * The background forwards the cancellation request to
   * the content script so it can abort the scanning logic.
   *
   * After cancellation the job state is updated and the
   * popup UI will switch to the cancelled state.
   *
   * Called by:
   *   popup → Cancel Scan button
   */
  async CANCEL_JOB() {
    if (!currentJob.tabId) {
      return failure(
        ERROR_CODES.NO_ACTIVE_JOB,
        "No active job tab found"
      );
    }

    try {

      // Forward cancellation request to the content script
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


  /**
   * Returns the current job state to the popup.
   *
   * The popup polls this endpoint periodically while a
   * scan is running so the progress bar can update.
   *
   * Called by:
   *   popup → handleStatus()
   *   popup → pollUntilDone()
   */
  GET_STATUS() {
    return success(currentJob);
  },


  /**
   * Receives progress updates from the content script.
   *
   * While scanning, the content script periodically sends
   * JOB_PROGRESS messages containing the current percentage.
   *
   * The background updates the global job state and then
   * broadcasts the update so the popup UI can reflect
   * the new progress.
   *
   * Called by:
   *   content script during scan execution
   */
  async JOB_PROGRESS(request) {

    // Ignore updates if the job is no longer running
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
   GLOBAL MESSAGE ROUTER
=====================================================

This listener is the central entry point for all
messages sent to the background script.

Both the popup UI and the content script communicate
with the background by calling:

    browser.runtime.sendMessage({ action: ... })

The message "action" determines which handler inside
the `actionHandlers` object should process the request.

Flow of a typical message:

Popup / Content Script
        │
        │ browser.runtime.sendMessage()
        ▼
Background Script (this listener)
        │
        │ route to actionHandlers[action]
        ▼
Handler executes
        │
        │ returns standardized response
        ▼
Response sent back to sender

All handlers must return an object with the format:

Success:
{ ok: true, data: ... }

Failure:
{ ok: false, error: { code, message } }

This router also ensures:
• unknown actions are rejected safely
• handler errors are caught
• invalid responses are normalized
*/

browser.runtime.onMessage.addListener(async (request, sender) => {

  // Look up the handler that corresponds to the requested action
  const handler = actionHandlers[request.action];

  // Reject unknown actions to prevent undefined behavior
  if (!handler) {
    return failure(
      ERROR_CODES.UNKNOWN_ACTION,
      `Unknown action: ${request.action}`
    );
  }

  try {

    // Execute the appropriate handler
    const result = await handler(request, sender);

    // Ensure the handler returned a properly structured response
    if (!result || typeof result.ok !== "boolean") {
      return failure(
        ERROR_CODES.INVALID_HANDLER_RESPONSE,
        "Invalid handler response"
      );
    }

    return result;

  } catch (err) {

    // Catch unexpected errors so they do not break
    // the extension message pipeline
    console.error("Handler error:", err);

    return failure(
      ERROR_CODES.INTERNAL_ERROR,
      err.message || "Internal error"
    );
  }
});