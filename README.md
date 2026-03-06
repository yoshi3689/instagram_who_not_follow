# InstagramWhoFollows

A lightweight browser extension that analyzes an Instagram account and identifies users who **do not follow you back**.

The extension runs directly in the browser and performs all computations locally without storing or transmitting personal data.

---

# Features

* Find accounts that **do not follow you back**
* Scan runs **directly from your Instagram profile**
* **Progress tracking** while scanning
* **Cancelable scan** if you want to stop early
* Results displayed in a **clean popup UI**
* All processing happens **locally in the browser**

---

# How It Works

1. Open your Instagram profile page.
2. Click the extension icon in the browser toolbar.
3. Press **Start Scan**.
4. The extension retrieves your **followers** and **following** lists.
5. It compares both lists and displays users who **do not follow you back**.

During the scan:

* Progress is shown in the popup
* A floating progress indicator appears on the Instagram page
* The scan can be cancelled at any time

---

# Permissions

The extension requests the following permissions:

### activeTab

Allows the extension popup to communicate with the **currently active Instagram tab** in order to start the follower analysis.

The extension does not access tabs in the background or other websites.

### notifications

Used to optionally display a browser notification when a scan completes or if an error occurs.

Notifications are only triggered in response to user actions.

---

# Data Privacy

This extension **does not collect, store, or transmit any personal data**.

All data processing occurs **locally in the user's browser**.

The extension only retrieves the follower and following lists necessary to compute the **non-followers result**. No data is sent to external servers.

---

# Project Structure

```
InstagramWhoFollows/
│
├── manifest.json
├── background_script.js
├── content_script.js
├── urls.js
│
├── browserAction/
│   ├── index.html
│   ├── script.js
│   └── tailwind.js
│
├── icons/
│   ├── icon-16.svg
│   ├── icon-32.svg
│   ├── icon-48.svg
│   ├── icon-128.svg
│   └── icon-master.svg
│
└── .gitignore
```

---

# Folder Overview

### manifest.json

Defines the extension configuration, permissions, content scripts, and popup interface.

### background_script.js

Maintains the **global job state** and coordinates communication between the popup UI and the Instagram page.

### content_script.js

Runs inside Instagram pages.

Responsible for:

* retrieving followers and following lists
* computing non-followers
* sending progress updates
* rendering the floating progress UI on the page

### browserAction/

Contains the popup UI shown when the extension icon is clicked.

* **index.html** – popup layout
* **script.js** – popup logic and UI rendering
* **tailwind.js** – runtime TailwindCSS configuration for popup styling

### urls.js

Stores Instagram endpoint definitions used by the content script when requesting follower data.

### icons/

Extension icons used in the browser toolbar and extension store listings.

### .gitignore

Specifies files that should not be tracked in version control.

---

# Technical Notes

* Built using **WebExtensions API**
* Compatible with **Firefox-based browsers**
* Uses **content scripts** to interact with Instagram pages
* Uses **background scripts** to maintain scan state
* Popup UI built with **TailwindCSS**

---

# Limitations

* Instagram accounts with **10,000+ followers** are not supported to avoid excessive requests.
* The extension relies on Instagram's current page structure and APIs, which may change.

---

# Disclaimer

This extension is **not affiliated with or endorsed by Instagram**.

Instagram is a trademark of Meta Platforms, Inc.
