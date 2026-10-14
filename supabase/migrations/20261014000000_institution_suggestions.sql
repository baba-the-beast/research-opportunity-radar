-- Institution names already used on the radar, for the profile's institution picker, so colleagues
-- (and their research office) converge on one spelling. Returns names and how many profiles use
-- each; never who. Security definer: faculty_profile rows are otherwise visible only to their owner.
create or replace function public.institution_suggestions(q text)
returns table (name text, profiles integer)
language sql
stable
security definer
set search_path = ''
as $$
  select min(btrim(fp.institution)) as name, count(*)::int as profiles
  from public.faculty_profile fp
  where char_length(btrim(coalesce(q, ''))) >= 2
    and fp.institution ilike '%' || replace(replace(replace(btrim(q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  group by public.institution_key(fp.institution)
  order by count(*) desc, min(btrim(fp.institution))
  limit 8
$$;

revoke all on function public.institution_suggestions(text) from public;
grant execute on function public.institution_suggestions(text) to authenticated;
