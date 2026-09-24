// Content Script for GitHub Import Page (https://github.com/new/import)

(function () {
  "use strict";

  // Parse parameters from Hash or Storage
  function getTaskParameters(callback) {
    let task = null;

    // Check hash first
    if (window.location.hash && window.location.hash.includes("f2p=1")) {
      try {
        const hashStr = window.location.hash.substring(1);
        const params = new URLSearchParams(hashStr);
        task = {
          sourceUrl: params.get("src"),
          targetName: params.get("name"),
          visibility: params.get("vis") || "private",
          autoSubmit: params.get("auto") === "1"
        };
        // Clean hash from URL for privacy and clean state
        history.replaceState(null, "", window.location.pathname + window.location.search);
      } catch (e) {
        console.error("Error parsing hash:", e);
      }
    }

    if (task && task.sourceUrl && task.targetName) {
      callback(task);
      return;
    }

    // Fallback: check storage
    chrome.storage.local.get(["pending_import"], (res) => {
      const pending = res.pending_import;
      if (pending && Date.now() - (pending.createdAt || 0) < 60000) { // within 60s
        chrome.storage.local.remove(["pending_import"]);
        callback(pending);
      } else {
        callback(null);
      }
    });
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

  function showBanner(task, onSubmit) {
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
            <div class="f2p-banner-title">GitHub 一键复制到私有：已自动为您填入参数</div>
            <div class="f2p-banner-desc">
              来源: <code>${task.sourceUrl}</code> &nbsp;➔&nbsp;
              目标仓库: <strong>${task.targetName}</strong> (🔒 私有)
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
      submitNowBtn.disabled = true;
      submitNowBtn.textContent = "正在提交...";
      if (countContainer) countContainer.style.display = "none";
      onSubmit();
    }

    cancelBtn.addEventListener("click", () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      countContainer.innerHTML = `<span style="color:#8b949e;">自动提交已取消，请检查后手动提交</span>`;
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

      console.log("F2P: Found pending import task", task);

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

      if (privateRadio) {
        privateRadio.checked = true;
        privateRadio.dispatchEvent(new Event("change", { bubbles: true }));
        privateRadio.dispatchEvent(new Event("click", { bubbles: true }));
      }

      // Show floating progress banner
      showBanner(task, () => {
        if (submitBtn) {
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
          if (form) {
            form.requestSubmit ? form.requestSubmit() : submitBtn.click();
          } else {
            submitBtn.click();
          }
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", handleImport);
  } else {
    handleImport();
  }
})();
