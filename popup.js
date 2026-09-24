// Popup Script for GitHub Fork to Private

document.addEventListener("DOMContentLoaded", () => {
  let currentRepoInfo = null;
  let cachedSettings = {
    defaultSuffix: "-private",
    defaultLocalDir: "~/Projects",
    autoSubmit: true
  };

  // UI Elements
  const tabButtons = document.querySelectorAll(".nav-tab");
  const tabPanes = document.querySelectorAll(".tab-pane");

  const currentRepoView = document.getElementById("current-repo-view");
  const noRepoView = document.getElementById("no-repo-view");
  const currentRepoName = document.getElementById("current-repo-name");
  const currentRepoForkBadge = document.getElementById("current-repo-fork-badge");
  const currentRepoSub = document.getElementById("current-repo-sub");
  const targetRepoNameInput = document.getElementById("target-repo-name");

  const btnCloudImport = document.getElementById("btn-cloud-import");
  const btnCopyCli = document.getElementById("btn-copy-cli");

  const manualSourceUrlInput = document.getElementById("manual-source-url");
  const manualTargetNameInput = document.getElementById("manual-target-name");
  const btnManualImport = document.getElementById("btn-manual-import");

  const historyContainer = document.getElementById("history-container");
  const historyEmpty = document.getElementById("history-empty");
  const btnClearHistory = document.getElementById("btn-clear-history");

  const settingSuffix = document.getElementById("setting-suffix");
  const settingLocalDir = document.getElementById("setting-local-dir");
  const settingAutoSubmit = document.getElementById("setting-auto-submit");
  const btnSaveSettings = document.getElementById("btn-save-settings");

  const toastMsg = document.getElementById("toast-msg");

  function showToast(text) {
    toastMsg.textContent = text;
    toastMsg.style.display = "block";
    setTimeout(() => {
      toastMsg.style.display = "none";
    }, 2000);
  }

  // Load Settings
  chrome.storage.local.get(["settings"], (res) => {
    if (res.settings) {
      cachedSettings = { ...cachedSettings, ...res.settings };
      settingSuffix.value = cachedSettings.defaultSuffix;
      settingLocalDir.value = cachedSettings.defaultLocalDir;
      settingAutoSubmit.checked = cachedSettings.autoSubmit;
    }
  });

  // Tab Switching
  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      tabButtons.forEach(b => b.classList.remove("active"));
      tabPanes.forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      const targetId = btn.dataset.target;
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add("active");

      if (targetId === "tab-history") {
        renderHistory();
      }
    });
  });

  // Detect Active Tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (!activeTab || !activeTab.url) {
      showNoRepo();
      return;
    }

    try {
      const url = new URL(activeTab.url);
      if (url.hostname === "github.com") {
        const parts = url.pathname.split("/").filter(Boolean);
        const reserved = new Set([
          "settings", "explore", "notifications", "orgs", "marketplace",
          "topics", "trending", "collections", "events", "sponsors",
          "account", "new", "login", "signup", "search", "pulls", "issues"
        ]);

        if (parts.length >= 2 && !reserved.has(parts[0].toLowerCase())) {
          const owner = parts[0];
          const repo = parts[1];
          currentRepoInfo = {
            owner,
            repo,
            fullRepo: `${owner}/${repo}`,
            cloneUrl: `https://github.com/${owner}/${repo}.git`
          };

          currentRepoName.textContent = currentRepoInfo.fullRepo;
          targetRepoNameInput.value = `${repo}${cachedSettings.defaultSuffix}`;

          // Try executing script to get detailed fork metadata if possible
          chrome.tabs.sendMessage(activeTab.id, { action: "GET_REPO_META" }, (response) => {
            if (response && response.isFork) {
              currentRepoForkBadge.style.display = "inline-block";
              currentRepoSub.textContent = `上游源: ${response.parentNwo || "未知"}`;
            } else {
              currentRepoForkBadge.style.display = "none";
              currentRepoSub.textContent = `公开开源仓库`;
            }
          });

          currentRepoView.style.display = "block";
          noRepoView.style.display = "none";
          return;
        }
      }
    } catch (e) {
      console.error(e);
    }

    showNoRepo();
  });

  function showNoRepo() {
    currentRepoView.style.display = "none";
    noRepoView.style.display = "block";
  }

  // Cloud Import from Current Tab
  btnCloudImport.addEventListener("click", () => {
    if (!currentRepoInfo) return;
    const targetName = targetRepoNameInput.value.trim();
    if (!targetName) {
      showToast("请输入目标仓库名称");
      return;
    }

    btnCloudImport.disabled = true;
    btnCloudImport.textContent = "正在跳转...";

    chrome.runtime.sendMessage({
      action: "START_IMPORT",
      data: {
        sourceUrl: currentRepoInfo.cloneUrl,
        targetName: targetName,
        visibility: "private",
        autoSubmit: cachedSettings.autoSubmit,
        sourceRepo: currentRepoInfo.repo,
        sourceOwner: currentRepoInfo.owner
      }
    }, () => {
      window.close();
    });
  });

  // Copy CLI from Current Tab
  btnCopyCli.addEventListener("click", () => {
    if (!currentRepoInfo) return;
    const targetName = targetRepoNameInput.value.trim() || `${currentRepoInfo.repo}-private`;
    const localDir = `${cachedSettings.defaultLocalDir}/${targetName}`;
    const desc = `Private copy of ${currentRepoInfo.repo}`;

    const myUser = (currentRepoInfo && currentRepoInfo.currentUser) || "<your-username>";
    const cliCmd = `#!/usr/bin/env bash\n` +
      `# 开启严格错误拦截：任何一步失败立刻终止，绝不继续执行后续步骤\n` +
      `set -euo pipefail\n\n` +
      `TARGET_REPO="${myUser}/${targetName}"\n` +
      `SOURCE_URL="${currentRepoInfo.cloneUrl}"\n` +
      `LOCAL_DIR="${localDir}"\n\n` +
      `echo "==> [1/4] 正在 GitHub 创建私有仓库: \${TARGET_REPO}..."\n` +
      `gh repo create "\${TARGET_REPO}" --private --description "${desc}"\n\n` +
      `echo "==> [2/4] 安全复核：确认目标仓库确实为【私有】状态..."\n` +
      `IS_PRIVATE=$(gh repo view "\${TARGET_REPO}" --json isPrivate --jq '.isPrivate' 2>/dev/null || echo "false")\n` +
      `if [ "\${IS_PRIVATE}" != "true" ]; then\n` +
      `  echo "❌ [安全拦截] 目标仓库 \${TARGET_REPO} 不是私有仓库（或创建失败）！" >&2\n` +
      `  echo "❌ 为防止将代码误推到公开仓库，已紧急终止后续上传！" >&2\n` +
      `  exit 1\n` +
      `fi\n\n` +
      `echo "==> [3/4] 权限校验通过。克隆源项目并配置双 Remote..."\n` +
      `git clone "\${SOURCE_URL}" "\${LOCAL_DIR}"\n` +
      `cd "\${LOCAL_DIR}"\n\n` +
      `git remote rename origin upstream\n` +
      `git remote add origin "git@github.com:\${TARGET_REPO}.git"\n` +
      `git remote set-url --push upstream DISABLED\n\n` +
      `echo "==> [4/4] 正在推送到私有仓库..."\n` +
      `git push -u origin --all\n` +
      `git push -u origin --tags\n\n` +
      `echo "✅ 全部完成！已成功将代码安全备份至私有仓库 \${TARGET_REPO}。"`;

    navigator.clipboard.writeText(cliCmd).then(() => {
      showToast("✓ 终端命令已复制！");
    });
  });

  // Manual URL Auto-fill name
  manualSourceUrlInput.addEventListener("input", () => {
    const val = manualSourceUrlInput.value.trim();
    try {
      const u = new URL(val);
      const parts = u.pathname.split("/").filter(Boolean);
      if (parts.length >= 2) {
        const repo = parts[1].replace(/\.git$/, "");
        manualTargetNameInput.value = `${repo}${cachedSettings.defaultSuffix}`;
      }
    } catch (e) {}
  });

  // Manual Import
  btnManualImport.addEventListener("click", () => {
    const sourceUrl = manualSourceUrlInput.value.trim();
    const targetName = manualTargetNameInput.value.trim();

    if (!sourceUrl || !targetName) {
      showToast("请填写完整源地址和目标名称");
      return;
    }

    let validUrl = sourceUrl;
    if (!validUrl.endsWith(".git")) {
      validUrl += ".git";
    }

    btnManualImport.disabled = true;
    btnManualImport.textContent = "正在跳转...";

    chrome.runtime.sendMessage({
      action: "START_IMPORT",
      data: {
        sourceUrl: validUrl,
        targetName: targetName,
        visibility: "private",
        autoSubmit: cachedSettings.autoSubmit
      }
    }, () => {
      window.close();
    });
  });

  // Render History
  function renderHistory() {
    chrome.storage.local.get(["history"], (res) => {
      const history = res.history || [];
      historyContainer.innerHTML = "";

      if (history.length === 0) {
        historyEmpty.style.display = "block";
        btnClearHistory.style.display = "none";
        return;
      }

      historyEmpty.style.display = "none";
      btnClearHistory.style.display = "block";

      history.forEach(item => {
        const div = document.createElement("div");
        div.className = "history-item";
        div.innerHTML = `
          <div class="history-item-header">
            <span class="history-name">${item.targetName}</span>
            <span class="history-date">${item.createdAt}</span>
          </div>
          <div class="history-sub">${item.sourceUrl}</div>
        `;
        historyContainer.appendChild(div);
      });
    });
  }

  // Clear History
  btnClearHistory.addEventListener("click", () => {
    chrome.storage.local.set({ history: [] }, () => {
      renderHistory();
      showToast("历史记录已清空");
    });
  });

  // Save Settings
  btnSaveSettings.addEventListener("click", () => {
    cachedSettings = {
      defaultSuffix: settingSuffix.value.trim() || "-private",
      defaultLocalDir: settingLocalDir.value.trim() || "~/Projects",
      autoSubmit: settingAutoSubmit.checked
    };

    chrome.storage.local.set({ settings: cachedSettings }, () => {
      showToast("设置已保存！");
    });
  });
});
