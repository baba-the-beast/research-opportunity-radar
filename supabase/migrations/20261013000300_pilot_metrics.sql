-- Pilot metrics: is the app helping researchers apply? Counts only, never names or call titles.
-- Admins and operators see everyone; a research office sees faculty at its own institution.
-- Window: [since, until). Status changes come from user_activity ('status_change' events).

create or replace function public.pilot_metrics(since timestamptz, until timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_role text := public.app_role();
  inst text := public.my_institution_key();
  result jsonb;
begin
  if caller_role not in ('admin', 'operator', 'research_office') then
    raise exception 'pilot metrics are for admins, operators and research offices' using errcode = '42501';
  end if;
  if caller_role = 'research_office' and coalesce(inst, '') = '' then
    raise exception 'set your institution in Profile first' using errcode = '22023';
  end if;

  with scope as (
    -- Users counted: everyone, or faculty whose profile names the research office's institution
    select fp.user_id, fp.id as faculty_id
    from public.faculty_profile fp
    where fp.user_id is not null
      and (caller_role <> 'research_office' or public.institution_key(fp.institution) = inst)
  ),
  changes as (
    select ua.user_id, (ua.metadata ->> 'opportunity_id')::uuid as opportunity_id,
           ua.metadata ->> 'new_status' as new_status, ua.created_at
    from public.user_activity ua
    join scope s on s.user_id = ua.user_id
    where ua.event_type = 'status_change' and ua.created_at >= since and ua.created_at < until
      and ua.metadata ? 'opportunity_id'
  ),
  started as (
    select distinct on (user_id, opportunity_id) user_id, opportunity_id, created_at
    from changes where new_status = 'pursuing' order by user_id, opportunity_id, created_at
  ),
  notice as (
    -- Days between starting an application and the call's next deadline at that moment
    select (select min(d.deadline_date) from public.opportunity_deadlines d
            where d.opportunity_id = st.opportunity_id
              and d.deadline_date >= (st.created_at at time zone 'Asia/Kolkata')::date)
           - (st.created_at at time zone 'Asia/Kolkata')::date as days
    from started st
  ),
  missed as (
    -- Still "preparing" although every deadline of the call has passed
    select uos.user_id from public.user_opportunity_state uos
    join scope s on s.user_id = uos.user_id
    where uos.status = 'pursuing'
      and exists (select 1 from public.opportunity_deadlines d where d.opportunity_id = uos.opportunity_id)
      and not exists (
        select 1 from public.opportunity_deadlines d
        where d.opportunity_id = uos.opportunity_id
          and d.deadline_date >= (now() at time zone 'Asia/Kolkata')::date
      )
  )
  select jsonb_build_object(
    'scope', case when caller_role = 'research_office' then 'institution' else 'all' end,
    'since', since,
    'until', until,
    'faculty_profiles', (select count(*) from scope),
    'active_users', (select count(distinct user_id) from public.user_activity ua
                     where ua.user_id in (select user_id from scope) and ua.created_at >= since and ua.created_at < until),
    'applications_started', (select count(*) from started),
    'applications_submitted', (select count(distinct (user_id, opportunity_id)) from changes where new_status = 'applied'),
    'funded', (select count(distinct (user_id, opportunity_id)) from changes where new_status = 'awarded'),
    'not_funded', (select count(distinct (user_id, opportunity_id)) from changes where new_status = 'not_awarded'),
    'median_notice_days', (select percentile_cont(0.5) within group (order by days) from notice where days is not null),
    'preparing_past_deadline', (select count(*) from missed),
    'reminders_sent', (select count(*) from public.alerts_sent a
                       where a.faculty_id in (select faculty_id from scope)
                         and a.alert_type in ('deadline_urgent', 'deadline_reminder', 'deadline_critical')
                         and a.sent_at >= since and a.sent_at < until),
    'new_calls_found', (select coalesce(sum(r.opportunities_new), 0) from public.run_log r
                        where r.started_at >= since and r.started_at < until)
  ) into result;
  return result;
end;
$$;

revoke all on function public.pilot_metrics(timestamptz, timestamptz) from public;
grant execute on function public.pilot_metrics(timestamptz, timestamptz) to authenticated;
