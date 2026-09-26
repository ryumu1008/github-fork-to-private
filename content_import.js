// Operates only on a task claimed from the background worker for this exact tab/document.
(() => {
  'use strict';
  const sourceSelector = '#vcs_url, input[name="vcs_url"], input[name="subversion_url"], input[placeholder*="clone URL"]';
  const nameSelector = '#repository_name, input[name="repository[name]"]';
  const privateSelector = '#repository_visibility_private, input[type="radio"][name="repository[visibility]"][value="private"]';
  const reactSourceSelector = 'input[name="The URL for your source repository"], input[name="Your old repository\'s clone URL"]';
  let timer;
  let submitted = false;
  let task;
  let cleanupForm = () => {};
  async function message(action, extra = {}) {
    const response = await chrome.runtime.sendMessage({ action, taskId: task?.id, ...extra });
    if (!response?.success) throw new Error(response?.error || '插件没有响应，请重新加载扩展后重试。');
    return response;
  }
  function removeBanner() { document.getElementById('f2p-import-banner')?.remove(); }
  function make(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function showError(error) {
    clearInterval(timer);
    removeBanner();
    const banner = make('div', 'f2p-banner f2p-banner-danger');
    banner.id = 'f2p-import-banner';
    const content = make('div', 'f2p-banner-content');
    const copy = make('div');
    copy.append(make('div', 'f2p-banner-title', '已停止自动导入'), make('div', 'f2p-banner-desc', error.message || String(error)));
    const close = make('button', 'f2p-banner-cancel-btn', '关闭提示');
    close.type = 'button';
    close.addEventListener('click', () => banner.remove());
    content.append(copy, close); banner.append(content); document.body.prepend(banner);
  }
  function findForm() {
    const legacySource = document.querySelector(sourceSelector);
    const source = legacySource || document.querySelector(reactSourceSelector);
    const form = source?.form;
    if (!form) return null;
    const action = new URL(form.action, location.href);
    const react = !legacySource && !!form.closest('react-app[app-name="repo-creation"][initial-path="/new/import"]');
    if (action.origin !== 'https://github.com') return null;
    if (react) {
      // GitHub's React importer posts through its submit handler. Its HTML form
      // intentionally has no action/method; never allow a native GET fallback.
      if (form.hasAttribute('action') || form.hasAttribute('method') || action.pathname !== '/new/import') return null;
    } else if (form.method.toLowerCase() !== 'post' || !['/new/import', '/repositories/imports', '/repositories/import'].includes(action.pathname.replace(/\/$/, ''))) return null;
    const name = form.querySelector(react ? '#repository-name-input' : nameSelector);
    const privateRadio = form.querySelector(react ? 'input[type="radio"][name="visibilityGroup"][value="private"]' : privateSelector);
    const submit = form.querySelector('button[type="submit"], input[type="submit"]');
    if (!name || !privateRadio || !submit || [source, name, privateRadio, submit].some(el => el.form !== form || el.disabled)) return null;
    if (privateRadio.type !== 'radio' || privateRadio.name !== (react ? 'visibilityGroup' : 'repository[visibility]') || privateRadio.value !== 'private') return null;
    if (react && (form.querySelectorAll(reactSourceSelector).length !== 1 || form.querySelectorAll('#repository-name-input').length !== 1
      || form.querySelectorAll('input[type="radio"][name="visibilityGroup"][value="private"]').length !== 1
      || submit.hasAttribute('formaction') || submit.hasAttribute('formmethod'))) return null;
    if (submit.formNoValidate || (submit.hasAttribute('formaction') && submit.formAction !== form.action)
      || (submit.hasAttribute('formmethod') && submit.formMethod.toLowerCase() !== 'post')) return null;
    return { form, source, name, privateRadio, submit, react };
  }
  function waitForForm() {
    return new Promise((resolve, reject) => {
      const initial = findForm();
      if (initial) return resolve(initial);
      const observer = new MutationObserver(() => { const found = findForm(); if (found) { cleanup(); resolve(found); } });
      const timeout = setTimeout(() => { cleanup(); reject(new Error('未找到完整的 GitHub 导入表单。请手动检查页面；插件没有提交。')); }, 10000);
      function cleanup() { clearTimeout(timeout); observer.disconnect(); }
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    });
  }
  function fill(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function verify(expectedForm) {
    const fields = findForm();
    if (!fields || fields.form !== expectedForm || !expectedForm.isConnected) throw new Error('导入表单已变化，请从插件重新发起。');
    const { source, name, privateRadio } = fields;
    if (F2P.parseRepoUrl(source.value).cloneUrl !== task.sourceUrl || name.value !== task.targetName) throw new Error('源地址或仓库名称已改变。请检查后自行提交，或从插件重新发起。');
    const values = new FormData(expectedForm).getAll(privateRadio.name);
    if (!privateRadio.checked || values.length !== 1 || values[0] !== 'private') throw new Error('未确认仓库为私有，已停止提交。请检查 Private 选项。');
    if (fields.react) {
      // Check GitHub's rendered state as well as the radio DOM property, so a
      // failed React change event cannot leave the app planning a public repo.
      const summaries = [...expectedForm.querySelectorAll('[class*="InfoMessage-module__InfoMessage__"]')];
      if (!summaries.some(el => /You are creating a private repository\b/.test(el.textContent))) {
        throw new Error('GitHub 尚未确认私有状态，请检查页面的 Private 提示后重新发起。');
      }
    }
    return fields;
  }
  function showReady(fields) {
    removeBanner();
    const banner = make('div', 'f2p-banner'); banner.id = 'f2p-import-banner';
    const content = make('div', 'f2p-banner-content');
    const left = make('div');
    const title = make('div', 'f2p-banner-title', '复制到私有仓库');
    left.append(title, make('div', 'f2p-banner-desc', `来源：${task.sourceUrl} → ${task.targetName}。请核对 GitHub 页面上的所属账号。`));
    const right = make('div', 'f2p-banner-right');
    const countdown = make('span', 'f2p-countdown-text');
    const cancel = make('button', 'f2p-banner-cancel-btn', '取消自动'); cancel.type = 'button';
    const start = make('button', 'f2p-banner-btn', '确认并开始导入'); start.type = 'button';
    right.append(countdown, cancel, start); content.append(left, right); banner.append(content); document.body.prepend(banner);
    cancel.addEventListener('click', () => { clearInterval(timer); countdown.textContent = '已取消倒计时，请检查后手动开始。'; cancel.disabled = true; });
    let allowNativeSubmission = false;
    const guard = event => {
      if (allowNativeSubmission) {
        allowNativeSubmission = false;
        if (fields.react) event.preventDefault();
        try { verify(fields.form); } catch (error) { event.preventDefault(); event.stopImmediatePropagation(); fail(error); }
        return;
      }
      // The native GitHub button follows the same guarded path as our banner button.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!submitted) execute();
    };
    fields.form.addEventListener('submit', guard, true);
    cleanupForm = () => fields.form.removeEventListener('submit', guard, true);
    async function execute() {
      if (submitted || start.disabled) return;
      clearInterval(timer);
      start.disabled = true;
      try {
        let checked = verify(fields.form);
        if (!checked.form.reportValidity()) throw new Error('表单仍有未填写或不符合要求的内容，请检查后重新发起。');
        // This records an attempt, never successful completion. GitHub owns the final result.
        await message('IMPORT_STATUS', { status: 'submission_requested' });
        // Leave the original native submit event before requestSubmit: browsers suppress
        // a nested submission while the initial submit algorithm is still running.
        await new Promise(resolve => setTimeout(resolve, 0));
        checked = verify(fields.form);
        submitted = true;
        title.textContent = '已发起提交，导入结果请以 GitHub 页面为准';
        countdown.textContent = ''; cancel.disabled = true;
        allowNativeSubmission = true;
        checked.form.requestSubmit(checked.submit);
      } catch (error) { fail(error); }
    }
    start.addEventListener('click', execute);
    if (task.autoSubmit) {
      let seconds = 3; countdown.textContent = `${seconds} 秒后提交`;
      timer = setInterval(() => { seconds -= 1; countdown.textContent = `${seconds} 秒后提交`; if (seconds <= 0) execute(); }, 1000);
    } else { countdown.textContent = '请核对后手动开始。'; cancel.hidden = true; }
  }
  function fail(error) {
    cleanupForm();
    showError(error);
    if (task) message('IMPORT_STATUS', { status: 'needs_attention' }).catch(() => {});
  }
  async function init() {
    const id = new URLSearchParams(location.hash.slice(1)).get('f2p_task');
    if (!id) return;
    try {
      const response = await message('CLAIM_IMPORT', { taskId: id });
      task = response.task;
      history.replaceState(null, '', location.pathname + location.search);
      const fields = await waitForForm();
      fill(fields.source, task.sourceUrl); fill(fields.name, task.targetName);
      if (!fields.privateRadio.checked) fields.privateRadio.click();
      await new Promise(resolve => setTimeout(resolve, 200));
      verify(fields.form);
      showReady(fields);
    } catch (error) { fail(error); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
