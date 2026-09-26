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
  function makeBanner(className) {
    const banner = make('div', `${className} notranslate`);
    banner.id = 'f2p-import-banner';
    banner.setAttribute('translate', 'no');
    banner.dataset.version = chrome.runtime.getManifest().version;
    return banner;
  }
  function showError(error) {
    clearInterval(timer);
    removeBanner();
    const banner = makeBanner('f2p-banner f2p-banner-danger');
    const content = make('div', 'f2p-banner-content');
    const copy = make('div');
    copy.append(make('div', 'f2p-banner-title', `已停止自动导入 · v${banner.dataset.version}`), make('div', 'f2p-banner-desc', error.message || String(error)));
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
  function privateConfirmed(fields) {
    if (!fields.privateRadio.checked) return false;
    if (!fields.react) return true;
    // React renders aria-checked from its application state. The checked DOM
    // property alone can be stale, while the visible summary can be translated.
    const group = [...fields.form.elements].filter(el => el.type === 'radio' && el.name === 'visibilityGroup');
    return group.length >= 2 && group.length <= 3 && new Set(group.map(el => el.value)).size === group.length &&
      group.every(el => ['private', 'public', 'internal'].includes(el.value)) &&
      fields.privateRadio.getAttribute('aria-checked') === 'true' &&
      group.every(radio => radio === fields.privateRadio ||
        (!radio.checked && radio.getAttribute('aria-checked') === 'false'));
  }
  function textConfirmed(fields) {
    // The current React importer renders its controlled state back to the value
    // attribute. A DOM property alone can look filled while React still has ''.
    return !fields.react || (fields.source.defaultValue === task.sourceUrl && fields.name.defaultValue === task.targetName);
  }
  async function waitUntil(check, error, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const result = check();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(error);
  }
  function nameState(fields) {
    if (!fields.react) return 'available';
    if (fields.name.value !== task.targetName || fields.name.defaultValue !== task.targetName) return null;
    // Bind the status to this exact name, never to the wording of a sentence.
    // The boundary also rejects stale results for e.g. demo-private-2.
    const escaped = task.targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentionsName = element => element && new RegExp(`(^|[^A-Za-z0-9_.-])${escaped}($|[^A-Za-z0-9_.-])`).test(element.textContent);
    const available = fields.form.querySelectorAll('#RepoNameInput-is-available');
    const errors = fields.form.querySelectorAll('#RepoNameInput-message');
    if (available.length === 1 && !errors.length && fields.name.getAttribute('aria-invalid') !== 'true' && mentionsName(available[0])) return 'available';
    // Only a rejection naming this candidate may advance an automatic name.
    // Errors without a candidate binding must not consume the rename attempts.
    if (!available.length && errors.length === 1 && fields.name.getAttribute('aria-invalid') === 'true' && mentionsName(errors[0])) return 'unavailable';
    return null;
  }
  async function prepare(initial) {
    let edited = false;
    let writing = false;
    const write = operation => { writing = true; try { operation(); } finally { writing = false; } };
    const onEdit = event => { if (event.isTrusted && !writing) edited = true; };
    const blockSubmit = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    initial.form.addEventListener('input', onEdit, true);
    initial.form.addEventListener('change', onEdit, true);
    initial.form.addEventListener('submit', blockSubmit, true);
    const current = () => {
      if (edited) throw new Error('你已手动修改导入信息，自动填写已停止。请从插件重新发起。');
      const fields = findForm();
      if (!fields || fields.form !== initial.form) throw new Error('导入页面已变化，请从插件重新发起。');
      return fields;
    };
    try {
      // Establish React readiness through GitHub's own rendered private state
      // before writing either controlled text field.
      for (let attempt = 0; !privateConfirmed(current()); attempt++) {
        const fields = current();
        write(() => {
          if (fields.react && (fields.privateRadio.checked || attempt > 0)) {
            // React can track checked=true while its application state is still
            // Public. A further click then produces no change. Expose unchecked
            // through a plain event (no native mouse activation), then select
            // Private normally. Submission stays blocked throughout recovery.
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set.call(fields.privateRadio, false);
            fields.privateRadio.dispatchEvent(new Event('click', { bubbles: true }));
          }
          fields.privateRadio.click();
        });
        try {
          await waitUntil(() => privateConfirmed(current()), 'GitHub 尚未确认 Private，未提交。', 1500);
        } catch (error) { if (edited || attempt >= 2) throw error; }
      }
      for (;;) {
        // Only retry while preparing. Never overwrite edits during the countdown.
        for (const [key, value] of [['source', task.sourceUrl], ['name', task.targetName]]) {
          if (key === 'name' && current().react && current().name.value) {
            const oldError = current().form.querySelector('#RepoNameInput-message')?.textContent;
            write(() => fill(current().name, ''));
            await waitUntil(() => {
              const next = current();
              return next.name.value === '' && next.name.defaultValue === '' &&
                !next.form.querySelector('#RepoNameInput-is-available') &&
                (!oldError || next.form.querySelector('#RepoNameInput-message')?.textContent !== oldError);
            }, 'GitHub 尚未重置名称检查，未提交。');
          }
          let confirmed = false;
          for (let attempt = 0; attempt < 3 && !confirmed; attempt++) {
            const fields = current();
            write(() => {
              // A previous event may have reached React's value tracker before
              // the application accepted it. Give a retry a real value change.
              if (attempt > 0) fill(fields[key], '');
              fill(fields[key], value);
            });
            try {
              await waitUntil(() => { const next = current(); return next[key].value === value && (!next.react || next[key].defaultValue === value); },
                'GitHub 没有接收到填写内容，未提交。请刷新仓库页后重新点击插件。', 1500);
              confirmed = true;
            } catch (error) { if (edited || attempt === 2) throw error; }
          }
        }
        const state = await waitUntil(() => nameState(current()), 'GitHub 尚未确认仓库名称可用，未提交。请检查页面提示后重试。');
        if (state === 'available') return verify(initial.form);
        if (!task.autoRename) throw new Error('该仓库名不可用，请在更多选项中使用其他名称。已有仓库不会被覆盖。');
        task.targetName = (await message('NEXT_IMPORT_NAME')).targetName;
      }
    } finally {
      initial.form.removeEventListener('input', onEdit, true);
      initial.form.removeEventListener('change', onEdit, true);
      initial.form.removeEventListener('submit', blockSubmit, true);
    }
  }
  function verify(expectedForm) {
    const fields = findForm();
    if (!fields || fields.form !== expectedForm || !expectedForm.isConnected) throw new Error('导入表单已变化，请从插件重新发起。');
    const { source, name, privateRadio } = fields;
    if (F2P.parseRepoUrl(source.value).cloneUrl !== task.sourceUrl || name.value !== task.targetName) throw new Error('源地址或仓库名称已改变。请检查后自行提交，或从插件重新发起。');
    if (!textConfirmed(fields)) throw new Error('GitHub 尚未接收到地址或名称，已停止提交。请从插件重新发起。');
    const values = new FormData(expectedForm).getAll(privateRadio.name);
    if (!privateRadio.checked || values.length !== 1 || values[0] !== 'private') throw new Error('未确认仓库为私有，已停止提交。请检查 Private 选项。');
    if (fields.react) {
      // Check GitHub's rendered state as well as the radio DOM property, so a
      // failed React change event cannot leave the app planning a public repo.
      if (!privateConfirmed(fields)) {
        throw new Error('GitHub 尚未确认私有状态，请检查页面的 Private 提示后重新发起。');
      }
      if (nameState(fields) !== 'available') throw new Error('GitHub 未确认目标名称可用，已停止提交。');
    }
    return fields;
  }
  function showReady(fields) {
    removeBanner();
    const banner = makeBanner('f2p-banner');
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
    if (task.automatic) {
      start.hidden = true; cancel.hidden = true;
      countdown.textContent = '校验通过，正在自动提交…';
      execute();
    } else if (task.autoSubmit) {
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
      const fields = await prepare(await waitForForm());
      showReady(fields);
    } catch (error) { fail(error); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
