-- Legal page bodies are plain text. Strip leftover Markdown heading markers
-- (# / ##) that were shown literally on public pages and in the editor.

begin;

update public.site_legal_pages
set
  body = trim(both E'\n' from regexp_replace(body, '^#{1,6}[ \t]+', '', 'gn')),
  updated_at = now()
where body ~ '(?n)^#{1,6}[ \t]+';

commit;
