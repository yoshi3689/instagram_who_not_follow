/* ---------------------------------------------------------
   GLOBAL STATE
--------------------------------------------------------- */

let urls = null;
let isCancelled = false;
let progressUIContainer = null;

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
--------------------------------------------------------- */

(async () => {
  const src = browser.runtime.getURL("./urls.js");
  urls = await import(src).then(res => res.default);
})();

/* ---------------------------------------------------------
   UTILITIES
--------------------------------------------------------- */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function cleanupExtensionUI() {
    const root = document.getElementById("my-extension-root");
  if (root) {
    root.remove();
  }
}

/* ---------------------------------------------------------
   UI INJECTION
--------------------------------------------------------- */

async function sendProgress(percent) {
  const rounded = Math.round(percent);

  injectExtensionUI({ progress: rounded });

  await browser.runtime.sendMessage({
    action: "JOB_PROGRESS",
    progress: rounded
  });
}

/* ---------------------------------------------------------
   FETCH USERS
--------------------------------------------------------- */

async function fetchAllUsers({ userId, type, progressStart, progressEnd }) {

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

/* ---------------------------------------------------------
   MAIN SCAN LOGIC
--------------------------------------------------------- */

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

browser.runtime.onMessage.addListener(async (request) => {
  console.log(request)
  isCancelled = false;
  if (request.action === "CANCEL_JOB") {
    isCancelled = true;
    cleanupExtensionUI()
    return { ok: true };
  }

  if (request.action === "CHECK_LOGIN") {

    await sleep(500);

    if (window.location.pathname.startsWith("/accounts/login")) {
      return { ok: true, data: { loggedIn: false } };
    }

    const homeIcon = document.querySelector('svg[aria-label="Home"]');
    const loggedIn = !!homeIcon;

    const loggedInUsername =
      document.querySelector("nav a[href^='/']")?.getAttribute("href")
        ?.split("/")[1] || null;

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

  if (request.action === "RUN_CHECK") {

    const username =
      window.location.pathname.split("/").filter(Boolean)[0];

    const result = await findNonFollowers(username);

    await browser.runtime.sendMessage({
      action: "JOB_DONE",
      result
    });

    if (result.ok) {
      injectExtensionUI({ status: "done" });
    } 

    return result;
  }

  return { ok: false, error: "Unknown action" };
});

/* ---------------------------------------------------------
   SPA NAVIGATION HANDLING
--------------------------------------------------------- */

(function(history){
  const pushState = history.pushState;
  history.pushState = function() {
    pushState.apply(history, arguments);
    window.dispatchEvent(new Event("locationchange"));
  };
})(window.history);

window.addEventListener("popstate", () => {
  window.dispatchEvent(new Event("locationchange"));
});

window.addEventListener("locationchange", cleanupExtensionUI);
window.addEventListener("beforeunload", cleanupExtensionUI);

function injectExtensionUI({
  status = "running",
  progress = 0
} = {}) {
  if (isCancelled) return;
  if (!progressUIContainer || !document.body.contains(progressUIContainer)) {
    progressUIContainer = document.createElement("div");
    progressUIContainer.id = "my-extension-root";
    progressUIContainer.style.cssText =
      "position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:2147483647; font-family:sans-serif;";
    document.body.appendChild(progressUIContainer);
  }

// DONE
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