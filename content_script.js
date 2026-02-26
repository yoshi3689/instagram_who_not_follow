// Put all the javascript code here, that you want to execute after page load.

/*
Follower fetching logic adapted from:
https://stackoverflow.com/questions/XXXXX

Author: USERNAME (Stack Overflow)
License: CC BY-SA 4.0
Modifications: Adjusted for Firefox WebExtension usage
*/

let urls = null;
let isCancelled = false;

(async () => {
  const src = chrome.runtime.getURL("./urls.js");
  urls = await import(src).then(res => res.default);
})();
console.log("content_script loaded")

async function sendProgress(percent) {
    const rounded = Math.round(percent);

  console.log("📊 Sending progress:", rounded + "%");

  await browser.runtime.sendMessage({
    action: "JOB_PROGRESS",
    progress: rounded
  });
}

async function fetchAllUsers({ userId, type, progressStart, progressEnd }) {

  console.log(`🚀 Starting fetch for ${type}...`);

  let users = [];
  let after = null;
  let hasNext = true;
  let total = null;
  let fetched = 0;

  while (hasNext) {

    console.log(`➡ Fetching ${type} page... after=${after}`);
    if (isCancelled) {
      await browser.runtime.sendMessage({
      action: "JOB_CANCELLED"
      });
      return; // stop execution
    }

    // Fetch followers or following
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

    const json = await res.json();

    const container =
      type === "followers"
        ? json.data?.user?.edge_followed_by
        : json.data?.user?.edge_follow;

    if (!container) {
      console.log(`❌ ${type} structure unexpected`);
      return [];
    }

    if (!total) {
      total = container.count;
      console.log(`📦 Total ${type}:`, total);
    }

    const newUsers = container.edges.map(({ node }) => ({
      id: node.id,
      username: node.username,
      profile_pic_url: node.profile_pic_url
    }));

    users.push(...newUsers);
    fetched += newUsers.length;

    console.log(`📥 ${type}: ${fetched}/${total}`);

    hasNext = container.page_info.has_next_page;
    after = container.page_info.end_cursor;

    if (total) {
      const localPercent = fetched / total;

      const weighted =
        progressStart +
        (progressEnd - progressStart) * localPercent;

      await browser.runtime.sendMessage({
        action: "JOB_PROGRESS",
        progress: Math.round(weighted)
      });

      console.log("📊 Progress:", Math.round(weighted) + "%");
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`✅ Finished fetching ${type}`);
  return users;
}

async function findNonFollowers(username) {
  try {
    console.log("🔎 Starting findNonFollowers for:", username);

    const searchRes = await fetch(
      `${urls.search}?query=${username}`
    );

    if (!searchRes.ok) {
      return { error: "Search request failed." };
    }

    const searchJson = await searchRes.json();

    if (!searchJson?.users?.length) {
      return { error: "User not found." };
    }

    const matchedUser = searchJson.users
      .map(u => u.user)
      .find(u => u.username === username);

    if (!matchedUser) {
      return { error: "User not found." };
    }

    const userId = matchedUser.pk;

    // Fetch followers
    const followers = await fetchAllUsers({
      userId,
      type: "followers",
      progressStart: 0,
      progressEnd: 50,
    });

    if (!Array.isArray(followers)) {
      console.warn("Followers is not array:", followers);
      return { error: "Failed to fetch followers." };
    }

    // Fetch followings
    const followings = await fetchAllUsers({
      userId,
      type: "following",
      progressStart: 50,
      progressEnd: 100,
    });

    if (!Array.isArray(followings)) {
      console.warn("Followings is not array:", followings);
      return { error: "Failed to fetch followings." };
    }

    const followerSet = new Set(
      followers.map(u => u.username)
    );

    const dontFollowMeBack =
      followings.filter(f => !followerSet.has(f.username));

    console.log("🎉 Completed");

    return { dontFollowMeBack };

  } catch (error) {

    if (error.name === "AbortError") {
      console.log("🛑 Aborted safely.");
      throw error; // let outer handler deal with it
    }

    console.error("findNonFollowers error:", error);
    return { error: "Unexpected error occurred." };
  }
}

browser.runtime.onMessage.addListener(async (request) => {
      if (request.action === "CANCEL_JOB") {
      console.log("🛑 Cancelling job...");
      isCancelled = true;
      return;
    }
  try {
      console.log("📩 Message received in content script:", request);
      console.log("🌍 Current URL:", window.location.href);
    console.log("📂 Pathname:", window.location.pathname);
    if (request.action === "CHECK_LOGIN") {

  console.log("🔍 Running CHECK_LOGIN...");

  await new Promise(resolve => setTimeout(resolve, 700));

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
      ) {
        continue;
      }

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

  console.log("🔐 Logged in:", loggedIn);
  console.log("👤 Logged in username:", loggedInUsername);

  return {
    loggedIn,
    loggedInUsername,
    profileUsername
  };
    }

  // ▶ RUN CHECK
    if (request.action === "RUN_CHECK") {
      isCancelled = false;
    console.log("▶ Running RUN_CHECK...");

    if (window.location.pathname.startsWith("/accounts/login")) {
      console.log("❌ Not logged in (login page)");
      return { error: "You are not logged into Instagram." };
    }

    const username =
      window.location.pathname.split("/").filter(Boolean)[0];

    console.log("🔎 Running findNonFollowers for:", username);

    const result = await findNonFollowers(username);

    await browser.runtime.sendMessage({
      action: "JOB_DONE",
      result
    });

    console.log("✅ Result:", result);

    return result;
  }
  } catch (error) {
    throw new Error(error);
  }

});