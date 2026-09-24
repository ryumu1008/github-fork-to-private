// Background Service Worker for GitHub Fork to Private

chrome.runtime.onInstalled.addListener(() => {
  console.log("GitHub Fork to Private Extension Installed");
  // Initialize default settings if not set
  chrome.storage.local.get(["settings"], (res) => {
    if (!res.settings) {
      chrome.storage.local.set({
        settings: {
          defaultSuffix: "-private",
          defaultVisibility: "private",
          autoSubmit: true,
          defaultLocalDir: "~/Projects"
        },
        history: []
      });
    }
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "START_IMPORT") {
    const { sourceUrl, targetName, visibility, autoSubmit, sourceRepo, sourceOwner } = request.data;
    
    // Generate a secure one-time nonce to prevent CSRF / external link drive-by attacks
    const nonce = typeof crypto !== "undefined" && crypto.randomUUID 
      ? crypto.randomUUID() 
      : (Math.random().toString(36).substring(2) + Date.now().toString(36));

    const task = {
      nonce,
      sourceUrl,
      targetName,
      visibility: visibility || "private",
      autoSubmit: autoSubmit !== undefined ? autoSubmit : true,
      sourceRepo: sourceRepo || "",
      sourceOwner: sourceOwner || "",
      createdAt: Date.now()
    };

    // Store pending import task in chrome.storage.local
    chrome.storage.local.set({ pending_import: task }, () => {
      // Also add to history list
      chrome.storage.local.get(["history"], (res) => {
        const history = res.history || [];
        history.unshift({
          id: Date.now(),
          sourceUrl,
          targetName,
          visibility: task.visibility,
          createdAt: new Date().toLocaleString(),
          status: "importing"
        });
        // Keep last 30 entries
        chrome.storage.local.set({ history: history.slice(0, 30) });
      });

      // Pass ONLY the one-time nonce in URL hash.
      // External links cannot forge this nonce, protecting against drive-by automated imports.
      const importUrl = `https://github.com/new/import#f2p_nonce=${nonce}`;

      // Open new/import in a new tab
      chrome.tabs.create({ url: importUrl }, (newTab) => {
        sendResponse({ success: true, tabId: newTab.id });
      });
    });

    return true; // Keep message channel open for async response
  }

  if (request.action === "IMPORT_COMPLETED") {
    const { targetName, targetUrl } = request.data;
    chrome.storage.local.get(["history"], (res) => {
      let history = res.history || [];
      if (history.length > 0) {
        history[0].status = "completed";
        history[0].targetUrl = targetUrl;
        chrome.storage.local.set({ history });
      }
    });
    // Clear pending_import immediately
    chrome.storage.local.remove(["pending_import"]);
    sendResponse({ success: true });
    return true;
  }
});
