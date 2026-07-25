-- AdBot: Die Auth-Synchronisationsfunktion darf ausschließlich als interner
-- Datenbank-Trigger laufen und niemals als öffentliches PostgREST-RPC dienen.

revoke all on function public.handle_new_auth_user() from public;
revoke all on function public.handle_new_auth_user() from anon;
revoke all on function public.handle_new_auth_user() from authenticated;
