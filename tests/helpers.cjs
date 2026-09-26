const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const copy = value => value === undefined ? value : structuredClone(value);
function storage(seed = {}) {
  const state = copy(seed);
  return { state, async get(keys) {
    if (keys === null) return copy(state);
    if (typeof keys === 'string') keys = [keys];
    return Object.fromEntries(keys.filter(key => key in state).map(key => [key, copy(state[key])]));
  }, async set(data) { Object.assign(state, copy(data)); }, async remove(keys) { for (const key of typeof keys === 'string' ? [keys] : keys) delete state[key]; } };
}
function worker(options = {}) {
  const local = options.local || storage({ settings: { autoSubmit: true }, history: [] });
  const session = options.session || storage();
  const tabs = new Map(); let tabCounter = 10, handler, installed, removed;
  const chrome = { runtime: { id: 'audit-extension', getURL: p => `chrome-extension://audit-extension/${p}`,
    onMessage: { addListener: fn => { handler = fn; } }, onInstalled: { addListener: fn => { installed = fn; } } },
    storage: { local, session }, tabs: {
      async create(data) { const tab = { id: ++tabCounter, ...data }; tabs.set(tab.id, tab); return copy(tab); },
      async update(id, data) { if (options.failNavigation) throw new Error('navigation failed'); Object.assign(tabs.get(id), data); return copy(tabs.get(id)); },
      async remove(id) { tabs.delete(id); }, onRemoved: { addListener: fn => { removed = fn; } }
    } };
  const ctx = vm.createContext({ chrome, URL, crypto: webcrypto, Date, console });
  ctx.importScripts = file => vm.runInContext(read(file), ctx, { filename: file });
  vm.runInContext(read('background.js'), ctx, { filename: 'background.js' });
  const popup = { id: chrome.runtime.id, url: chrome.runtime.getURL('popup.html') };
  function send(request, sender = popup) { return new Promise(resolve => handler(copy(request), sender, resolve)); }
  async function start(name = 'demo-private', extra = {}) {
    const result = await send({ action: 'START_IMPORT', data: { sourceUrl: 'https://github.com/example/demo', targetName: name, ...extra } });
    if (!result.success) return result;
    const tab = tabs.get(result.tabId);
    const taskId = new URLSearchParams(new URL(tab.url).hash.slice(1)).get('f2p_task');
    return { ...result, taskId, historyId: session.state['f2p-task:' + taskId].historyId };
  }
  const sender = (tabId, doc = 'document-one') => ({ id: chrome.runtime.id, tab: { id: tabId }, frameId: 0, documentId: doc, url: 'https://github.com/new/import' });
  return { local, session, tabs, chrome, send, start, sender, installed: () => installed(), removed: id => removed(id), restart: () => worker({ local, session }) };
}
async function until(condition, message = 'condition did not become true') {
  for (let i = 0; i < 120; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error(message);
}
module.exports = { root, read, storage, worker, until };
