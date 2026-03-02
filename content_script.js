// Put all the javascript code here, that you want to execute after page load.

let urls = null;
let isCancelled = false;
let currentAbortController = null;

(async () => {
  const src = chrome.runtime.getURL("./urls.js");
  urls = await import(src).then(res => res.default);
})();

/* ------------------------ */
/* PROGRESS */
/* ------------------------ */

async function sendProgress(percent) {
  const rounded = Math.round(percent);

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

    await new Promise(resolve => setTimeout(resolve, 800));
  }

  return users;
}

/* ------------------------ */
/* FIND NON FOLLOWERS */
/* ------------------------ */

async function findNonFollowers(username) {

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

      await browser.runtime.sendMessage({
        action: "JOB_DONE",
        result
      });

      return result;

    } catch (error) {

        await browser.runtime.sendMessage({
          action: "JOB_DONE",
          result: {
            success: false,
            dontFollowMeBack: [],
            error: error.message || "Unexpected error"
          }
        });
    }
  }
});