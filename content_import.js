// Content Script for GitHub Import Page (https://github.com/new/import)
// Enhanced Security: Strict Nonce Origin Check & Mandatory Private Visibility Verification

(function () {
  "use strict";

  // Security Check 1: Prevent external link drive-by attacks
  // ONLY accept tasks initiated directly from the extension with a matching one-time nonce.
  function getTaskParameters(callback) {
    if (!window.location.hash || !window.location.hash.includes("f2p_nonce=")) {
      console.log("F2P: No extension nonce detected in URL, standing by.");
      callback(null);
      return;
    }

    try {
      const hashStr = window.location.hash.substring(1);
      const params = new URLSearchParams(hashStr);
      const incomingNonce = params.get("f2p_nonce");

      if (!incomingNonce) {
        callback(null);
        return;
      }

      chrome.storage.local.get(["pending_import"], (res) => {
        const pending = res.pending_import;

        // Verify nonce matches and task was created within 60 seconds
        if (
          pending &&
          pending.nonce === incomingNonce &&
          Date.now() - (pending.createdAt || 0) < 60000
        ) {
          // Immediately consume/delete the task from storage to prevent replay attacks
          chrome.storage.local.remove(["pending_import"]);

          // Clean the nonce hash from URL for privacy
          history.replaceState(null, "", window.location.pathname + window.location.search);

          callback(pending);
        } else {
          console.warn("F2P: Nonce mismatch or expired pending task. Execution rejected.");
          callback(null);
        }
      });
    } catch (e) {
      console.error("F2P: Error verifying nonce:", e);
      callback(null);
    }
  }

  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const target = document.querySelector(selector);
        if (target) {
          observer.disconnect();
          resolve(target);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(document.querySelector(selector));
      }, timeout);
    });
  }

  function setInputValue(input, val) {
    if (!input) return;
    input.focus();
    input.value = val;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
    input.blur();
  }

  // Security Check 2: Mandatory verification of Private visibility
  function verifyPrivateVisibility() {
    const privateRadio = document.querySelector(
      "#repository_visibility_private, input[name='repository[visibility]'][value='private'], input[value='private']"
    );
    const publicRadio = document.querySelector(
      "#repository_visibility_public, input[name='repository[visibility]'][value='public'], input[value='public']"
    );

    const isPrivateChecked = !!(privateRadio && privateRadio.checked);
    const isPublicChecked = !!(publicRadio && publicRadio.checked);

    return isPrivateChecked && !isPublicChecked;
  }

  function showSecurityAlert(message) {
    const existing = document.getElementById("f2p-import-banner");
    if (existing) existing.remove();

    const banner = document.createElement("div");
    banner.id = "f2p-import-banner";
    banner.className = "f2p-banner f2p-banner-danger";

    banner.innerHTML = `
      <div class="f2p-banner-content">
        <div class="f2p-banner-left">
          <span class="f2p-banner-icon">🚨</span>
          <div>
            <div class="f2p-banner-title" style="color:#ff7b72;">安全拦截：已紧急停止自动提交！</div>
            <div class="f2p-banner-desc" style="color:#f0f6fc;">${message}</div>
          </div>
        </div>
        <div class="f2p-banner-right">
          <button type="button" class="f2p-banner-cancel-btn" onclick="this.closest('#f2p-import-banner').remove()">关闭提示</button>
        </div>
      </div>
    `;

    document.body.prepend(banner);
  }

  function showBanner(task, onExecuteSubmit) {
    const existing = document.getElementById("f2p-import-banner");
    if (existing) existing.remove();

    const banner = document.createElement("div");
    banner.id = "f2p-import-banner";
    banner.className = "f2p-banner";

    banner.innerHTML = `
      <div class="f2p-banner-content">
        <div class="f2p-banner-left">
          <span class="f2p-banner-icon">⚡</span>
          <div>
            <div class="f2p-banner-title">GitHub 一键复制到私有：参数已自动装载</div>
            <div class="f2p-banner-desc">
              来源: <code>${task.sourceUrl}</code> &nbsp;➔&nbsp;
              目标仓库: <strong>${task.targetName}</strong> (🔒 权限验证中...)
            </div>
          </div>
        </div>
        <div class="f2p-banner-right">
          <div class="f2p-countdown-box" id="f2p-countdown-container">
            <span class="f2p-countdown-text">将在 <strong id="f2p-countdown-sec">3</strong> 秒后自动提交</span>
            <button type="button" class="f2p-banner-cancel-btn" id="f2p-cancel-auto">取消自动</button>
          </div>
          <button type="button" class="f2p-banner-btn" id="f2p-submit-now">立即开始导入</button>
        </div>
      </div>
      <div class="f2p-progress-bar"><div class="f2p-progress-inner" id="f2p-progress-inner"></div></div>
    `;

    document.body.prepend(banner);

    let seconds = 3;
    let cancelled = false;
    let timer = null;

    const secEl = banner.querySelector("#f2p-countdown-sec");
    const progEl = banner.querySelector("#f2p-progress-inner");
    const cancelBtn = banner.querySelector("#f2p-cancel-auto");
    const submitNowBtn = banner.querySelector("#f2p-submit-now");
    const countContainer = banner.querySelector("#f2p-countdown-container");

    function executeSubmit() {
      if (timer) clearInterval(timer);

      // Security Check: Strictly confirm it is indeed Private before submitting
      if (!verifyPrivateVisibility()) {
        showSecurityAlert(
          "未能确认目标仓库处于【私有 (Private)】状态！为防止将代码误导入为公开仓库，已紧急终止提交。请手动选择【Private】并自行提交。"
        );
        return;
      }

      submitNowBtn.disabled = true;
      submitNowBtn.textContent = "正在提交...";
      if (countContainer) countContainer.style.display = "none";
      onExecuteSubmit();
    }

    cancelBtn.addEventListener("click", () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      countContainer.innerHTML = `<span style="color:#8b949e;">已切换为手动模式，请核对后自行提交</span>`;
      progEl.style.width = "0%";
    });

    submitNowBtn.addEventListener("click", () => {
      executeSubmit();
    });

    if (task.autoSubmit) {
      progEl.style.transition = "width 3s linear";
      setTimeout(() => {
        if (!cancelled) progEl.style.width = "100%";
      }, 50);

      timer = setInterval(() => {
        seconds -= 1;
        if (secEl) secEl.textContent = seconds;
        if (seconds <= 0) {
          clearInterval(timer);
          if (!cancelled) {
            executeSubmit();
          }
        }
      }, 1000);
    } else {
      countContainer.style.display = "none";
    }
  }

  async function handleImport() {
    getTaskParameters(async (task) => {
      if (!task || !task.sourceUrl || !task.targetName) return;

      console.log("F2P: Secure task authenticated via one-time nonce.", task);

      // Locate URL Input
      const urlInput = await waitForElement(
        "#vcs_url, input[name='vcs_url'], input[name='subversion_url'], input[placeholder*='clone URL']"
      );

      // Locate Name Input
      const nameInput = await waitForElement(
        "#repository_name, input[name='repository[name]']"
      );

      // Locate Private Radio
      const privateRadio = await waitForElement(
        "#repository_visibility_private, input[name='repository[visibility]'][value='private'], input[value='private']"
      );

      // Locate Submit Button
      const submitBtn = await waitForElement(
        "button[type='submit'], .btn-primary[type='submit'], form input[type='submit']"
      );

      if (urlInput) {
        setInputValue(urlInput, task.sourceUrl);
      }

      if (nameInput) {
        setInputValue(nameInput, task.targetName);
      }

      // Explicitly check Private Radio
      if (privateRadio) {
        privateRadio.checked = true;
        privateRadio.dispatchEvent(new Event("change", { bubbles: true }));
        privateRadio.dispatchEvent(new Event("click", { bubbles: true }));
      }

      // Double-check private selection before displaying banner
      setTimeout(() => {
        if (privateRadio && !privateRadio.checked) {
          privateRadio.checked = true;
          privateRadio.dispatchEvent(new Event("change", { bubbles: true }));
        }

        const isVerifiedPrivate = verifyPrivateVisibility();

        showBanner(task, () => {
          if (submitBtn) {
            // Final check right before DOM click
            if (!verifyPrivateVisibility()) {
              showSecurityAlert("安全拦截：私有选项未生效，禁止提交！");
              return;
            }

            // Send complete notification
            chrome.runtime.sendMessage({
              action: "IMPORT_COMPLETED",
              data: {
                targetName: task.targetName,
                targetUrl: `https://github.com/${task.targetName}`
              }
            });

            // Submit the form
            const form = submitBtn.closest("form");
            if (form && form.requestSubmit) {
              form.requestSubmit();
            } else {
              submitBtn.click();
            }
          }
        });

        // Update banner text if private confirmed
        const descEl = document.querySelector(".f2p-banner-desc");
        if (descEl && isVerifiedPrivate) {
          descEl.innerHTML = `来源: <code>${task.sourceUrl}</code> &nbsp;➔&nbsp; 目标仓库: <strong>${task.targetName}</strong> (<span style="color:#3fb950; font-weight:600;">✓ 已严格锁定私有</span>)`;
        }
      }, 200);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", handleImport);
  } else {
    handleImport();
  }
})();
