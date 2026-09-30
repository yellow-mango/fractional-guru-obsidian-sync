/* Fractional Guru Sync — Obsidian community plugin. No external dependencies. */
const { Plugin, PluginSettingTab, Setting, Notice, Modal, FuzzySuggestModal, TFolder, TFile, requestUrl } = require('obsidian');
const API_PATH = '/api/integrations/obsidian/v1';
const DEFAULT_SETTINGS = { endpoint: 'https://fractional.guru', token: '', folders: [], files: [], autoSync: false, intervalMinutes: 5, vaultId: '', synced: {}, connectedGuruId: '', connectedGuruName: '', initialSyncApproved: false, lastSyncedAt: null, connectedOrigin: '' };
const MAX_NOTE_BYTES = 1024 * 1024;
const BATCH_SIZE = 20;

function normaliseEndpoint(raw) {
  const url = new URL(raw.trim());
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Enter a base URL only, without a path, query or credentials.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('A secure HTTPS connection is required.');
  return url.origin;
}
function covered(path, settings) {
  if (!path.toLowerCase().endsWith('.md')) return false;
  return settings.files.includes(path) || settings.folders.some(folder => path.startsWith(folder + '/'));
}
async function hashText(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, '0')).join('');
}
class ChooseFolderModal extends FuzzySuggestModal {
  constructor(app, onChoose) { super(app); this.onChoose = onChoose; this.setPlaceholder('Select a folder to sync'); }
  getItems() { return this.app.vault.getAllLoadedFiles().filter(f => f instanceof TFolder && f.path !== '/'); }
  getItemText(folder) { return folder.path; }
  onChooseItem(folder) { this.onChoose(folder.path); }
}
class ChooseFileModal extends FuzzySuggestModal {
  constructor(app, onChoose) { super(app); this.onChoose = onChoose; this.setPlaceholder('Select a Markdown note to sync'); }
  getItems() { return this.app.vault.getMarkdownFiles(); }
  getItemText(file) { return file.path; }
  onChooseItem(file) { this.onChoose(file.path); }
}
class ConfirmFirstSyncModal extends Modal {
  constructor(app, count, callback) { super(app); this.count = count; this.callback = callback; this.resolved = false; }
  finish(answer) { if (this.resolved) return; this.resolved = true; this.callback(answer); }
  onOpen() {
    this.titleEl.setText('Confirm first sync');
    this.contentEl.createEl('p', { text: `Fractional Guru will receive up to ${this.count} selected Markdown notes from this vault. Files are sent only after you confirm. Your local notes will never be modified.` });
    this.contentEl.createEl('p', { text: 'Only choose notes you are permitted to share. Review sensitive information and your Fractional Guru knowledge visibility settings.' });
    new Setting(this.contentEl).addButton(button => button.setButtonText('Cancel').onClick(() => { this.finish(false); this.close(); }))
      .addButton(button => button.setButtonText('Confirm and sync').setCta().onClick(() => { this.finish(true); this.close(); }));
  }
  onClose() { this.finish(false); this.contentEl.empty(); }
}
class FractionalGuruSync extends Plugin {
  async onload() {
    this.settings = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), await this.loadData());
    this.settings.folders = Array.isArray(this.settings.folders) ? this.settings.folders : [];
    this.settings.files = Array.isArray(this.settings.files) ? this.settings.files : [];
    this.settings.synced = this.settings.synced && typeof this.settings.synced === 'object' ? this.settings.synced : {};
    if (!this.settings.vaultId) { this.settings.vaultId = globalThis.crypto.randomUUID(); await this.saveSettings(); }
    this.syncInProgress = false;
    this.debounceTimer = null;
    this.intervalId = null;
    this.addSettingTab(new FractionalGuruSettingsTab(this.app, this));
    this.addRibbonIcon('refresh-cw', 'Sync selected notes to Fractional Guru', () => this.sync(true));
    this.addCommand({ id: 'sync-selected-notes', name: 'Sync selected notes now', callback: () => this.sync(true) });
    this.registerEvent(this.app.vault.on('modify', f => this.scheduleSync(f.path)));
    this.registerEvent(this.app.vault.on('create', f => this.scheduleSync(f.path)));
    this.registerEvent(this.app.vault.on('delete', f => this.scheduleSync(f.path, true)));
    this.registerEvent(this.app.vault.on('rename', (f, oldPath) => { this.scheduleSync(oldPath, true); this.scheduleSync(f.path); }));
    this.configureTimer();
  }
  onunload() { if (this.debounceTimer) clearTimeout(this.debounceTimer); if (this.intervalId) clearInterval(this.intervalId); }
  async saveSettings() { await this.saveData(this.settings); }
  configureTimer() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = null;
    if (this.settings.autoSync) {
      this.intervalId = setInterval(() => this.sync(false), Math.max(1, this.settings.intervalMinutes) * 60 * 1000);
      this.registerInterval(this.intervalId);
    }
  }
  scheduleSync(path, deletion = false) {
    if (!this.settings.autoSync || !this.settings.initialSyncApproved || !this.settings.token) return;
    if (!covered(path, this.settings) && !(deletion && this.settings.synced[path])) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => this.sync(false), 4500);
  }
  apiBase() { return normaliseEndpoint(this.settings.endpoint) + API_PATH; }
  async apiRequest(method, suffix, body) {
    const url = this.apiBase() + suffix;
    const options = { url, method, headers: { Authorization: 'Bearer ' + this.settings.token.trim(), Accept: 'application/json' }, throw: false };
    if (body !== undefined) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    const result = await requestUrl(options);
    if (result.status === 401 || result.status === 403) throw new Error('Connection refused. Reconnect with a valid Fractional Guru token.');
    if (result.status < 200 || result.status >= 300) throw new Error('Fractional Guru returned HTTP ' + result.status + '.');
    if (!result.json || typeof result.json !== 'object') throw new Error('Unexpected API response.');
    return result.json;
  }
  async connect() {
    if (!this.settings.token.trim()) throw new Error('Paste an integration token first.');
    const info = await this.apiRequest('GET', '/connection');
    if (!info.guruId || typeof info.guruId !== 'string') throw new Error('Invalid connection response from Fractional Guru.');
    if ((this.settings.connectedGuruId && this.settings.connectedGuruId !== info.guruId) || (this.settings.connectedOrigin && this.settings.connectedOrigin !== normaliseEndpoint(this.settings.endpoint))) {
      this.settings.synced = {}; this.settings.initialSyncApproved = false;
    }
    this.settings.connectedGuruId = info.guruId;
    this.settings.connectedOrigin = normaliseEndpoint(this.settings.endpoint);
    this.settings.connectedGuruName = String(info.guruName || 'Your Guru account');
    await this.saveSettings();
    return this.settings.connectedGuruName;
  }
  disconnect() {
    this.settings.token = '';
    this.settings.connectedGuruId = '';
    this.settings.connectedOrigin = '';
    this.settings.connectedGuruName = '';
    this.settings.autoSync = false;
    this.settings.initialSyncApproved = false;
    this.settings.synced = {};
    this.configureTimer();
    return this.saveSettings();
  }
  async sync(showNotices = false) {
    if (this.syncInProgress) { if (showNotices) new Notice('Fractional Guru sync is already running.'); return; }
    if (!this.settings.token || !this.settings.connectedGuruId) { if (showNotices) new Notice('Connect Fractional Guru in plugin settings first.'); return; }
    if (!this.settings.folders.length && !this.settings.files.length) { if (showNotices) new Notice('Choose at least one folder or note first.'); return; }
    this.syncInProgress = true;
    try {
      const files = this.app.vault.getMarkdownFiles().filter(f => covered(f.path, this.settings));
      if (!this.settings.initialSyncApproved) {
        if (!showNotices) return;
        const approved = await new Promise(resolve => new ConfirmFirstSyncModal(this.app, files.length, resolve).open());
        if (!approved) return;
        this.settings.initialSyncApproved = true;
        await this.saveSettings();
      }
      const currentPaths = new Set(files.map(f => f.path));
      const changed = [];
      const skipped = [];
      for (const file of files) {
        if (file.stat.size > MAX_NOTE_BYTES) { skipped.push(file.path); continue; }
        const content = await this.app.vault.cachedRead(file);
        if (new TextEncoder().encode(content).byteLength > MAX_NOTE_BYTES) { skipped.push(file.path); continue; }
        const sha256 = await hashText(content);
        if (this.settings.synced[file.path] !== sha256) changed.push({ path: file.path, content, sha256 });
      }
      // Tombstones only represent previously uploaded notes that no longer exist in the vault.
      // Deselecting folders/notes never deletes remote knowledge.
      const deleted = Object.keys(this.settings.synced).filter(path => !currentPaths.has(path) && !this.app.vault.getAbstractFileByPath(path));
      if (!changed.length && !deleted.length) {
        if (showNotices) new Notice(skipped.length ? `No changes. ${skipped.length} notes exceed the 1 MB limit.` : 'Fractional Guru knowledge is up to date.');
        return;
      }
      let updatedCount = 0; let deletedCount = 0;
      const actions = [...changed.map(note => ({ type: 'upsert', ...note })), ...deleted.map(path => ({ type: 'delete', path }))];
      for (let i = 0; i < actions.length; i += BATCH_SIZE) {
        const batch = actions.slice(i, i + BATCH_SIZE);
        const result = await this.apiRequest('POST', '/sync', { vaultId: this.settings.vaultId, items: batch });
        if (!Array.isArray(result.accepted) || result.accepted.length !== batch.length || !batch.every(a => result.accepted.some(b => b.path === a.path && b.type === a.type))) {
          throw new Error('The server did not acknowledge every item; remaining items will be retried.');
        }
        for (const item of batch) {
          if (item.type === 'upsert') { this.settings.synced[item.path] = item.sha256; updatedCount++; }
          else { delete this.settings.synced[item.path]; deletedCount++; }
        }
        await this.saveSettings();
      }
      this.settings.lastSyncedAt = new Date().toISOString();
      await this.saveSettings();
      if (showNotices) new Notice(`Fractional Guru: ${updatedCount} notes updated, ${deletedCount} removed.${skipped.length ? ` ${skipped.length} oversized notes skipped.` : ''}`);
    } catch (e) {
      console.error('Fractional Guru sync failed:', e instanceof Error ? e.message : 'Unknown error');
      if (showNotices || this.settings.autoSync) new Notice('Fractional Guru sync failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
    } finally { this.syncInProgress = false; }
  }
}
class FractionalGuruSettingsTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl, plugin } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Fractional Guru Sync' });
    containerEl.createEl('p', { text: 'Choose exactly what to share. This is one-way sync: selected Markdown notes are uploaded to your Fractional Guru knowledge; Obsidian is never changed.' });
    new Setting(containerEl).setName('Fractional Guru URL').setDesc('Use the official site unless you run an approved self-hosted instance.')
      .addText(text => text.setPlaceholder('https://fractional.guru').setValue(plugin.settings.endpoint).onChange(async value => { plugin.settings.endpoint = value; plugin.settings.connectedGuruId = ''; plugin.settings.connectedOrigin = ''; plugin.settings.synced = {}; plugin.settings.initialSyncApproved = false; plugin.settings.autoSync = false; plugin.configureTimer(); await plugin.saveSettings(); }));
    new Setting(containerEl).setName('Integration token').setDesc('Generate a scoped Obsidian integration token from your Guru account. It is saved in this vault’s local plugin settings; protect and avoid sharing that folder.')
      .addText(text => { text.inputEl.type = 'password'; text.setPlaceholder('Paste integration token').setValue(plugin.settings.token).onChange(async value => { if (value !== plugin.settings.token) { plugin.settings.connectedGuruId = ''; plugin.settings.connectedOrigin = ''; plugin.settings.synced = {}; plugin.settings.autoSync = false; plugin.settings.initialSyncApproved = false; plugin.configureTimer(); } plugin.settings.token = value; await plugin.saveSettings(); }); });
    new Setting(containerEl).setName('Connection').setDesc(plugin.settings.connectedGuruId ? `Connected to ${plugin.settings.connectedGuruName}` : 'Not connected')
      .addButton(button => button.setButtonText('Connect / verify').onClick(async () => { try { const name = await plugin.connect(); new Notice(`Connected to ${name}.`); this.display(); } catch (e) { new Notice(e.message || 'Connection failed.'); } }))
      .addButton(button => button.setButtonText('Disconnect').setWarning().onClick(async () => { await plugin.disconnect(); new Notice('Disconnected. Remote knowledge is unchanged.'); this.display(); }));
    containerEl.createEl('h3', { text: 'What to sync' });
    containerEl.createEl('p', { text: 'Nothing is selected by default. Select entire folders or individual notes. Newly added Markdown files in selected folders are included automatically.' });
    new Setting(containerEl).setName('Selected folders').addButton(button => button.setButtonText('Add folder').onClick(() => new ChooseFolderModal(this.app, async path => { if (!plugin.settings.folders.includes(path)) { plugin.settings.folders.push(path); await plugin.saveSettings(); } this.display(); }).open()));
    for (const path of plugin.settings.folders) new Setting(containerEl).setName(path).addButton(button => button.setButtonText('Remove').onClick(async () => { plugin.settings.folders = plugin.settings.folders.filter(p => p !== path); await plugin.saveSettings(); this.display(); }));
    new Setting(containerEl).setName('Selected notes').addButton(button => button.setButtonText('Add note').onClick(() => new ChooseFileModal(this.app, async path => { if (!plugin.settings.files.includes(path)) { plugin.settings.files.push(path); await plugin.saveSettings(); } this.display(); }).open()));
    for (const path of plugin.settings.files) new Setting(containerEl).setName(path).addButton(button => button.setButtonText('Remove').onClick(async () => { plugin.settings.files = plugin.settings.files.filter(p => p !== path); await plugin.saveSettings(); this.display(); }));
    containerEl.createEl('h3', { text: 'Sync' });
    new Setting(containerEl).setName('Sync now').setDesc(plugin.settings.lastSyncedAt ? 'Last completed: ' + new Date(plugin.settings.lastSyncedAt).toLocaleString() : 'No completed sync yet.')
      .addButton(button => button.setButtonText('Sync selected notes').setCta().onClick(() => plugin.sync(true)));
    new Setting(containerEl).setName('Automatic sync').setDesc('After first-sync approval, check changes every five minutes and shortly after note edits. Off by default.')
      .addToggle(toggle => toggle.setValue(plugin.settings.autoSync).onChange(async value => { if (value && !plugin.settings.initialSyncApproved) { new Notice('Complete a manual first sync before enabling automatic sync.'); this.display(); return; } plugin.settings.autoSync = value; plugin.configureTimer(); await plugin.saveSettings(); }));
    containerEl.createEl('p', { cls: 'fg-sync-disclosure', text: 'Sync is one-way. Deleting a previously uploaded note from your vault removes it from Fractional Guru on the next sync. Deselecting a note does not delete remote content. Disconnecting does not delete previously uploaded knowledge. Maximum note size: 1 MB.' });
  }
}
module.exports = FractionalGuruSync;
module.exports._test = { covered, normaliseEndpoint, hashText, DEFAULT_SETTINGS };
