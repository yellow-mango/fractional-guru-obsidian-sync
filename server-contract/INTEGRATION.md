# Fractional Guru: Obsidian sync backend integration

The plugin is complete client-side. **Do not publish/enable connection in production until the platform implements these routes and integration-token management.** The routes below are the exact contract used by `main.js`.

## Authentication and tenancy

Implement an **Obsidian integration token** issued from the logged-in Guru's Fractional Guru account. Prefer a 256-bit random opaque token. Only show it at creation. Store a one-way hash server-side (never log plaintext); bind it to the Guru and a `knowledge:write` scope; expose revoke and rotate controls. Rate-limit by token/Guru/IP. Audit connect, accepted upserts/deletes and token revocation. `GET /connection` must derive the Guru from the validated token, never accept Guru identifiers from the client. Keep CORS unnecessary when using Obsidian `requestUrl`; do not use `Access-Control-Allow-Origin: *` with secrets.

## Routes

`GET /api/integrations/obsidian/v1/connection`

Headers: `Authorization: Bearer <integration-token>`.

200 response:
```json
{ "guruId": "your-internal-guru-id", "guruName": "Display name" }
```

`POST /api/integrations/obsidian/v1/sync`

Headers: `Authorization: Bearer <integration-token>`, `Content-Type: application/json`.

Request:
```json
{
  "vaultId": "58f2c73b-1398-482d-954e-a7e51a18f4cb",
  "items": [
    { "type": "upsert", "path": "Public/Strategy.md", "content": "# Strategy...", "sha256": "64-character-lowercase-sha256" },
    { "type": "delete", "path": "Old note.md" }
  ]
}
```

Successful 200 response:
```json
{
  "accepted": [
    { "type": "upsert", "path": "Public/Strategy.md" },
    { "type": "delete", "path": "Old note.md" }
  ]
}
```

Server requirements:

1. Validate `vaultId` as UUID; `items` as 1–20 entries; `path` as a non-empty vault-relative Markdown path (reject traversal, null bytes, absolute paths, duplicate type/path pairs and unexpected keys). Reject oversize request bodies and content above 1 MB per note.
2. For upserts, validate the supplied SHA-256 against UTF-8 content, then update by **(authenticated guru ID, source=`obsidian`, vault ID, exact path)**. Never trust a client-supplied Guru ID.
3. Commit note metadata and ingestion/indexing through existing knowledge services. Queue background chunking/embedding if that is how the platform works. Define `accepted` as *durably ingested or durably queued*, not merely received.
4. For deletes, only delete/retire the matching Obsidian-sourced note belonging to this authenticated Guru, vault and path. Do not delete any independently uploaded or other-source knowledge. Ensure downstream search vectors are invalidated. Make repeated upserts/deletes idempotent.
5. Return `accepted` for **all** items only when they are durably accepted. Otherwise return a non-2xx error with no side effects (transaction), or a partial `accepted` list if partial processing is unavoidable; the plugin retries unacknowledged items. **Prefer atomic batches.**
6. Assign private/default visibility to new knowledge; never auto-publish the note to public agent answers. Retain source metadata so the Guru can change visibility, review, retire or delete in the existing knowledge UI.
7. Require HTTPS in production; use existing application logging redaction. Provide a per-integration data removal action on the platform. A revoked token must return HTTP 401/403.
8. Avoid indexing duplicate entries when retries follow a timeout. Keep stable source IDs independent of content changes.

## Suggested database record

`guru_knowledge_sources`: `guru_id`, `source_type='obsidian'`, `vault_id`, `source_path`, `sha256`, `knowledge_document_id`, `last_synced_at`, `status`. Unique key `(guru_id, source_type, vault_id, source_path)`.

**Important:** the Obsidian client's `synced` map is a cache, not an authority. The backend must own all access control, document ownership and security decisions.

## Engineering acceptance checks

- Guru A's token cannot see, write, or delete Guru B's knowledge, including if they provide the same vault ID and path.
- An invalid/revoked token gets 401/403; rate limits and large payloads are enforced.
- Upload the same item twice: one stable source document; update its content and vectors on hash change.
- Delete only a matching Obsidian source. Nonexistent delete is safe/idempotent.
- Newly ingested private knowledge is unavailable to anonymous/public querying until the Guru explicitly changes visibility.
- Fail a batch and retry it: no missing documents or duplicate knowledge.
