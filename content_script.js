/* =========================================================
   CONTENT SCRIPT — INSTAGRAM SCAN EXECUTION
=========================================================

This script runs directly inside Instagram pages and is
responsible for performing the actual follower scan.

Responsibilities of the content script:

• Detect whether the user is logged in
• Execute the follower / following scan
• Interact with the Instagram DOM when necessary
• Send progress updates to the background script
• Return final scan results

The content script DOES NOT manage global state.
All scan lifecycle state is controlled by the
background script.

Architecture Overview

Popup UI
   │
   │ START_CHECK / CANCEL_JOB
   ▼
Background Script (job state + coordination)
   │
   │ RUN_CHECK
   ▼
Content Script (this file)
   │
   ├─ performs scan
   ├─ sends JOB_PROGRESS updates
   └─ returns results when finished

All communication happens through:
    browser.runtime.sendMessage()
    browser.runtime.onMessage

This separation ensures that:

• The scan continues even if the popup closes
• Job state persists in the background script
• The content script focuses only on page logic

Security considerations:

• No user data is transmitted externally
• All processing happens locally in the browser
• Only Instagram pages are accessed
========================================================= */

/* ---------------------------------------------------------
   GLOBAL STATE
---------------------------------------------------------

These variables maintain runtime state for the content script
while a scan is executing inside the Instagram page.

Important:
The content script does NOT maintain the authoritative job state.
The background script controls the job lifecycle.

The state here only supports:
• scan execution
• cancellation
• UI injection on the Instagram page

Variables

urls
  Dynamically imported endpoint definitions used to call
  Instagram's internal APIs.

isCancelled
  Flag used to safely interrupt long-running scan loops.
  This is checked before every request iteration.

progressUIContainer
  Reference to the floating progress UI injected into the
  Instagram page during scanning.
*/

let urls = null;
let isCancelled = false;
let progressUIContainer = null;

/* ---------------------------------------------------------
   ERROR CONSTANTS
---------------------------------------------------------

Centralized error codes used throughout the scan logic.

Each error code maps to a user-friendly message in
ERROR_MESSAGES.

This ensures:
• consistent error reporting
• predictable popup UI behavior
• easier debugging

Errors are propagated back to the background script through
the final scan result.
*/
const ERRORS = {
  CANCELLED: "REQUEST_CANCELLED",
  NETWORK: "NETWORK_ERROR",
  INVALID_RESPONSE: "INVALID_RESPONSE",
  SEARCH_FAILED: "SEARCH_FAILED",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  ACCOUNT_TOO_LARGE: "ACCOUNT_TOO_LARGE",
  UNKNOWN: "UNKNOWN_ERROR"
};


const ERROR_MESSAGES = {
  [ERRORS.CANCELLED]: "Scan cancelled",
  [ERRORS.NETWORK]: "Network error. Please try again.",
  [ERRORS.INVALID_RESPONSE]: "Instagram returned an invalid response.",
  [ERRORS.SEARCH_FAILED]: "Failed to search for the user.",
  [ERRORS.USER_NOT_FOUND]: "User not found.",
  [ERRORS.ACCOUNT_TOO_LARGE]: "Account too large (10k+).",
  [ERRORS.UNKNOWN]: "Unexpected error."
};

/* ---------------------------------------------------------
   INIT URLS
---------------------------------------------------------

Instagram endpoint definitions are loaded dynamically
from urls.js.

This avoids hardcoding endpoint values directly inside
the content script and keeps the request configuration
centralized.

The import uses browser.runtime.getURL() so the file
can be loaded from the extension package safely.
*/

(async () => {
  const src = browser.runtime.getURL("./urls.js");
  urls = await import(src).then(res => res.default);
})();

/* ---------------------------------------------------------
   UTILITIES
---------------------------------------------------------

Small helper utilities used throughout the scan logic.

sleep()
  Creates a delay between requests to avoid sending
  too many requests too quickly.

randomBetween()
  Generates randomized delay values to make the request
  pattern less aggressive.

cleanupExtensionUI()
  Removes the floating scan UI injected into the page.
  This is triggered when:

  • the scan finishes
  • the scan is cancelled
  • the user navigates to another page
*/

