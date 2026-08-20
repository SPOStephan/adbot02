-- Binding/origin metadata for global domain registry (portal Supabase).
-- Tool host routing stays in Funnel/Freebie DBs; this is visibility + campaign URLs only.

begin;

alter table public.customer_custom_domains
  add column if not exists origin text not null default 'portal'
    check (origin in ('portal', 'funnel', 'freebie'));

alter table public.customer_custom_domains
  add column if not exists binding_kind text not null default 'none'
    check (binding_kind in ('none', 'funnel', 'freebie'));

alter table public.customer_custom_domains
  add column if not exists binding_ref text
    check (
      binding_ref is null
      or char_length(binding_ref) between 1 and 80
    );

alter table public.customer_custom_domains
  add column if not exists binding_label text not null default ''
    check (char_length(binding_label) <= 160);

alter table public.customer_custom_domains
  add column if not exists tool_domain_id uuid;

-- Allow authenticated reads of new binding columns (service_role still writes).
grant select on table public.customer_custom_domains to authenticated;

comment on column public.customer_custom_domains.origin is
  'Where the hostname was first registered: portal UI, Funnel admin, or Freebie admin.';
comment on column public.customer_custom_domains.binding_kind is
  'Which tool currently hosts/routes this hostname (none = registry only / campaign destination).';

commit;
