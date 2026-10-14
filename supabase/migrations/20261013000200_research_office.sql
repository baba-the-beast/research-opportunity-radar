-- Research office (R&D cell) mode. A user with app_metadata.role = 'research_office' can, for their
-- own institution, set an internal deadline, a note and a "recommended" flag on any call. Faculty at
-- the same institution see them and get reminders for the internal deadline on calls they apply to.
--
-- An institution is identified by the name in faculty_profile.institution, compared case- and
-- space-insensitively (institution_key). The research office's own profile sets which one it manages.

create or replace function public.institution_key(name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(name, '')), '\s+', ' ', 'g'))
$$;

-- The caller's institution (security definer: reads only the caller's own profile row)
create or replace function public.my_institution_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.institution_key(institution) from public.faculty_profile where user_id = (select auth.uid()) limit 1
$$;

revoke all on function public.my_institution_key() from public;
grant execute on function public.my_institution_key() to authenticated;

create table if not exists institution_call_notes (
  id uuid primary key default gen_random_uuid(),
  institution_key text not null check (institution_key <> ''),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  internal_deadline date,
  note text not null default '' check (char_length(note) <= 1000),
  recommended boolean not null default false,
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (institution_key, opportunity_id)
);

create index if not exists idx_institution_call_notes_key on institution_call_notes (institution_key);

alter table institution_call_notes enable row level security;

drop policy if exists "institution_call_notes_select_members" on institution_call_notes;
create policy "institution_call_notes_select_members"
  on institution_call_notes for select
  to authenticated
  using (institution_key = (select public.my_institution_key()) or (select public.is_admin()));

drop policy if exists "institution_call_notes_write_office" on institution_call_notes;
create policy "institution_call_notes_write_office"
  on institution_call_notes for all
  to authenticated
  using (
    ((select public.app_role()) = 'research_office' and institution_key = (select public.my_institution_key()))
    or (select public.is_admin())
  )
  with check (
    ((select public.app_role()) = 'research_office' and institution_key = (select public.my_institution_key()))
    or (select public.is_admin())
  );

-- How many faculty profiles share the caller's institution name, so a research office can see whether
-- its colleagues typed the institution the same way. Only a count; never names.
create or replace function public.my_institution_faculty_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.faculty_profile
  where public.institution_key(institution) = public.my_institution_key()
    and public.my_institution_key() <> ''
$$;

revoke all on function public.my_institution_faculty_count() from public;
grant execute on function public.my_institution_faculty_count() to authenticated;
