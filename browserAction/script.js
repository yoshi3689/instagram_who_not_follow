/* ---------------------------------------------------------
   POPUP SCRIPT ENTRYPOINT
   ---------------------------------------------------------
   This script runs inside the extension popup and controls
   all popup UI rendering and user interaction. Popup does NOT perform Instagram scraping.
   All scraping happens in the content_script.js.

   Responsibilities:
   - Validate environment (Instagram profile page + login)
   - Start a scan job
   - Poll background script for job status
   - Render UI depending on the job state

   Communication flow:

   Popup (script.js)
        │
        │ browser.runtime.sendMessage
        ▼
   Background script (job state manager)
        │
        │ browser.tabs.sendMessage
        ▼
   Content script (Instagram scraping)

--------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", init);
window.addEventListener("unload", cleanup);

let pollingInterval = null;


/* ---------------------------------------------------------
   TAB VALIDATION
   ---------------------------------------------------------
   Ensures the extension is being used on a valid
   Instagram profile page.

   Valid URL format:
   https://www.instagram.com/{username}/

   Invalid examples:
   /explore
   /p/
   /reels
--------------------------------------------------------- */

/**
 * Returns the active tab only if it is an Instagram profile page.
 *
 * Called from:
 * - init()
 *
 * Uses:
 * - browser.tabs.query()
 *
 * @returns {Promise<Tab|null>}
 */
async function getActiveInstagramProfileTab() {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  const tab = tabs[0];
  if (!tab?.url) return null;

  const url = new URL(tab.url);

  if (url.hostname !== "www.instagram.com") return null;

  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts.length !== 1) return null;

  return tab;
}


/* ---------------------------------------------------------
   INITIALIZATION
   ---------------------------------------------------------
   Runs when popup opens.

   Flow:
   1. Validate active tab
   2. Ask content script if user is logged into Instagram
   3. Ask background script for current job status
   4. Render appropriate UI
--------------------------------------------------------- */

/**
 * Main popup initialization.
 *
 * Called from:
 * - DOMContentLoaded
 *
 * Communicates with:
 * - Content script (CHECK_LOGIN)
 * - Background script (GET_STATUS)
 */
async function init() {

  try {
    const tab = await getActiveInstagramProfileTab();

    if (!tab) {
      renderMessageBox("This extension only works on Instagram profile pages.");
      return;
    }

    /* ---------------------------------------------------------
       LOGIN CHECK
       ---------------------------------------------------------
       The popup asks the content script whether the user
       is currently logged into Instagram.
    --------------------------------------------------------- */

    const loginCheck = await browser.tabs.sendMessage(tab.id, {
      action: "CHECK_LOGIN"
    });

    if (!loginCheck?.ok) {
      renderMessageBox(loginCheck?.error || "Login check failed.");
      return;
    }

    const { loggedIn } = loginCheck.data;

    if (!loggedIn) {
      renderMessageBox("Please log in to Instagram first.");
      return;
    }

    /* ---------------------------------------------------------
       JOB STATUS SYNC
       ---------------------------------------------------------
       Ask the background script whether a scan job
       is already running, finished, or idle.
    --------------------------------------------------------- */

    await handleStatus(tab.id);

  } catch (err) {
    console.error("Popup error:", err);
    renderMessageBox("Something went wrong.");
  }
}


/* ---------------------------------------------------------
   JOB STATUS HANDLING
   ---------------------------------------------------------
   The background script holds the authoritative job state.

   Possible states:

   idle
   running
   done
   error
   cancelled

   Based on this state the popup renders the appropriate UI.
--------------------------------------------------------- */

/**
 * Requests job status from the background script and
 * renders the appropriate UI.
 *
 * Called from:
 * - init()
 *
 * Communicates with:
 * - background.js (GET_STATUS)
 */
async function handleStatus(tabId) {
  const res = await browser.runtime.sendMessage({
    action: "GET_STATUS",
    tabId
  });

  if (!res?.ok) {
    renderError(res?.error || "Failed to get data.");
    return;
  }

  const data = res.data;

  if (data.status === "idle") {
    renderRunButton();
  }

  if (data.status === "running") {
    renderProgress(data.progress || 0);
    pollUntilDone(tabId);
  }

  if (data.status === "done") {
    renderResults(data.result);
  }

  if (data.status === "error" || data.status === "cancelled") {
    renderError(data.error, data.status);
  }
}


/* ---------------------------------------------------------
   USER ACTIONS
   ---------------------------------------------------------
   Functions triggered by user interaction in the popup.
--------------------------------------------------------- */

