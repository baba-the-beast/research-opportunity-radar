-- ==============================================================================
-- India-first profile fields, per-user source choice, and cleanup of data written by
-- earlier pipeline versions (2026-10-01)
--
-- 1. faculty_profile: fields Indian calls restrict on (designation, regular/contractual position,
--    date of birth for age limits, superannuation year, state for region-only calls).
--    Defaults no longer pretend to know a user's citizenship/career stage ('citizen',
--    'mid_career', 'tier1_research' matched no option in the profile form).
-- 2. user_preferences.preferred_sources: which agencies/sources a user wants alerts from.
--    Indian agencies and calls for papers by default; Grants.gov / NSF are opt-in.
-- 3. Cleanup:
--    - unknown deadlines were stored as 2099-12-31; they now simply have no row
--    - already-published papers (OpenAlex/Crossref/Semantic Scholar) and arXiv items were stored
--      as open "journal" opportunities; they have no deadline and are closed here
--    - calls whose every deadline has passed are closed
--
-- Idempotent: safe to re-run.
-- ==============================================================================

-- 1. Profile fields
alter table faculty_profile add column if not exists designation text;
alter table faculty_profile add column if not exists employment_type text;
alter table faculty_profile add column if not exists date_of_birth date;
alter table faculty_profile add column if not exists superannuation_year int;
alter table faculty_profile add column if not exists state text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'faculty_profile_employment_type_check') then
    alter table faculty_profile add constraint faculty_profile_employment_type_check
      check (employment_type is null or employment_type in ('regular', 'contractual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'faculty_profile_superannuation_year_check') then
    alter table faculty_profile add constraint faculty_profile_superannuation_year_check
      check (superannuation_year is null or superannuation_year between 2000 and 2100);
  end if;
end $$;

alter table faculty_profile alter column citizenship_status set default '';
alter table faculty_profile alter column career_stage set default '';
alter table faculty_profile alter column institution_type set default '';
update faculty_profile set citizenship_status = '' where citizenship_status = 'citizen';
update faculty_profile set career_stage = '' where career_stage = 'mid_career';
update faculty_profile set institution_type = '' where institution_type = 'tier1_research';

-- 2. Source preferences
alter table user_preferences add column if not exists preferred_sources text[]
  not null default '{ANRF,DST,DBT,ICMR,BIRAC,CSIR,ICSSR,WikiCFP}';

-- 3. Cleanup of earlier pipeline output
delete from opportunity_deadlines where deadline_date = '2099-12-31';

update opportunities o
   set status = 'closed'
 where o.kind in ('journal', 'venue')
   and o.status <> 'closed'
   and not exists (select 1 from opportunity_deadlines d where d.opportunity_id = o.id);

update opportunities o
   set status = 'closed'
 where o.status <> 'closed'
   and exists (select 1 from opportunity_deadlines d where d.opportunity_id = o.id)
   and not exists (
     select 1 from opportunity_deadlines d
      where d.opportunity_id = o.id and d.deadline_date >= (now() at time zone 'Asia/Kolkata')::date
   );

-- Faster "open calls" listing for the dashboard
create index if not exists idx_opportunities_status_discovered on opportunities (status, discovered_at desc);
