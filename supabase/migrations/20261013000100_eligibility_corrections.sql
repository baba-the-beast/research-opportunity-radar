-- Users can say an eligibility verdict is wrong. Each correction quotes the rule and call text it is
-- about, so the operator can turn it into a test case for the eligibility agent.
create table if not exists eligibility_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  rule_name text not null check (char_length(rule_name) between 1 and 64),
  verdict_shown text not null check (verdict_shown in ('PASS','FAIL','WARNING','NEEDS_MANUAL_REVIEW')),
  correction text not null check (correction in ('i_meet_it','i_do_not_meet_it','rule_does_not_apply')),
  comment text not null default '' check (char_length(comment) <= 1000),
  excerpt text check (excerpt is null or char_length(excerpt) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists idx_eligibility_corrections_created on eligibility_corrections (created_at desc);

alter table eligibility_corrections enable row level security;

drop policy if exists "eligibility_corrections_insert_own" on eligibility_corrections;
create policy "eligibility_corrections_insert_own"
  on eligibility_corrections for insert
  to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "eligibility_corrections_select_own_or_admin" on eligibility_corrections;
create policy "eligibility_corrections_select_own_or_admin"
  on eligibility_corrections for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
