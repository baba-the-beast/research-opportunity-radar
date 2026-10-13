-- Let a faculty member remove their own feedback, so undoing "Not relevant" also removes the
-- scoring penalty it added. Mirrors feedback_select_owner (owner via faculty_profile, or an admin).
drop policy if exists "feedback_delete_owner" on feedback;
create policy "feedback_delete_owner"
  on feedback for delete
  to authenticated
  using (
    faculty_id in (select id from faculty_profile where user_id = (select auth.uid()))
    or (select public.is_admin())
  );
