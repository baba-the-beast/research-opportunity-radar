-- ==============================================================================
-- Scrub private data already written by earlier pipeline runs (architecture review, 2026-09-29)
--
-- 1. Keyword searches used to be recorded as sources named "journal_watch(<keyword>)". sources and
--    source_runs are readable by every signed-in user, so this exposed each faculty member's
--    research keywords. The pipeline now uses one neutral source name; fold the old rows into it.
-- 2. run_log.errors could contain a Telegram bot token (inside request URLs) and keyword labels.
--    New errors are redacted before storage; redact what is already there.
--
-- Idempotent: safe to re-run.
-- ==============================================================================

do $$
declare
  neutral_name constant text := 'Scholarly literature search (OpenAlex / Crossref / Semantic Scholar)';
  neutral_id uuid;
begin
  if not exists (select 1 from sources where name like 'journal\_watch(%') then
    return;
  end if;

  insert into sources (name, source_type, base_url, health_status)
  values (neutral_name, 'api', 'https://api.openalex.org', 'healthy')
  on conflict (name) do nothing;
  select id into neutral_id from sources where name = neutral_name;

  -- Per-run health rows keep their counts, just without the keyword
  update source_runs
     set source_id = neutral_id
   where source_id in (select id from sources where name like 'journal\_watch(%');

  -- Provenance rows: repoint unless the opportunity already cites the neutral source
  -- (unique (opportunity_id, source_id)); drop only those duplicates.
  delete from opportunity_sources os
   where os.source_id in (select id from sources where name like 'journal\_watch(%')
     and exists (
       select 1 from opportunity_sources keep
        where keep.opportunity_id = os.opportunity_id and keep.source_id = neutral_id
     );
  update opportunity_sources
     set source_id = neutral_id
   where source_id in (select id from sources where name like 'journal\_watch(%');

  delete from sources where name like 'journal\_watch(%';
end $$;

-- Redact bot tokens and keyword labels inside stored error text
update run_log
   set errors = regexp_replace(
                  regexp_replace(errors::text, 'bot[0-9]{5,}:[A-Za-z0-9_-]{20,}', '[REDACTED]', 'g'),
                  'journal_watch\([^)"]*\)', 'journal_watch([REDACTED])', 'g'
                )::jsonb
 where errors::text ~ 'bot[0-9]{5,}:[A-Za-z0-9_-]{20,}'
    or errors::text like '%journal\_watch(%';
