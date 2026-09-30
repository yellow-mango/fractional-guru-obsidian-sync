const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { webcrypto } = require('node:crypto');
globalThis.crypto = webcrypto;
let mockRequest;
class Base { constructor(app) { this.app = app; } addSettingTab() {} addRibbonIcon() {} addCommand() {} registerEvent() {} registerInterval() {} async loadData() { return this._stored || {}; } async saveData(v) { this._stored = structuredClone(v); } }
class FakeModal { constructor(app) { this.app = app; this.titleEl = { setText() {} }; this.contentEl = { createEl() { return {}; }, empty() {} }; } open() { if (this.constructor.name === 'ConfirmFirstSyncModal') this.finish(true); } close() {} }
class FakeFuzzy { constructor(app) { this.app = app; } setPlaceholder() {} }
const nativeLoad = Module._load;
Module._load = function(id, ...rest) { if (id === 'obsidian') return { Plugin: Base, PluginSettingTab: class {}, Setting: class {}, Notice: class {}, Modal: FakeModal, FuzzySuggestModal: FakeFuzzy, TFolder: class {}, TFile: class {}, requestUrl: async opts => mockRequest(opts) }; return nativeLoad.call(this, id, ...rest); };
const Plugin = require('../main.js');
Module._load = nativeLoad;
const { covered, normaliseEndpoint, hashText } = Plugin._test;
function setup(files) {
  const notes = new Map(Object.entries(files));
  const requests = [];
  mockRequest = async request => {
    requests.push(request);
    if (request.url.endsWith('/connection')) return { status: 200, json: { guruId: 'guru-test', guruName: 'Test guru' } };
    const data = JSON.parse(request.body);
    return { status: 200, json: { accepted: data.items.map(({path,type})=>({path,type})) } };
  };
  const app = { vault: { on() { return {}; }, getMarkdownFiles() { return [...notes].map(([path, content]) => ({path, stat:{size:Buffer.byteLength(content)}})); }, cachedRead: async ({path}) => notes.get(path), getAbstractFileByPath: path => notes.has(path) ? {path} : null } };
  const plugin = new Plugin(app);
  return { plugin, notes, requests };
}
test('endpoint validation rejects insecure and credentialed URLs', () => {
  assert.equal(normaliseEndpoint('https://fractional.guru'), 'https://fractional.guru');
  assert.equal(normaliseEndpoint('http://localhost:3000'), 'http://localhost:3000');
  assert.throws(() => normaliseEndpoint('http://example.com'));
  assert.throws(() => normaliseEndpoint('https://user:pass@example.com'));
  assert.throws(() => normaliseEndpoint('https://example.com/hidden'));
});
test('only explicitly selected Markdown notes are covered', () => {
  const s = { folders: ['Business'], files: ['Other/allowed.md'] };
  assert.equal(covered('Business/nested/ok.md', s), true);
  assert.equal(covered('Other/allowed.md', s), true);
  assert.equal(covered('Business/private.pdf', s), false);
  assert.equal(covered('Business2/no.md', s), false);
});
test('SHA-256 content fingerprints are deterministic', async () => {
  assert.equal((await hashText('hello')).length, 64);
  assert.equal(await hashText('hello'), await hashText('hello'));
  assert.notEqual(await hashText('hello'), await hashText('world'));
});
test('first sync, incremental updates, vault deletions and deselection', async () => {
  const { plugin, notes, requests } = setup({ 'Business/a.md':'A', 'Business/b.md':'B', 'Private/secret.md':'private' });
  await plugin.onload();
  plugin.settings.folders = ['Business'];
  plugin.settings.token = 'test-token';
  await plugin.connect();
  await plugin.sync(true);
  let uploads = requests.filter(r => r.method === 'POST');
  assert.equal(uploads.length, 1);
  assert.deepEqual(JSON.parse(uploads[0].body).items.map(x=>x.path), ['Business/a.md','Business/b.md']);
  assert.equal(JSON.parse(uploads[0].body).items.some(x=>x.content === 'private'), false);
  await plugin.sync(true);
  assert.equal(requests.filter(r=>r.method === 'POST').length, 1);
  notes.set('Business/a.md', 'A2');
  await plugin.sync(true);
  uploads = requests.filter(r=>r.method === 'POST');
  assert.deepEqual(JSON.parse(uploads[1].body).items.map(x=>x.path), ['Business/a.md']);
  notes.delete('Business/b.md');
  await plugin.sync(true);
  uploads = requests.filter(r=>r.method === 'POST');
  assert.deepEqual(JSON.parse(uploads[2].body).items, [{type:'delete',path:'Business/b.md'}]);
  plugin.settings.folders = [];
  plugin.settings.files = ['Business/a.md'];
  await plugin.sync(true);
  assert.equal(requests.filter(r=>r.method === 'POST').length, 3);
});
test('unacknowledged items do not advance local state', async () => {
  const { plugin } = setup({ 'A/note.md':'hello' });
  await plugin.onload();
  plugin.settings.folders = ['A']; plugin.settings.token = 'token';
  await plugin.connect();
  mockRequest = async request => request.method === 'POST' ? { status: 200, json: {accepted:[]} } : { status:200,json:{guruId:'guru-test'} };
  await plugin.sync(true);
  assert.deepEqual(plugin.settings.synced, {});
});
