// Put all the javascript code here, that you want to execute after page load.

/*
Follower fetching logic adapted from:
https://stackoverflow.com/questions/XXXXX

Author: USERNAME (Stack Overflow)
License: CC BY-SA 4.0
Modifications: Adjusted for Firefox WebExtension usage
*/

let urls = null;
(async () => {
  const src = chrome.runtime.getURL("./urls.js");
  urls = await import(src);
})();
console.log("content_script loaded")

// async function findNonFollowers(username) {
//   let followers = [];
//   let followings = [];
//   let dontFollowMeBack = [];
//   let iDontFollowBack = [];

//   try {
//     console.log("=== STARTING PROCESS ===");
//     console.log("Username:", username);

//     console.log("Fetching user search...");

//     const userQueryRes = await fetch(
//       `https://www.instagram.com/web/search/topsearch/?query=${username}`
//     );

//     console.log("Search response status:", userQueryRes.status);

//     const userQueryJson = await userQueryRes.json();
//     console.log("Search JSON:", userQueryJson);

//     if (!userQueryJson.users || userQueryJson.users.length === 0) {
//       console.log("❌ No users found in search response.");
//       return { error: "User not found in search response." };
//     }

//     const matchedUser = userQueryJson.users
//       .map(u => u.user)
//       .find(u => u.username === username);

//     if (!matchedUser) {
//       console.log("❌ Exact username match not found.");
//       return { error: "Exact username not found." };
//     }

//     const userId = matchedUser.pk;
//     console.log("Resolved userId:", userId);

//     let after = null;
//     let has_next = true;

//     console.log("=== FETCHING FOLLOWERS ===");

//     while (has_next) {
//       console.log("Followers page cursor:", after);

//       const res = await fetch(
//         `https://www.instagram.com/graphql/query/?query_hash=c76146de99bb02f6415203be841dd25a&variables=` +
//         encodeURIComponent(JSON.stringify({
//           id: userId,
//           include_reel: true,
//           fetch_mutual: true,
//           first: 50,
//           after: after,
//         }))
//       );

//       console.log("Followers fetch status:", res.status);

//       const json = await res.json();
//       console.log("Followers JSON page:", json);

//       if (!json.data?.user?.edge_followed_by) {
//         console.log("❌ Followers response structure unexpected.");
//         return { error: "Followers API structure changed or blocked." };
//       }

//       has_next = json.data.user.edge_followed_by.page_info.has_next_page;
//       after = json.data.user.edge_followed_by.page_info.end_cursor;

//       followers = followers.concat(
//         json.data.user.edge_followed_by.edges.map(({ node }) => ({
//           id: node.id,
//           username: node.username
//         }))
//       );

//       console.log("Followers collected so far:", followers.length);
//     }

//     console.log("=== FETCHING FOLLOWINGS ===");

//     after = null;
//     has_next = true;

//     while (has_next) {
//       console.log("Followings page cursor:", after);

//       const res = await fetch(
//         `https://www.instagram.com/graphql/query/?query_hash=d04b0a864b4b54837c0d870b0e77e076&variables=` +
//         encodeURIComponent(JSON.stringify({
//           id: userId,
//           include_reel: true,
//           fetch_mutual: true,
//           first: 50,
//           after: after,
//         }))
//       );

//       console.log("Followings fetch status:", res.status);

//       const json = await res.json();
//       console.log("Followings JSON page:", json);

//       if (!json.data?.user?.edge_follow) {
//         console.log("❌ Followings response structure unexpected.");
//         return { error: "Followings API structure changed or blocked." };
//       }

//       has_next = json.data.user.edge_follow.page_info.has_next_page;
//       after = json.data.user.edge_follow.page_info.end_cursor;

//       followings = followings.concat(
//         json.data.user.edge_follow.edges.map(({ node }) => ({
//           id: node.id,
//           username: node.username,
//           profile_pic_url: node.profile_pic_url
//         }))
//       );

//       console.log("Followings collected so far:", followings.length);
//     }

//     console.log("=== CALCULATING DIFFERENCES ===");

//     dontFollowMeBack = followings.filter(f =>
//       !followers.some(fl => fl.username === f.username)
//     );

//     iDontFollowBack = followers.filter(f =>
//       !followings.some(fl => fl.username === f.username)
//     );

//     console.log("Done!");
//     console.log("Followers:", followers);
//     console.log("Followings:", followings);
//     console.log("DontFollowMeBack:", dontFollowMeBack);
//     console.log("IDontFollowBack:", iDontFollowBack);

//     return {
//       dontFollowMeBack,
//     };

//   } catch (err) {
//     console.error("🔥 ERROR CAUGHT:", err);
//     return { error: err.toString() };
//   }
// }

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

  console.log("🔎 Starting findNonFollowers for:", username);

  // Resolve userId (same as your original code)
  const searchRes = await fetch(
    `${urls.search}?query=${username}`
  );

  const searchJson = await searchRes.json();

  const matchedUser = searchJson.users
    .map(u => u.user)
    .find(u => u.username === username);

  if (!matchedUser) {
    return { error: "User not found." };
  }

  const userId = matchedUser.pk;

  // 0–50%
  const followers = await fetchAllUsers({
    userId,
    type: "followers",
    progressStart: 0,
    progressEnd: 50
  });

  // 50–100%
  const followings = await fetchAllUsers({
    userId,
    type: "following",
    progressStart: 50,
    progressEnd: 100
  });

  const followerSet = new Set(followers.map(u => u.username));

  const dontFollowMeBack =
    followings.filter(f => !followerSet.has(f.username));

  console.log("🎉 Completed");

  return { dontFollowMeBack };
}

browser.runtime.onMessage.addListener(async (request) => {

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