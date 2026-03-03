// Put all the javascript code here, that you want to execute after page load.

let urls = null;
let isCancelled = false;
let currentAbortController = null;
let progressUIContainer = null;

function cleanupExtensionUI() {
  if (progressUIContainer && progressUIContainer.parentNode) {
    progressUIContainer.remove();
    progressUIContainer = null;
  }

  isCancelled = true;

  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
    // 🔥 Notify background to reset its state
  chrome.runtime.sendMessage({
    action: "RESET"
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

(async () => {
  const src = chrome.runtime.getURL("./urls.js");
  urls = await import(src).then(res => res.default);
})();


/* ---------------------------------------------------------
   🛠️ UI INJECTION HELPER
--------------------------------------------------------- */

function injectExtensionUI({ progress = null, isDone = false, error = null }) {
  if (!progressUIContainer || !document.body.contains(progressUIContainer)) {
    progressUIContainer = document.createElement('div');
    progressUIContainer.id = "my-extension-root";
    progressUIContainer.style.cssText =
  "position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:2147483647; font-family:sans-serif;";
    document.body.appendChild(progressUIContainer);
  }

  let styleTag = document.getElementById('ext-inline-styles');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'ext-inline-styles';
    styleTag.textContent = `
      .ext-card { 
        background: white; 
        border: 1px solid #e2e8f0; 
        border-radius: 12px; 
        padding: 16px; 
        width: 260px; 
        box-shadow: 0 4px 6px rgba(0,0,0,0.1); 
      }
      .ext-bar-bg { 
        width: 100%; 
        background: #f1f5f9; 
        border-radius: 99px; 
        height: 8px; 
        overflow: hidden; 
        margin-top: 8px; 
      }
      .ext-bar-fill { 
        height: 100%; 
        background: linear-gradient(to right, #3b82f6, #2563eb); 
        transition: width 0.3s; 
      }
      .ext-text { 
        font-size: 14px; 
        color: #475569; 
        font-weight: 600; 
      }
      .ext-error {
        color: #dc2626;
        font-size: 14px;
        font-weight: 600;
      }
      .ext-success {
        color: #16a34a;
        font-size: 14px;
        font-weight: 600;
      }
    `;
    document.head.appendChild(styleTag);
  }

  // ❌ ERROR STATE
  if (error) {
    progressUIContainer.innerHTML = `
      <div class="ext-card">
        <div class="ext-error">
          ⚠️ ${error}
        </div>
      </div>
    `;
    return;
  }

  // 🎉 DONE STATE
if (isDone) {
  progressUIContainer.innerHTML = `
    <div class="ext-card">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div class="ext-success">
          ✅ Scan complete!
        </div>
        <button id="ext-close-btn" style="
          background:none;
          border:none;
          font-size:16px;
          cursor:pointer;
          color:#64748b;
        ">✕</button>
      </div>

      <div class="ext-text" style="margin-top:8px;">
        Click the extension icon in your browser toolbar to view the results.
      </div>
    </div>
  `;

  // Add click handler AFTER rendering
  const closeBtn = document.getElementById("ext-close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      
    });
  }

  return;
}

  // 🔄 PROGRESS STATE
  const rounded = Math.round(progress || 0);

  progressUIContainer.innerHTML = `
    <div class="ext-card">
      <div style="display:flex; justify-content:space-between">
        <span class="ext-text">Scanning...</span>
        <span class="ext-text">${rounded}%</span>
      </div>
      <div class="ext-bar-bg">
        <div class="ext-bar-fill" style="width: ${rounded}%"></div>
      </div>
    </div>
  `;
}

async function sendProgress(percent) {
  const rounded = Math.round(percent);
  injectExtensionUI({ progress: rounded })
  await browser.runtime.sendMessage({
    action: "JOB_PROGRESS",
    progress: rounded
  });
}

/* ------------------------ */
/* FETCH ALL USERS */
/* ------------------------ */