/**
 * Starts a new scan job.
 *
 * Flow:
 * 1. Ask background script to start scan
 * 2. Render progress UI immediately
 * 3. Begin polling background for updates
 *
 * Communicates with:
 * - background.js (START_CHECK)
 */
async function startCheck() {
  const tab = await getActiveInstagramProfileTab();
  if (!tab) return;

  browser.runtime.sendMessage({
    action: "START_CHECK",
    tabId: tab.id
  });

  renderProgress();
  pollUntilDone(tab.id);
}


/**
 * Polls the background script until the scan finishes.
 *
 * This allows the popup to be closed and reopened while
 * the scan continues in the background.
 *
 * Communicates with:
 * - background.js (GET_STATUS)
 */
function pollUntilDone(tabId) {

  if (pollingInterval) return;

  pollingInterval = setInterval(async () => {

    const {data} = await browser.runtime.sendMessage({
      action: "GET_STATUS",
      tabId
    });

    if (data.status === "running") {
      renderProgress(data.progress || 0);
    }

    if (data.status === "done") {
      cleanup();
      renderResults(data.result);
    }

    if (data.status === "error" || data.status === "cancelled") {
      cleanup();
      renderError(data.error, data.status);
    }

  }, 500);
}


/**
 * Stops polling when the popup closes or job finishes.
 */
function cleanup() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}


/* ---------------------------------------------------------
   UI RENDERING
   ---------------------------------------------------------
   These functions dynamically render popup content inside:

   #content

   The UI changes based on the scan state.
--------------------------------------------------------- */


/**
 * Renders the UI shown while the scan job is running.
 *
 * Displays:
 *  - loading spinner
 *  - progress percentage
 *  - progress bar
 *  - cancel button
 *
 * The scan itself runs in the background script. This popup only
 * reflects the current progress state sent via messaging.
 *
 * Interactions:
 *  - Clicking "Cancel Scan" sends a CANCEL_JOB message to the
 *    background script which aborts the running request.
 *
 * Called by:
 *  - updateProgressUI()
 *  - popup initialization when a job is already running
 *
 * @param {number} progress - Current progress percentage (0–100)
 */
function renderProgress(progress = 0) {
  const content = document.getElementById("content");

  content.innerHTML = `
    <div class="flex flex-col items-center justify-center gap-6 py-8">
      <div class="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full">
        <div class="w-8 h-8 border-[3px] border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>

      <h2 class="text-slate-900 font-semibold text-lg mb-2">
        You can close this popup
      </h2>

      <div class="text-center w-full px-2">
        <p class="text-slate-600 text-sm">
          Scanning in background...
        </p>

        <div class="space-y-2 px-4">
          <div class="flex justify-between items-center text-sm">
            <span class="text-slate-600">Progress</span>
            <span class="text-slate-900 font-semibold">${progress}%</span>
          </div>

          <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
            <div
              class="bg-gradient-to-r from-blue-500 to-blue-600 h-full rounded-full transition-all duration-300"
              style="width: ${progress}%"
            ></div>
          </div>
        </div>
      </div>

      <button
        id="cancelBtn"
        class="w-full bg-white hover:bg-slate-50 text-red-500 font-medium py-3 px-6 rounded-xl border border-red-500"
      >
        Cancel Scan
      </button>
    </div>
  `;

  document.getElementById("cancelBtn")
    .addEventListener("click", async () => {
      await browser.runtime.sendMessage({ action: "CANCEL_JOB" });
    });
}

/**
 * Renders the initial idle UI when no scan job is running.
 *
 * Displays:
 *  - introduction message
 *  - "Start Scan" button
 *
 * Interactions:
 *  - Clicking "Start Scan" triggers startCheck()
 *    which sends a START_JOB message to the background script.
 *
 * Called by:
 *  - popup initialization
 *  - after scan completes or resets
 */
function renderRunButton() {
  const content = document.getElementById("content");

  content.innerHTML = `
    <div class="flex flex-col items-center gap-6">
      <div class="w-full bg-white rounded-xl p-6 shadow-sm text-center">
        <div class="inline-flex items-center justify-center w-16 h-16 bg-slate-100 rounded-full mb-4">
          <span class="text-slate-600 text-2xl">📈</span>
        </div>

        <h2 class="text-slate-900 font-semibold text-lg mb-2">
          Ready to Scan
        </h2>

        <p class="text-slate-600 text-sm mb-4">
          Analyze your Instagram account to find users who don't follow you back
        </p>
      </div>

      <button
        id="runCheck"
        class="w-full bg-slate-800 hover:bg-slate-900 text-white font-medium py-4 px-6 rounded-xl transition-colors shadow-lg shadow-slate-800/20"
      >
        Start Scan
      </button>
    </div>
  `;

  document.getElementById("runCheck")
    .addEventListener("click", startCheck);
}

