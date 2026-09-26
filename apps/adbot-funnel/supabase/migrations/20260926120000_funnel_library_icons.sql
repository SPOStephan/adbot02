-- Globale Adbot-Icon-Bibliothek für Funnel-Kacheln und Antworten.
-- Nutzer beauftragen fehlende Symbole; SVG wird zur Bibliothek.

create table if not exists public.funnel_library_icons (
  id text primary key
    check (id ~ '^adbot-custom-[a-z0-9-]{4,48}$'),
  label text not null
    check (char_length(btrim(label)) between 2 and 80),
  svg text not null
    check (char_length(svg) between 20 and 20000),
  aliases jsonb not null default '[]'::jsonb,
  status text not null default 'requested'
    check (status in ('ready', 'requested')),
  request_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.funnel_library_icons is
  'Customer-commissioned Funnel icons. Built-in Lucide/Adbot symbols stay in code.';

alter table public.funnel_library_icons enable row level security;

revoke all on table public.funnel_library_icons from anon, authenticated;
grant select, insert, update, delete on table public.funnel_library_icons to service_role;
