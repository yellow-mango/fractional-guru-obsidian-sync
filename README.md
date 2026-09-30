# Fractional Guru Sync for Obsidian

Sync **only the Markdown notes and folders you choose** from the current Obsidian vault into your Fractional Guru knowledge base. This is a one-way integration: Obsidian remains the source of truth, and the plugin never edits your local notes.

> **Integration status:** This repository contains a working Obsidian client and mocked client-side tests. Real end-to-end sync requires the Fractional Guru backend endpoints and token issuance described in [`server-contract/INTEGRATION.md`](server-contract/INTEGRATION.md). Do not publish as fully working until those routes are deployed and real-vault acceptance testing is complete.

## Features

- Explicitly select folders (including nested Markdown notes) and/or individual Markdown files; nothing is selected by default.
- Connect with a scoped Fractional Guru integration token; credentials are never placed in URLs.
- Confirm the first upload before any note leaves the vault.
- Manual sync, plus optional automatic sync after approval (periodic and edit-triggered).
- Incremental SHA-256 change detection; retries avoid marking unacknowledged items as synced.
- Propagates deletion of previously uploaded local notes, but **removing a selection or disconnecting does not delete remote knowledge**.
- Maximum size: 1 MB per Markdown note. Non-Markdown attachments, PDFs, bidirectional sync and merge/conflict resolution are deliberately out of scope for v0.1.
- Desktop/mobile-compatible design using the Obsidian API and standard Web Crypto; **actual mobile runtime testing remains outstanding**.

## Install locally for testing

1. Create `.obsidian/plugins/fractional-guru-sync/` in the **vault that you want to connect**.
2. Copy `main.js`, `manifest.json` and `styles.css` from this project into that folder.
3. Restart or reload Obsidian; in Settings > Community plugins enable **Fractional Guru Sync**.
4. When your Fractional Guru account exposes Obsidian integration tokens, generate one from the Guru's account and paste it in plugin settings. Verify the connection.
5. Select folders or notes, choose **Sync selected notes**, carefully review the first-sync confirmation, then optionally enable automatic syncing.

**Vault selection:** Obsidian plugins run within the vault where installed; install the plugin in each vault you intend to connect. Each installation generates a vault-specific ID and has independent folder/note selections and token settings.

## Privacy and security

Only selected Markdown note content and paths are sent to the configured server, through HTTPS by default. Integration tokens and a local sync manifest are stored in Obsidian's local plugin `data.json`, which may be included in any sync or backup system that copies `.obsidian/`; protect that file. Use a short-lived/revocable scoped token if the platform supports it and revoke it if exposed. Do not select notes containing secrets or information you do not have permission to share. The platform must determine visibility independently; default new notes to private.

Deleting a local note which was previously synced queues removal from Fractional Guru on the next successful sync. **Deselecting a folder or note, or disconnecting, never deletes its remote copy.** Manage remote knowledge separately from your Guru account. Note files over 1 MB are skipped; check the desktop console if automatic sync errors occur.

## Development and tests

No build step or external runtime dependencies are required: `main.js` is the deployable source. With Node.js 20+ run `npm test` to execute the mocked API and selection tests. The repository never needs to contain a real token.

## Publish to the Obsidian Community Plugins directory

Once the backend and real-world tests are complete:

1. Publish this folder (excluding local `data.json`) as a public GitHub repository; keep `README.md`, `LICENSE`, `manifest.json` and `versions.json` at its root.
2. Make a GitHub release tagged exactly `0.1.0` (without `v`) and attach **`main.js`, `manifest.json` and `styles.css`** as individual release assets.
3. Sign in to the Obsidian community portal, link your GitHub account and submit the plugin for review at https://community.obsidian.md. Fix any automated or human review feedback before public release.

Check current Obsidian official guidelines before submission: https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin and https://docs.obsidian.md/community-directory/submission-requirements-for-plugins . This ZIP is an installable **development package**, not evidence of approval or live backend compatibility.
