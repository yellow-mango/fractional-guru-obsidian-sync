# Fractional Guru Sync for Obsidian

Sync **only the Markdown notes and folders you choose** from the current Obsidian vault into your Fractional Guru knowledge base. This is a one-way integration: Obsidian remains the source of truth, and the plugin never edits your local notes.

> **Integration status:** The backend routes in [`server-contract/INTEGRATION.md`](server-contract/INTEGRATION.md) are live at `https://fractional.guru`. Create an integration token under **Knowledge → Connected sources → Get an integration token** and paste it into the plugin's settings. Real-vault acceptance testing across desktop and mobile is still outstanding.

## Features

- Explicitly select folders (including nested Markdown notes) and/or individual Markdown files; nothing is selected by default.
- Connect with a scoped Fractional Guru integration token; credentials are never placed in URLs.
- Confirm the first upload before any note leaves the vault.
- Manual sync, plus optional automatic sync after approval (periodic and edit-triggered).
- Incremental SHA-256 change detection; retries avoid marking unacknowledged items as synced.
- Propagates deletion of previously uploaded local notes, but **removing a selection or disconnecting does not delete remote knowledge**.
- Maximum size: 1 MB per Markdown note. Non-Markdown attachments, PDFs, bidirectional sync and merge/conflict resolution are deliberately out of scope for v0.1.
- Desktop/mobile-compatible design using the Obsidian API and standard Web Crypto; **actual mobile runtime testing remains outstanding**.

## Install

Install **Fractional Guru Sync** from the community directory: in Obsidian open **Settings → Community plugins → Browse**, search for the plugin, install it and enable it. It is listed at [community.obsidian.md/plugins/fractional-guru-sync](https://community.obsidian.md/plugins/fractional-guru-sync).

To install manually instead, create `.obsidian/plugins/fractional-guru-sync/` in the **vault that you want to connect**, copy `main.js`, `manifest.json` and `styles.css` from this project into that folder, and restart or reload Obsidian.

Then, either way:

1. On fractional.guru open **Knowledge → Connected sources → Get an integration token** and create a token.
2. Paste it into the plugin's **Integration token** setting and press **Connect / verify**.
3. Select folders or notes, choose **Sync selected notes**, carefully review the first-sync confirmation, then optionally enable automatic syncing.

**Vault selection:** Obsidian plugins run within the vault where installed; install the plugin in each vault you intend to connect. Each installation generates a vault-specific ID and has independent folder/note selections and token settings.

## Privacy and security

Only selected Markdown note content and paths are sent to the configured server, through HTTPS by default. Integration tokens and a local sync manifest are stored in Obsidian's local plugin `data.json`, which may be included in any sync or backup system that copies `.obsidian/`; protect that file. Use a short-lived/revocable scoped token if the platform supports it and revoke it if exposed. Do not select notes containing secrets or information you do not have permission to share. The platform must determine visibility independently; default new notes to private.

Deleting a local note which was previously synced queues removal from Fractional Guru on the next successful sync. **Deselecting a folder or note, or disconnecting, never deletes its remote copy.** Manage remote knowledge separately from your Guru account. Note files over 1 MB are skipped; check the desktop console if automatic sync errors occur.

## Development and tests

No build step or external runtime dependencies are required: `main.js` is the deployable source. With Node.js 20+ run `npm test` to execute the mocked API and selection tests. The repository never needs to contain a real token.

## Releases

Obsidian installs from a GitHub release, and the rules are strict:

1. Keep `README.md`, `LICENSE`, `manifest.json` and `versions.json` at the repository root.
2. Create a release whose tag is **exactly** the `manifest.json` `version`, with no `v` prefix, and attach **`main.js`, `manifest.json` and `styles.css`** as individual release assets.
3. For each new version, bump `manifest.json`, add the matching entry to `versions.json`, and repeat.

A release with no assets, or a tag that does not match the manifest version, produces a listing that cannot be installed from inside Obsidian.
