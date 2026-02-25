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

  if (status.status === "idle") {
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

  }, 500);
}

/* ------------------------ */
/* UI RENDER FUNCTIONS */
/* ------------------------ */

function renderMessage(msg) {
  document.getElementById("content").innerHTML = `<p>${msg}%</p>`;
}

function renderRunButton() {
  const content = document.getElementById("content");
  content.innerHTML =
    `<button id="runCheck">Find Non-Followers</button>`;

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
    <p><strong>Non-followers (${users.length})</strong></p>
    <div id="userList"></div>
    <button id="runAgain">Run Again</button>
  `;

  const userList = document.getElementById("userList");

  users.forEach(user => {
    const row = document.createElement("div");
    row.className = "user-row";
    row.innerHTML = `
      <a href="https://www.instagram.com/${user.username}/" target="_blank">
        ${user.username}
      </a>
      <button class="unfollow-btn" data-id="${user.id}">
        Unfollow
      </button>
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