/**
 * Creates a delay used between API requests.
 *
 * This helps avoid sending requests too quickly which
 * could trigger Instagram rate limiting.
 *
 * @param {number} ms - Duration of the delay in milliseconds
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generates a random integer between min and max.
 *
 * Used to randomize request timing between API calls
 * to avoid sending requests in a predictable pattern.
 *
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Removes the floating progress UI injected into the
 * Instagram page.
 *
 * This is called when:
 *  • the scan completes
 *  • the scan is cancelled
 *  • navigation occurs
 *
 * Prevents leftover UI elements remaining in the page DOM.
 */
function cleanupExtensionUI() {
    const root = document.getElementById("my-extension-root");
  if (root) {
    root.remove();
  }
}

/**
 * Reports scan progress to both:
 *
 * 1) the floating UI injected into the page
 * 2) the background script (job state)
 *
 * This keeps the popup UI synchronized with the
 * scan progress even if the popup is closed.
 *
 * @param {number}  - Current progress percentage
 */
async function sendProgress(progress) {
  const rounded = Math.round(progress);

  injectExtensionUI({ progress: rounded });

  await browser.runtime.sendMessage({
    action: "JOB_PROGRESS",
    progress: rounded
  });
}

/**
 * Fetches all users from Instagram using the GraphQL API.
 *
 * Handles:
 *  • pagination
 *  • request pacing
 *  • progress updates
 *  • cancellation
 *
 * Used by findNonFollowers() to retrieve both
 * followers and following lists.
 *
 * @param {string} userId
 * @param {"followers"|"following"} type
 * @param {number} progressStart
 * @param {number} progressEnd
 * @returns {Promise<Array>}
 */
async function fetchAllUsers(userId, type, progressStart, progressEnd) {

  let users = [];
  let after = null;
  let hasNext = true;
  let total = null;
  let fetched = 0;

  while (hasNext) {

    if (isCancelled) {
      throw new Error(ERRORS.CANCELLED);
    }

    await sleep(randomBetween(200, 600));

    const res = await fetch(
      `${type === "followers" ? urls.followers : urls.following}&variables=` +
      encodeURIComponent(JSON.stringify({
        id: userId,
        include_reel: true,
        fetch_mutual: true,
        first: 50,
        after
      }))
    );

    if (!res.ok) {
      throw new Error(ERRORS.NETWORK);
    }

    const json = await res.json();

    const container =
      type === "followers"
        ? json.data?.user?.edge_followed_by
        : json.data?.user?.edge_follow;

    if (!container) {
      throw new Error(ERRORS.INVALID_RESPONSE);
    }

    if (!total) {
      total = container.count;

      if (total >= 10000) {
        throw new Error(ERRORS.ACCOUNT_TOO_LARGE);
      }
    }

    const newUsers = container.edges.map(({ node }) => ({
      id: node.id,
      username: node.username,
      profile_pic_url: node.profile_pic_url
    }));

    users.push(...newUsers);
    fetched += newUsers.length;

    hasNext = container.page_info.has_next_page;
    after = container.page_info.end_cursor;

    if (total) {
      const localPercent = fetched / total;

      const weighted =
        progressStart +
        (progressEnd - progressStart) * localPercent;

      await sendProgress(weighted);
    }

    await sleep(randomBetween(400, 900));
  }

  return users;
}

/**
 * Main scan routine that identifies users who
 * do not follow the current account back.
 *
 * Workflow:
 *
 * 1) Resolve the username to an Instagram user ID
 * 2) Fetch the followers list
 * 3) Fetch the following list
 * 4) Compute the difference
 *
 * Returns a standardized success or error object
 * consumed by the background script.
 *
 * @param {string} username
 * @returns {Promise<{ok: boolean, data?: object, error?: object}>}
 */
