<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## User delivery preferences

When a change includes a **Supabase SQL migration** the user must apply manually:

- Always include both links in the same turn you mention the migration — do not wait to be asked:
  - GitHub blob (readable): `https://github.com/SPOStephan/adbot02/blob/<branch>/supabase/migrations/<file>.sql`
  - Raw (copy-paste into Supabase SQL Editor): `https://raw.githubusercontent.com/SPOStephan/adbot02/<branch>/supabase/migrations/<file>.sql`
- Prefer the feature branch that contains the migration until it is on `main`.
