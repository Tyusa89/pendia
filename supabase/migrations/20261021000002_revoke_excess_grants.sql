-- anon had full table privileges (incl. TRUNCATE, which bypasses RLS). Only signed-in users get plain CRUD, gated by RLS.
revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke all on tables from anon;
