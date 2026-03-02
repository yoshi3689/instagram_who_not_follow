document.addEventListener("DOMContentLoaded", init);
window.addEventListener("unload", cleanup);

let pollingInterval = null;

async function init() {
  console.log("POPUP LOADED");

  try {
    const tab = await getActiveInstagramProfileTab();
    if (!tab) {
      renderMessageBox("This extension only works on Instagram profile pages.");
      return;
    }

    const loginCheck = await browser.tabs.sendMessage(tab.id, {
      action: "CHECK_LOGIN"
    });

    if (!loginCheck.loggedIn) {
      renderMessageBox("Please log in to Instagram first.");
      return;
    }

    if (loginCheck.loggedInUsername !== loginCheck.profileUsername) {
      renderDifferentProfile(loginCheck);
      return;
    }

    await handleStatus();

  } catch (err) {
    console.error("Popup error:", err);
    renderMessageBox("Something went wrong.");
  }
}

/* ------------------------ */
/* STATUS HANDLING */
/* ------------------------ */

async function handleStatus() {
  const status = await browser.runtime.sendMessage({
    action: "GET_STATUS"
  });

  if (!status) return;

  if (status.status === "idle" || status.status === "cancelled") {
    renderRunButton();
  }

  if (status.status === "running") {
    renderProgress(status.progress || 0);
    pollUntilDone();
  }

  if (status.status === "done") {
    renderResults(status.result);
  }

  if (status.status === "error") {
    renderError(status.error);
  }
}

/* ------------------------ */
/* ACTIONS */
/* ------------------------ */

async function startCheck() {
  const response = await browser.runtime.sendMessage({
    action: "START_CHECK"
  });

  if (response.status === "started") {
    renderProgress(0);
    pollUntilDone();
  }

  if (response.status === "already_running") {
    handleStatus(); // resume correctly
  }
}

function pollUntilDone() {
  if (pollingInterval) return;

  pollingInterval = setInterval(async () => {

    const status = await browser.runtime.sendMessage({
      action: "GET_STATUS"
    });
    console.log("get stuatus")

    if (!status) return;

    if (status.status === "running") {
      renderProgress(status.progress || 0);
    }

    if (status.status === "done") {
      cleanup();
      renderResults(status.result);
      if (!status.result) return;
    }

    if (status.status === "error") {
      cleanup();
      renderError(status.error);
    }

    if (status.status === "cancelled") {
      cleanup();
      renderCancelled();
    }

  }, 500);
}

function cleanup() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

/* ------------------------ */
/* UI RENDER FUNCTIONS */
/* ------------------------ */

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
          style="width: ${progress}%">
        </div>
      </div>
    </div>
  </div>

  <button
    id="cancelBtn"
    class="w-full bg-white hover:bg-slate-50 text-red-500 font-medium py-3 px-6 rounded-xl border border-slate-200"
  >
    Cancel Scan
  </button>
</div>`;

  document.getElementById("cancelBtn")
    .addEventListener("click", async () => {
      await browser.runtime.sendMessage({ action: "CANCEL_JOB" });
      cleanup();
      renderCancelled();
    });
}

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

function renderCancelled() {
  const content = document.getElementById("content");

  content.innerHTML = `
      <div class="flex flex-col items-center justify-center gap-6 py-8 px-4 max-w-sm w-full bg-white rounded-2xl shadow-sm border border-slate-100">
        
        <div class="inline-flex items-center justify-center w-16 h-16 bg-amber-100 rounded-full">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-amber-600">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
        </div>

        <div class="text-center">
            <h2 class="text-slate-900 font-semibold text-lg mb-2">Scan Cancelled</h2>
            <p class="text-slate-600 text-sm">
                Scan has been stopped. You can start a new one anytime.
            </p>
        </div>

        <button
            id="restartBtn"
            class="w-full bg-slate-800 hover:bg-slate-900 text-white font-medium py-3 px-6 rounded-xl transition-colors shadow-lg shadow-slate-800/20"
        >
            Start New Scan
        </button>
    </div>
  `;

  document.getElementById("restartBtn")
    .addEventListener("click", startCheck);
}

function renderResults(result) {

  const content = document.getElementById("content");

  // 🛑 Safety guard
  if (!result || typeof result !== "object") {
    content.innerHTML = `
      <div class="text-center p-6 text-red-600">
        Unexpected error occurred.
      </div>
    `;
    return;
  }

  // ❌ Error state
  if (!result.success) {
    console.log()
    content.innerHTML = `
      <div class="flex flex-col gap-4">
        <div class="bg-white rounded-xl p-6 shadow-sm text-center">
          <h2 class="text-red-500 font-semibold text-lg mb-2">
            Scan Failed
          </h2>
          <p class="text-slate-600 text-sm">
            ${result.error || "Something went wrong."}
          </p>
        </div>

        <button
          id="runAgain"
          class="w-full bg-slate-800 hover:bg-slate-900 text-white font-medium py-3 px-6 rounded-xl"
        >
          Try Again
        </button>
      </div>
    `;

    document.getElementById("runAgain")
      ?.addEventListener("click", startCheck);

    return;
  }

  // ✅ Success state
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
        ? "Everyone follows you back 🎉" 
        : (count === 1 ? '1 Person is' : 'People are') + " leaving you hanging"}
    </h2>
    <p class="text-slate-600 text-sm">
      ${count === 0 
        ? "Your follower list is perfectly in sync." 
        : "These users don't follow you back"}
    </p>
  </div>

  <button
    id="runAgain"
    class="w-full bg-slate-800 hover:bg-slate-900 text-white font-medium py-3 px-6 rounded-xl transition-colors shadow-lg shadow-slate-800/20"
  >
    Run New Scan
  </button>
  
        <div class="w-full bg-white rounded-xl shadow-sm overflow-hidden">
        <div class="px-5 py-3 bg-slate-50 border-b border-slate-200">
          <h3 class="text-slate-700 font-medium text-sm">
            Non-Followers List
          </h3>
        </div>
        <div id="userList" class="max-h-[220px] overflow-y-auto"></div>
      </div> 
</div>`;

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

        <a
          href="https://www.instagram.com/${user.username}/"
          target="_blank"
          class="text-slate-900 font-medium text-sm hover:text-blue-600 transition-colors truncate"
        >
          @${user.username}
        </a>
      </div>

      <a
        href="https://www.instagram.com/${user.username}/"
        target="_blank"
        class="text-slate-600 hover:text-slate-900 text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors flex-shrink-0 ml-2"
      >
        View
      </a>
    `;

    userList.appendChild(row);
  });
  document.getElementById("runAgain")
    ?.addEventListener("click", startCheck);
}

function renderError(error) {
  const content = document.getElementById("content");
  content.innerHTML =
    `<p>Error: ${error}</p>
     <button id="retry">Retry</button>`;

  document.getElementById("retry")
    .addEventListener("click", startCheck);
}

/* ------------------------ */
/* HELPERS */
/* ------------------------ */

async function getActiveInstagramProfileTab() {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  const tab = tabs[0];
  if (!tab || !tab.url) return null;

  const url = new URL(tab.url);

  if (url.hostname !== "www.instagram.com") return null;

  const pathParts = url.pathname.split("/").filter(Boolean);

  if (pathParts.length !== 1) return null;

  return tab;
}

function renderMessageBox(message) {
  const content = document.getElementById("content");
  content.innerHTML = `<p>${message}</p>`;
}