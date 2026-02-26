document.addEventListener("DOMContentLoaded", init);

let pollingInterval = null;

async function init() {
  console.log("POPUP LOADED");

  const contentDiv = document.getElementById("content");

  try {
    const tab = await getActiveInstagramProfileTab();
    if (!tab) {
      renderMessage("This extension only works on Instagram profile pages.");
      return;
    }

    const loginCheck = await browser.tabs.sendMessage(tab.id, {
      action: "CHECK_LOGIN"
    });

    if (!loginCheck.loggedIn) {
      renderMessage("Please log in to Instagram first.");
      return;
    }

    if (loginCheck.loggedInUsername !== loginCheck.profileUsername) {
      renderDifferentProfile(loginCheck);
      return;
    }

    await handleStatus();

  } catch (err) {
    console.error("Popup error:", err);
    renderMessage("Something went wrong.");
  }
}

/* ------------------------ */
/* STATUS HANDLING */
/* ------------------------ */

async function handleStatus() {
  const status = await browser.runtime.sendMessage({
    action: "GET_STATUS"
  });

  console.log("Status:", status);

  if (status.status === "idle" || status.status === "cancelled") {
    renderRunButton();
  }

if (status.status === "running") {
  renderMessage(status.progress || 0);
  pollUntilDone();  // resume if popup reopened
}

  if (status.status === "done") {
    console.log(status.status)
    const { finalResult } = await browser.storage.local.get("finalResult");
    renderResults(finalResult.dontFollowMeBack);
  }

  if (status.status === "error") {
    renderError(status.error);
  }
}

/* ------------------------ */
/* ACTIONS */
/* ------------------------ */

async function startCheck() {
  console.log("starting follower count")
  const response = await browser.runtime.sendMessage({
    action: "START_CHECK"
  });

  if (response.status === "started" || response.status === "already_running") {
    renderMessage(0);
    pollUntilDone();
  }
}

function pollUntilDone() {
  if (pollingInterval) return; // prevent duplicate intervals

  pollingInterval = setInterval(async () => {
    console.log("polling");

    const status = await browser.runtime.sendMessage({
      action: "GET_STATUS"
    });

    if (status.status === "running") {
      renderMessage(status.progress || 0);
    }

    if (status.status === "done") {
      clearInterval(pollingInterval);
      pollingInterval = null;
      renderResults(status.result.dontFollowMeBack);
    }

    if (status.status === "error") {
      clearInterval(pollingInterval);
      pollingInterval = null;
      renderError(status.error);
    }

    if (status.status === "cancelled") {
      clearInterval(pollingInterval);
      pollingInterval = null;
      renderRunButton(status.status);
    }

  }, 500);
}

/* ------------------------ */
/* UI RENDER FUNCTIONS */
/* ------------------------ */

function renderMessage(progress = 0) {
  const content = document.getElementById("content");

  content.innerHTML = `
    <div class="flex flex-col gap-6">

      <div class="bg-white rounded-xl p-6 shadow-sm text-center">

        <h2 class="text-slate-900 font-semibold text-lg mb-2">
          Analyzing...
        </h2>

        <div class="space-y-2 mt-4">
          <div class="flex justify-between text-sm">
            <span class="text-slate-600">Progress</span>
            <span class="font-semibold">${progress}%</span>
          </div>

          <div class="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
            <div 
              class="bg-blue-600 h-full transition-all duration-300"
              style="width: ${progress}%">
            </div>
          </div>
        </div>

      </div>

      <button
        id="cancelBtn"
        class="w-full bg-white hover:bg-slate-50 text-slate-700 font-medium py-3 px-6 rounded-xl border border-slate-200"
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


function renderRunButton(statusText = "") {
  const content = document.getElementById("content");

  content.innerHTML = `
    <div class="flex flex-col gap-6">

      <div class="bg-white rounded-xl p-6 shadow-sm text-center">
        <h2 class="text-slate-900 font-semibold text-lg mb-2">
          Ready to Audit
        </h2>
        <p class="text-slate-600 text-sm">
          Analyze your Instagram account to find users who don't follow you back
        </p>

        ${statusText ? `
          <div class="mt-3 text-xs text-slate-500">
            ${statusText}
          </div>
        ` : ""}
      </div>

      <button
        id="runCheck"
        class="w-full bg-slate-800 hover:bg-slate-900 text-white font-medium py-4 px-6 rounded-xl transition-colors shadow-lg"
      >
        Start Audit
      </button>

    </div>
  `;

  document.getElementById("runCheck")
    .addEventListener("click", startCheck);
}

function renderDifferentProfile(loginCheck) {
  const content = document.getElementById("content");
  content.innerHTML = `
    <p>You are logged in as <strong>${loginCheck.loggedInUsername}</strong>.</p>
    <p>Viewing profile: <strong>${loginCheck.profileUsername}</strong></p>
    <button id="runCheck">Find Non-Followers</button>
  `;

  document.getElementById("runCheck")
    .addEventListener("click", startCheck);
}

function renderResults(users) {
  const content = document.getElementById("content");

  content.innerHTML = `
    <div class="flex flex-col gap-4">

      <div class="bg-white rounded-xl p-5 shadow-sm">
        <div class="flex justify-between items-center mb-2">
          <h2 class="text-slate-700 font-medium text-sm">
            Snapshot
          </h2>
          <div class="bg-slate-900 text-white font-bold px-4 py-2 rounded-lg text-lg">
            ${users.length}
          </div>
        </div>
        <p class="text-slate-600 text-xs">
          Total non-followers detected
        </p>
      </div>

      <button
        id="runAgain"
        class="w-full bg-slate-800 hover:bg-slate-900 text-white font-medium py-3 px-6 rounded-xl"
      >
        Run New Scan
      </button>

      <div class="bg-white rounded-xl shadow-sm overflow-hidden">
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
      "flex justify-between items-center px-5 py-3 border-b last:border-b-0";

    row.innerHTML = `
      <a 
        href="https://www.instagram.com/${user.username}/" 
        target="_blank"
        class="text-slate-900 font-medium text-sm hover:text-blue-600"
      >
        @${user.username}
      </a>
    `;

    userList.appendChild(row);
  });

  document.getElementById("runAgain")
    .addEventListener("click", startCheck);
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