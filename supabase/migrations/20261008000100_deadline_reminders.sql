-- Deadline reminders a user chooses, and their own deadline on a call.
--
-- reminder_days: remind me this many days before a deadline. Scans run twice a week, so a reminder
-- goes out at the first scan after the deadline enters each window. Default {3} is the behaviour
-- every user had before this migration (the 72-hour alert), so nothing changes until they opt in.
alter table user_preferences add column if not exists reminder_days int[] not null default '{3}';
alter table user_preferences drop constraint if exists user_preferences_reminder_days_check;
alter table user_preferences
  add constraint user_preferences_reminder_days_check
  check (reminder_days <@ array[1, 3, 7, 14, 30] and cardinality(reminder_days) <= 5);

-- A user's own deadline for a call, e.g. the institution's internal sign-off date.
alter table user_opportunity_state add column if not exists my_deadline date;
alter table user_opportunity_state add column if not exists my_deadline_label text not null default '';
alter table user_opportunity_state drop constraint if exists user_opportunity_state_my_deadline_label_length;
alter table user_opportunity_state
  add constraint user_opportunity_state_my_deadline_label_length check (char_length(my_deadline_label) <= 80);
create index if not exists idx_user_opp_my_deadline on user_opportunity_state (user_id, my_deadline) where my_deadline is not null;

-- Reminders other than the 3-day one are recorded as their own alert type.
alter table alerts_sent drop constraint if exists alerts_sent_alert_type_check;
alter table alerts_sent
  add constraint alerts_sent_alert_type_check
  check (alert_type in ('new_high_relevance', 'deadline_critical', 'deadline_urgent', 'deadline_reminder', 'deadline_changed', 'weekly_digest'));