/**
 * Renders the error UI state.
 *
 * This function handles two related cases:
 *
 * 1. Scan cancelled by the user
 * 2. Unexpected scan failure
 *
 * Depending on the status and error provided, the UI will show either
 * a cancellation message or an error message.
 *
 * Displays:
 *  - error or cancellation message
 *  - button to start a new scan
 *
 * Interactions:
 *  - Clicking "Start New Scan" triggers startCheck()
 *
 * Called by:
 *  - updateProgressUI() when status === "cancelled"
 *  - updateProgressUI() when status === "error"
 *
 * @param {Error|string|null} error - Error object or message
 * @param {string} status - Current job status ("cancelled", "error", etc.)
 */
function renderError(error, status) {
  console.log(error, status)
  const content = document.getElementById("content");

  const isBeingCancelled = status === "cancelled" && !error;

  const title = isBeingCancelled
    ? "Scan Cancelled"
    : error?.message || error || "Something went wrong";

  content.innerHTML = `
    <div class="flex flex-col items-center justify-center gap-6 py-8 px-4 max-w-sm w-full bg-white rounded-2xl shadow-sm border border-slate-100">
      
      <div class="inline-flex items-center justify-center w-16 h-16 bg-red-100 rounded-full">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"
          viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          class="text-red-600">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
      </div>

      <div class="text-center">
        <h2 class="text-slate-900 font-semibold text-lg">
          ${title}
        </h2>
      </div>

      <button
        id="restartBtn"
        class="w-full bg-slate-800 hover:bg-slate-900 text-white font-medium py-3 px-6 rounded-xl transition-colors shadow-lg shadow-slate-800/20"
      >
        Start New Scan
      </button>
    </div>
  `;

  document
    .getElementById("restartBtn")
    .addEventListener("click", startCheck);
}

/**
 * Renders the final scan results.
 *
 * Displays:
 *  - total number of users who don't follow back
 *  - scrollable list of those users
 *  - links to open their Instagram profiles
 *
 * Each username links directly to the Instagram profile page.
 *
 * Called by:
 *  - updateProgressUI() when status === "done"
 *
 * @param {Object} result - Scan results returned from the background script
 * @param {Array} result.dontFollowMeBack - List of non-following users
 */
function renderResults(result) {
  const content = document.getElementById("content");

  if (!result || typeof result !== "object") {
    content.innerHTML = `
      <div class="text-center p-6 text-red-600">
        Unexpected error occurred.
      </div>
    `;
    return;
  }

  

  const users = result.dontFollowMeBack || [];
  const count = users.length;

  content.innerHTML = `
    <div class="flex flex-col items-center justify-center gap-6 py-8">
      <div class="text-7xl font-black text-slate-900">
        ${count}
      </div>

      <div class="text-center">
        <h2 class="text-slate-900 font-semibold text-lg mb-2">
          ${count === 0
            ? "Your follower list is perfectly in sync."
            : "users don't follow you back"}
        </h2>
      </div>

      <div class="w-full bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="px-5 py-3 bg-slate-50 border-b border-slate-200">
          <h3 class="text-slate-700 font-medium text-sm">
            Non-Followers List
          </h3>
        </div>
        <div id="userList" class="max-h-[220px] overflow-y-auto"></div>
      </div>
    </div>
  `;

  const userList = document.getElementById("userList");

  users.forEach(user => {
    const row = document.createElement("div");
    row.className =
      "flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-b-0";

    row.innerHTML = `
      <div class="flex items-center gap-3 flex-1 min-w-0">
        <div class="w-10 h-10 flex-shrink-0 rounded-full bg-slate-200 flex items-center justify-center overflow-hidden">
          <span class="text-slate-400 text-sm">👤</span>
        </div>

        <a href="https://www.instagram.com/${user.username}/"
           target="_blank"
           class="text-slate-900 font-medium text-sm hover:text-blue-600 transition-colors truncate">
          @${user.username}
        </a>
      </div>

      <a href="https://www.instagram.com/${user.username}/"
         target="_blank"
         class="text-slate-600 hover:text-slate-900 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors flex-shrink-0 ml-2">
        View
      </a>
    `;

    userList.appendChild(row);
  });

}

/**
 * Renders a simple message box inside the popup.
 *
 * Used for displaying generic informational messages
 * when no specific UI state is required.
 *
 * @param {string} message - Text message to display
 */
function renderMessageBox(message) {
  const content = document.getElementById("content");
  content.innerHTML = `<p>${message}</p>`;
}



