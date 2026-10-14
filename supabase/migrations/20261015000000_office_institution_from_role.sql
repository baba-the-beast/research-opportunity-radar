-- A research office's institution comes from its role (app_metadata.institution, set with
-- scripts/set_role.py), which only the service role can change. Before this it came from the
-- office's own profile, so an office could edit its profile to write notes for, and read pilot
-- counts of, another institution. Faculty still belong to the institution named in their profile.
-- The write policy on institution_call_notes, pilot_metrics() and my_institution_faculty_count()
-- all read this function, so they follow the role too.
create or replace function public.my_institution_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.app_role() = 'research_office'
      then public.institution_key(auth.jwt() -> 'app_metadata' ->> 'institution')
    else (select public.institution_key(institution) from public.faculty_profile where user_id = (select auth.uid()) limit 1)
  end
$$;
