// Content Script for GitHub Repository Pages

(function () {
  "use strict";

  const RESERVED_PATHS = new Set([
    "settings", "explore", "notifications", "orgs", "marketplace",
    "topics", "trending", "collections", "events", "sponsors",
    "account", "new", "login", "signup", "search", "pulls", "issues"
  ]);

  function getRepoDetails() {
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    if (pathParts.length < 2) return null;

    const owner = pathParts[0];
    const repo = pathParts[1];

    if (RESERVED_PATHS.has(owner.toLowerCase())) return null;

    // Read GitHub octolytics metadata if available
    const isForkMeta = document.querySelector('meta[name="octolytics-dimension-repository_is_fork"]');
    const parentNwoMeta = document.querySelector('meta[name="octolytics-dimension-repository_parent_nwo"]');
    const userLoginMeta = document.querySelector('meta[name="user-login"]');

    const isFork = isForkMeta ? isForkMeta.content === "true" : false;
    const parentNwo = parentNwoMeta ? parentNwoMeta.content : "";
    const currentUser = userLoginMeta ? userLoginMeta.content : "";

    return {
      owner,
      repo,
      fullRepo: `${owner}/${repo}`,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
      isFork,
      parentNwo,
      currentUser
    };
  }

  function injectButton() {
    if (document.getElementById("f2p-private-copy-btn")) return;

    const repoInfo = getRepoDetails();
    if (!repoInfo) return;

    // Locate header actions container
    // Matches GitHub's various container structures
    const container =
      document.querySelector("#repository-details-container ul") ||
      document.querySelector("ul.pagehead-actions") ||
      document.querySelector("div[data-testid='header-actions']") ||
      document.querySelector(".d-flex.gap-2.flex-wrap") ||
      document.querySelector("#fork-button")?.closest("ul, div");

    if (!container) return;

    const btnWrapper = document.createElement("li");
    btnWrapper.id = "f2p-btn-container";
    btnWrapper.className = "d-inline-block";

    const btn = document.createElement("button");
    btn.id = "f2p-private-copy-btn";
    btn.type = "button";
    btn.className = "btn btn-sm f2p-btn";
    btn.title = "一键将此项目复制为完全独立的私有仓库（保留全部历史）";

    btn.innerHTML = `
      <svg class="octicon octicon-lock f2p-lock-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <path d="M4 4a4 4 0 0 1 8 0v2h.25c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25v-5.5C2 6.784 2.784 6 3.75 6H4Zm8.25 3.5h-8.5a.25.25 0 0 0-.25.25v5.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25ZM10.5 6V4a2.5 2.5 0 1 0-5 0v2Z"></path>
      </svg>
      <span class="f2p-btn-text">复制到私有</span>
    `;

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      showModal(repoInfo);
    });

    btnWrapper.appendChild(btn);

    // Insert near fork button if possible, else append
    const forkBtn = container.querySelector("#fork-button")?.closest("li") || container.lastElementChild;
    if (forkBtn && forkBtn.parentNode === container) {
      container.insertBefore(btnWrapper, forkBtn.nextSibling);
    } else {
      container.appendChild(btnWrapper);
    }
  }

  function showModal(repoInfo) {
    // Remove existing modal if any
    const existing = document.getElementById("f2p-modal-overlay");
    if (existing) existing.remove();

    chrome.storage.local.get(["settings"], (res) => {
      const settings = res.settings || {
        defaultSuffix: "-private",
        defaultLocalDir: "~/Projects",
        autoSubmit: true
      };

      const defaultTargetName = `${repoInfo.repo}${settings.defaultSuffix}`;
      const defaultDesc = `Private copy of ${repoInfo.repo}`;

      const overlay = document.createElement("div");
      overlay.id = "f2p-modal-overlay";
      overlay.className = "f2p-overlay";

      overlay.innerHTML = `
        <div class="f2p-modal">
          <div class="f2p-modal-header">
            <div class="f2p-title-row">
              <span class="f2p-icon-badge">🔒</span>
              <div class="f2p-title-group">
                <h3 class="f2p-title">复制到独立私有仓库</h3>
                <p class="f2p-subtitle">保留完整提交历史与所有分支，完全独立于公共 Fork 树</p>
              </div>
            </div>
            <button class="f2p-close-btn" id="f2p-modal-close">&times;</button>
          </div>

          <div class="f2p-modal-body">
            <!-- Source Details -->
            <div class="f2p-field-group">
              <label class="f2p-label">源仓库来源</label>
              <div class="f2p-source-box">
                <span class="f2p-tag ${repoInfo.isFork ? 'f2p-tag-fork' : 'f2p-tag-repo'}">
                  ${repoInfo.isFork ? '已 Fork 仓库' : '开源仓库'}
                </span>
                <span class="f2p-source-name">${repoInfo.fullRepo}</span>
                ${repoInfo.parentNwo ? `<span class="f2p-source-parent">(源自: ${repoInfo.parentNwo})</span>` : ''}
              </div>
            </div>

            <!-- Target Name Input -->
            <div class="f2p-field-group">
              <label class="f2p-label" for="f2p-target-name">目标私有仓库名称</label>
              <div class="f2p-input-wrapper">
                <span class="f2p-input-prefix">${repoInfo.currentUser ? repoInfo.currentUser + '/' : '你的账号/'}</span>
                <input type="text" id="f2p-target-name" class="f2p-input" value="${defaultTargetName}" placeholder="仓库名称" />
              </div>
              <span class="f2p-hint">默认自动添加 <code>${settings.defaultSuffix}</code> 后缀，方便区分并防止同名冲突</span>
            </div>

            <!-- Clone Source Selection (if fork) -->
            ${repoInfo.isFork && repoInfo.parentNwo ? `
            <div class="f2p-field-group">
              <label class="f2p-label">克隆来源</label>
              <div class="f2p-radio-group">
                <label class="f2p-radio-label">
                  <input type="radio" name="f2p-source-choice" value="current" checked />
                  <span>当前 Fork 仓库 (包含你的最新更改)</span>
                </label>
                <label class="f2p-radio-label">
                  <input type="radio" name="f2p-source-choice" value="upstream" />
                  <span>上游原始仓库 (<code>${repoInfo.parentNwo}</code>)</span>
                </label>
              </div>
            </div>
            ` : ''}

            <!-- Mode Tabs -->
            <div class="f2p-tabs">
              <button class="f2p-tab active" data-tab="cloud">🚀 云端免 Token 复制 (推荐)</button>
              <button class="f2p-tab" data-tab="cli">💻 本地双 Remote 终端命令</button>
            </div>

            <!-- Tab 1: Cloud -->
            <div class="f2p-tab-content active" id="f2p-tab-cloud">
              <div class="f2p-feature-list">
                <div class="f2p-feature-item">
                  <span class="f2p-check">✓</span>
                  <span><strong>无需配置 Token</strong>：直接复用你当前已登录的 GitHub 权限</span>
                </div>
                <div class="f2p-feature-item">
                  <span class="f2p-check">✓</span>
                  <span><strong>全自动化云端克隆</strong>：不消耗本地宽带，5-15 秒在 GitHub 服务器完成完整镜像</span>
                </div>
                <div class="f2p-feature-item">
                  <span class="f2p-check">✓</span>
                  <span><strong>完全私有</strong>：创建后即为 Private，不会公开你的私人修改或敏感信息</span>
                </div>
              </div>
              <div class="f2p-action-row">
                <button type="button" class="f2p-primary-btn" id="f2p-start-cloud-import">
                  立即一键复制到私有仓库
                </button>
              </div>
            </div>

            <!-- Tab 2: CLI -->
            <div class="f2p-tab-content" id="f2p-tab-cli">
              <p class="f2p-hint" style="margin-top:0;">一键在本地终端执行，创建私有库并配置 <code>upstream</code> 保持后续只读同步：</p>
              <pre class="f2p-code-block" id="f2p-cli-code"></pre>
              <div class="f2p-action-row">
                <button type="button" class="f2p-secondary-btn" id="f2p-copy-cli">
                  📋 复制完整终端脚本
                </button>
              </div>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      // Event Handlers
      const closeBtn = overlay.querySelector("#f2p-modal-close");
      closeBtn.addEventListener("click", () => overlay.remove());
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.remove();
      });

      // Target Name Input listener to update CLI code
      const nameInput = overlay.querySelector("#f2p-target-name");
      const cliBlock = overlay.querySelector("#f2p-cli-code");

      function updateCliCode() {
        const targetName = nameInput.value.trim() || `${repoInfo.repo}-private`;
        const chosenSource = overlay.querySelector('input[name="f2p-source-choice"]:checked')?.value;
        const sourceUrl = chosenSource === "upstream" && repoInfo.parentNwo
          ? `git@github.com:${repoInfo.parentNwo}.git`
          : repoInfo.cloneUrl.replace("https://github.com/", "git@github.com:");
        
        const myUser = repoInfo.currentUser || "your-username";
        const localDir = `${settings.defaultLocalDir}/${targetName}`;

        cliBlock.textContent = `# 1. 在 GitHub 创建对应私有仓库\n` +
          `gh repo create ${myUser}/${targetName} --private --description "${defaultDesc}"\n\n` +
          `# 2. 克隆源仓库到本地目录\n` +
          `git clone ${sourceUrl} "${localDir}"\n` +
          `cd "${localDir}"\n\n` +
          `# 3. 将 origin 切换为你自己的私有仓库，并将源仓库保留为 upstream 追踪\n` +
          `git remote rename origin upstream\n` +
          `git remote add origin git@github.com:${myUser}/${targetName}.git\n` +
          `git remote set-url --push upstream DISABLED\n` +
          `git push -u origin --all\n` +
          `git push -u origin --tags`;
      }

      updateCliCode();
      nameInput.addEventListener("input", updateCliCode);
      const radioInputs = overlay.querySelectorAll('input[name="f2p-source-choice"]');
      radioInputs.forEach(r => r.addEventListener("change", updateCliCode));

      // Tab switching
      const tabs = overlay.querySelectorAll(".f2p-tab");
      tabs.forEach(tab => {
        tab.addEventListener("click", () => {
          tabs.forEach(t => t.classList.remove("active"));
          overlay.querySelectorAll(".f2p-tab-content").forEach(c => c.classList.remove("active"));
          tab.classList.add("active");
          const target = overlay.querySelector(`#f2p-tab-${tab.dataset.tab}`);
          if (target) target.classList.add("active");
        });
      });

      // Copy CLI code
      const copyCliBtn = overlay.querySelector("#f2p-copy-cli");
      copyCliBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(cliBlock.textContent).then(() => {
          copyCliBtn.textContent = "✓ 已复制到剪贴板！";
          setTimeout(() => { copyCliBtn.textContent = "📋 复制完整终端脚本"; }, 2500);
        });
      });

      // Start Cloud Import
      const startBtn = overlay.querySelector("#f2p-start-cloud-import");
      startBtn.addEventListener("click", () => {
        const targetName = nameInput.value.trim();
        if (!targetName) {
          alert("请输入目标私有仓库名称");
          return;
        }

        const chosenSource = overlay.querySelector('input[name="f2p-source-choice"]:checked')?.value;
        const sourceUrl = chosenSource === "upstream" && repoInfo.parentNwo
          ? `https://github.com/${repoInfo.parentNwo}.git`
          : repoInfo.cloneUrl;

        startBtn.disabled = true;
        startBtn.textContent = "正在启动导入...";

        chrome.runtime.sendMessage({
          action: "START_IMPORT",
          data: {
            sourceUrl,
            targetName,
            visibility: "private",
            autoSubmit: settings.autoSubmit,
            sourceRepo: repoInfo.repo,
            sourceOwner: repoInfo.owner
          }
        }, (response) => {
          overlay.remove();
        });
      });
    });
  }

  // Initialize and observe GitHub SPA navigation
  function init() {
    injectButton();

    // GitHub Turbo / PJAX event listeners
    document.addEventListener("turbo:render", injectButton);
    document.addEventListener("turbo:load", injectButton);
    document.addEventListener("pjax:end", injectButton);
    window.addEventListener("popstate", injectButton);

    // MutationObserver fallback for dynamic rendering
    let timeout = null;
    const observer = new MutationObserver(() => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        injectButton();
      }, 300);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Message listener for popup communication
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "GET_REPO_META") {
      const details = getRepoDetails();
      sendResponse(details);
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