async function findNonFollowers(username) {

  try {

    const searchRes = await fetch(
      `${urls.search}?query=${username}`
    );

    if (!searchRes.ok) {
      throw new Error(ERRORS.SEARCH_FAILED);
    }

    const searchJson = await searchRes.json();

    const matchedUser = searchJson?.users
      ?.map(u => u.user)
      ?.find(u => u.username === username);

    if (!matchedUser) {
      throw new Error(ERRORS.USER_NOT_FOUND);
    }

    const userId = matchedUser.pk;

    const followers = await fetchAllUsers({
      userId,
      type: "followers",
      progressStart: 0,
      progressEnd: 50
    });

    const followings = await fetchAllUsers({
      userId,
      type: "following",
      progressStart: 50,
      progressEnd: 100
    });

    const followerSet = new Set(
      followers.map(u => u.username)
    );

    const dontFollowMeBack =
      followings.filter(f => !followerSet.has(f.username));

    return {
      ok: true,
      data: { dontFollowMeBack }
    };

  } catch (error) {
    const code = error.message || ERRORS.UNKNOWN;
    cleanupExtensionUI()
    return {
      ok: false,
      error: {
        code,
        message: ERROR_MESSAGES[code] || ERROR_MESSAGES[ERRORS.UNKNOWN]
      }
    };
  }
}

/* ---------------------------------------------------------
   MESSAGE LISTENER
--------------------------------------------------------- */
/*
  This listener receives commands from the background script.

  The background script acts as the central controller for the
  extension and sends instructions to this content script
  depending on the job state.

  Supported actions:

  CANCEL_JOB
    → Stops any ongoing scan and removes injected UI.

  CHECK_LOGIN
    → Verifies whether the user is currently logged into Instagram.
      Also extracts usernames relevant to the current page.

  RUN_CHECK
    → Starts the follower/following scan and returns results.

  Communication Flow:

  popup → background → content_script
                       ↓
                   DOM scanning
                       ↓
                 result returned
                       ↓
                background updates job state
*/
browser.runtime.onMessage.addListener(async (request) => {

  console.log(request)

  // Reset cancellation flag for each new message
  isCancelled = false;

  /* ---------------------------------------------------------
     CANCEL JOB
     Stops scan and removes UI overlay
  --------------------------------------------------------- */
  if (request.action === "CANCEL_JOB") {

    isCancelled = true;

    // Remove any injected progress UI from the page
    cleanupExtensionUI()

    return { ok: true };
  }


  /* ---------------------------------------------------------
     CHECK LOGIN
     Determines whether the user is logged into Instagram
     and extracts relevant usernames from the page
  --------------------------------------------------------- */
  if (request.action === "CHECK_LOGIN") {

    // Small delay to ensure page DOM is fully rendered
    await sleep(500);

    // If Instagram redirected to login page, user is not logged in
    if (window.location.pathname.startsWith("/accounts/login")) {
      return { ok: true, data: { loggedIn: false } };
    }

    // Instagram renders a Home icon when user is authenticated
    const homeIcon = document.querySelector('svg[aria-label="Home"]');
    const loggedIn = !!homeIcon;

    // Username of the currently logged-in account
    const loggedInUsername =
      document.querySelector("nav a[href^='/']")?.getAttribute("href")
        ?.split("/")[1] || null;

    // Username of the profile currently being viewed
    const profileUsername =
      window.location.pathname.split("/").filter(Boolean)[0] || null;

    return {
      ok: true,
      data: {
        loggedIn,
        loggedInUsername,
        profileUsername
      }
    };
  }


  /* ---------------------------------------------------------
     RUN CHECK
     Starts the follower comparison scan
  --------------------------------------------------------- */
  if (request.action === "RUN_CHECK") {

    // Determine profile username from URL
    const username =
      window.location.pathname.split("/").filter(Boolean)[0];

    // Execute main scanning logic
    const result = await findNonFollowers(username);

    // Notify background script that the job finished
    await browser.runtime.sendMessage({
      action: "JOB_DONE",
      result
    });

    // If successful, show completion UI overlay
    if (result.ok) {
      injectExtensionUI({ status: "done" });
    }

    return result;
  }

  // Unknown message fallback
  return { ok: false, error: "Unknown action" };
});