async function fetchAllUsers({ userId, type, progressStart, progressEnd }) {

  let users = [];
  let after = null;
  let hasNext = true;
  let total = null;
  let fetched = 0;

while (hasNext) {

  if (isCancelled) {
    throw new Error("JOB_CANCELLED");
  }

  // 🧠 Small natural delay before request
  await sleep(randomBetween(200, 600));

  currentAbortController = new AbortController();

  const res = await fetch(
    `${type === "followers" ? urls.followers : urls.following}&variables=` +
      encodeURIComponent(JSON.stringify({
        id: userId,
        include_reel: true,
        fetch_mutual: true,
        first: 50,
        after
      })),
    { signal: currentAbortController.signal }
  );

  const json = await res.json();

  const container =
    type === "followers"
      ? json.data?.user?.edge_followed_by
      : json.data?.user?.edge_follow;

  if (!container) {
    throw new Error("Invalid response structure");
  }

  if (!total) {
    total = container.count;

    // 🚫 Abort if too large
    if (total >= 10000) {
      throw new Error("ACCOUNT_TOO_LARGE");
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

  // ⏳ Normal random delay after processing
  await sleep(randomBetween(400, 900));

  // 💤 Occasional longer pause every ~400 users
  if (fetched > 0 && fetched % 400 === 0) {
    await sleep(randomBetween(2000, 4000));
  }
}

  return users;
}

/* ------------------------ */
/* FIND NON FOLLOWERS */
/* ------------------------ */

async function findNonFollowers(username) {
  if (!progressUIContainer) {
    progressUIContainer = document.createElement('div');
    progressUIContainer.id = "my-extension-root";
    progressUIContainer.style.cssText =
  "position:fixed; top:20px; left:50%; transform:translateX(-50%); z-index:2147483647; font-family:sans-serif;";
    document.body.insertBefore(progressUIContainer, document.body.firstChild);
  }
  
  try {

    currentAbortController = new AbortController();

    const searchRes = await fetch(
      `${urls.search}?query=${username}`,
      { signal: currentAbortController.signal }
    );

    if (!searchRes.ok) {
      throw new Error("Search request failed");
    }

    const searchJson = await searchRes.json();

    if (!searchJson?.users?.length) {
      throw new Error("User not found");
    }

    const matchedUser = searchJson.users
      .map(u => u.user)
      .find(u => u.username === username);

    if (!matchedUser) {
      throw new Error("User not found");
    }

    const userId = matchedUser.pk;

    const followers = await fetchAllUsers({
      userId,
      type: "followers",
      progressStart: 0,
      progressEnd: 50,
    });

    const followings = await fetchAllUsers({
      userId,
      type: "following",
      progressStart: 50,
      progressEnd: 100,
    });

    const followerSet = new Set(
      followers.map(u => u.username)
    );

    const dontFollowMeBack =
      followings.filter(f => !followerSet.has(f.username));

    return {
      success: true,
      dontFollowMeBack,
      error: null
    };

  } catch (error) {

    if (error.message === "JOB_CANCELLED") {
      return {
        success: false,
        dontFollowMeBack: [],
        error: "Job cancelled"
      };
    }

    if (error.name === "AbortError") {
      return {
        success: false,
        dontFollowMeBack: [],
        error: "Network request aborted"
      };
    }

    if (error.message === "ACCOUNT_TOO_LARGE") {
      return {
        success: false,
        dontFollowMeBack: [],
        error: "Account too large (10,000+). Scan aborted."
      };
    }

    return {
      success: false,
      dontFollowMeBack: [],
      error: error.message || "Unexpected error"
    };
  }
}

/* ------------------------ */
/* MESSAGE LISTENER */
/* ------------------------ */

browser.runtime.onMessage.addListener(async (request) => {

  if (request.action === "CANCEL_JOB") {
    isCancelled = true;

    if (currentAbortController) {
      currentAbortController.abort();
    }

    return;
  }

  if (request.action === "CHECK_LOGIN") {

    await new Promise(resolve => setTimeout(resolve, 500));

    if (window.location.pathname.startsWith("/accounts/login")) {
      return { loggedIn: false };
    }

    const homeIcon = document.querySelector('svg[aria-label="Home"]');
    const loggedIn = !!homeIcon;

    function getLoggedInUsername() {
      const links = document.querySelectorAll("a[href^='/']");

      for (const link of links) {
        const href = link.getAttribute("href");
        if (!href) continue;

        if (
          href.startsWith("/explore") ||
          href.startsWith("/reels") ||
          href.startsWith("/direct") ||
          href.startsWith("/accounts")
        ) continue;

        const match = href.match(/^\/([^\/]+)\//);
        if (match && match[1].length > 2) {
          return match[1];
        }
      }

      return null;
    }

    const loggedInUsername = getLoggedInUsername();
    const profileUsername =
      window.location.pathname.split("/").filter(Boolean)[0] || null;

    return {
      loggedIn,
      loggedInUsername,
      profileUsername
    };
  }

  if (request.action === "RUN_CHECK") {

    isCancelled = false;

    try {
      const username =
        window.location.pathname.split("/").filter(Boolean)[0];

      const result = await findNonFollowers(username);

      if (isCancelled) return;

      // Send result to background
      await browser.runtime.sendMessage({
        action: "JOB_DONE",
        result
      });

      // ✅ Handle UI AFTER result exists
      if (result.success) {
        injectExtensionUI({ isDone: true });
      } else {
        injectExtensionUI({ error: result.error });
      }

      return result;

    } catch (error) {

      const errorResult = {
        success: false,
        dontFollowMeBack: [],
        error: error.message || "Unexpected error"
      };

      await browser.runtime.sendMessage({
        action: "JOB_DONE",
        result: errorResult
      });

      injectExtensionUI({ error: errorResult.error });
    }
  }
});

// Detect Instagram SPA navigation
(function(history){
  const pushState = history.pushState;
  history.pushState = function() {
    pushState.apply(history, arguments);
    window.dispatchEvent(new Event('locationchange'));
  };
})(window.history);

window.addEventListener('popstate', () => {
  window.dispatchEvent(new Event('locationchange'));
});

window.addEventListener('locationchange', () => {
  console.log("Detected navigation → cleaning up");
  cleanupExtensionUI();
});

window.addEventListener("beforeunload", () => {
  cleanupExtensionUI();
});