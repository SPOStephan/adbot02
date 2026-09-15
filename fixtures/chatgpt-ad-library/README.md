# ChatGPT Ad Library fixtures

Verified seed rows for admin import into the inspiration vault.

- Source: https://www.chatgptadlibrary.com/library
- Never customer-visible
- Normalize raw crawls with: `node scripts/chatgpt-ad-library-normalize-fixture.mjs raw.jsonl`

Import via `/dashboard/inspiration` or `POST /api/admin/chatgpt-ad-library/import`.