/* ---------------------------------------------------------
   SPA NAVIGATION HANDLING
--------------------------------------------------------- */
/*
  Instagram is a Single Page Application (SPA).

  Navigation between profiles does NOT trigger a full
  page reload. Instead, the site updates the URL using
  the History API (pushState / popState).

  Because of this, extension UI injected into the DOM
  could remain visible after navigating to a new profile.

  The following logic listens for navigation events and
  triggers cleanupExtensionUI() so the injected overlay
  does not persist across pages.
*/

/*
  Monkey-patch history.pushState so we can detect
  internal SPA navigation events.
*/
(function(history){
  const pushState = history.pushState;

  history.pushState = function() {
    pushState.apply(history, arguments);

    // Dispatch custom event so we can react to navigation
    window.dispatchEvent(new Event("locationchange"));
  };

})(window.history);

/*
  popstate fires when navigating browser history
  (back/forward buttons).
*/
window.addEventListener("popstate", () => {
  window.dispatchEvent(new Event("locationchange"));
});

/*
  Clean up UI whenever navigation occurs
  or the page is about to unload.
*/
window.addEventListener("locationchange", cleanupExtensionUI);
window.addEventListener("beforeunload", cleanupExtensionUI);

/**
 * Injects or updates the floating extension UI.
 *
 * This overlay displays the scan progress or completion
 * message directly on the Instagram page so the user can
 * continue browsing while the scan runs in the background.
 *
 * If the container does not exist, it will be created and
 * appended to the document body.
 *
 * @param {Object} options
 * @param {"running"|"done"} options.status - Current scan state
 * @param {number} options.progress - Scan progress percentage
 */
function injectExtensionUI({
  status = "running",
  progress = 0
} = {}) {
    // Prevent UI injection if the scan was cancelled
  if (isCancelled) return;

  /*
    Create container element if it does not already exist.
    The container is reused to update progress UI.
  */
  if (!progressUIContainer || !document.body.contains(progressUIContainer)) {

    progressUIContainer = document.createElement("div");
    progressUIContainer.id = "my-extension-root";

    // High z-index ensures the overlay stays above Instagram UI
    progressUIContainer.style.cssText =
      "position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:2147483647; font-family:sans-serif;";

    document.body.appendChild(progressUIContainer);
  }

// DONE
/*
  Displayed after scan completes successfully.

  Provides a small confirmation panel informing the user
  that results can be viewed from the extension popup.
*/
if (status === "done") {
  progressUIContainer.innerHTML = `
    <div style="background:white;color:#0f172a;padding:16px;border-radius:12px;
                border:1px solid #e2e8f0;width:260px;position:relative;
                font-size:14px;line-height:1.4;">

      <button id="ext-ui-close"
        style="position:absolute;top:8px;right:10px;border:none;background:none;
               color:#94a3b8;font-size:16px;cursor:pointer;">
        ×
      </button>

      <div style="color:#16a34a;font-weight:600;">
        Scan complete ✅
      </div>

      <div style="color:#475569;margin-top:4px;">
        See the results in the extension from the toolbar.
      </div>

    </div>`;

  document
    .getElementById("ext-ui-close")
    ?.addEventListener("click", cleanupExtensionUI);

  return;
}

  // RUNNING
  /*
    Displays the live progress bar while the scan
    is actively running in the background.
  */
const rounded = Math.round(progress || 0);

progressUIContainer.innerHTML = `
  <div style="background:white;padding:16px;border-radius:12px;
              border:1px solid #e2e8f0;width:260px;color:#111827;">
    <div style="display:flex;justify-content:space-between;
                font-size:14px;font-weight:600;">
      <span>Scanning...</span>
      <span>${rounded}%</span>
    </div>

    <div style="background:#f1f5f9;height:8px;border-radius:99px;
                margin-top:8px;overflow:hidden;">
      <div style="height:100%;background:#2563eb;
                  width:${rounded}%;transition:width .3s;"></div>
    </div>
  </div>`;

}