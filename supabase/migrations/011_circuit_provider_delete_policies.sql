-- circuits and providers only had select/insert/update RLS policies; with row
-- level security enabled and no delete policy, any DELETE is denied outright
-- regardless of role. Add delete policies matching the existing insert/update
-- scope (admin or operations_editor) so the new delete actions in the admin UI
-- actually work.
create policy circuits_delete_admin_editor on public.circuits for delete using (public.is_admin_or_editor());
create policy providers_delete_admin_editor on public.providers for delete using (public.is_admin_or_editor());
