-- Application tracker: follow a call past "I'm applying" to its outcome.
--   pursuing     -> preparing the application (existing value)
--   applied      -> submitted (value already allowed, now used by the app)
--   awarded      -> funded / paper accepted (new)
--   not_awarded  -> not funded / rejected (new)
-- Existing rows are unaffected: every current value stays valid.

alter table user_opportunity_state drop constraint if exists user_opportunity_state_status_check;
alter table user_opportunity_state
  add constraint user_opportunity_state_status_check
  check (status in ('new', 'pursuing', 'applied', 'awarded', 'not_awarded', 'dismissed'));

-- Notes are capped so a client cannot store unbounded text per row.
alter table user_opportunity_state drop constraint if exists user_opportunity_state_notes_length;
alter table user_opportunity_state
  add constraint user_opportunity_state_notes_length check (char_length(notes) <= 4000) not valid; -- new writes only; never fails on old rows
