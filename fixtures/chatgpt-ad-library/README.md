# ChatGPT Ad Library fixtures

Verified seed rows and the system ID catalog for the inspiration vault crawler.

- Source: https://www.chatgptadlibrary.com/library
- Never customer-visible
- `system-ids.json` — IDs the worker/server seed automatically (keep in sync with `src/lib/chatgpt-ad-library/system-ids.ts`)
- Normalize raw crawls with: `node scripts/chatgpt-ad-library-normalize-fixture.mjs raw.jsonl`

Import via `/dashboard/inspiration` or `POST /api/admin/chatgpt-ad-library/import`.
 The crawler does not need this JSONL once Auto-Scrape is on.
