-- Allow account-wide Funnel binding (one hostname, all funnels via /f/:slug).

begin;

alter table public.customer_custom_domains
  drop constraint if exists customer_custom_domains_binding_kind_check;

alter table public.customer_custom_domains
  add constraint customer_custom_domains_binding_kind_check
  check (binding_kind in ('none', 'funnel', 'freebie', 'account'));

comment on column public.customer_custom_domains.binding_kind is
  'none = registry only; funnel = one Funnel root; account = all Funnels of the account via /f/:slug; freebie = one Freebie.';

commit;
