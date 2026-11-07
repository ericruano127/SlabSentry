-- On Supabase, block PostgREST access to every table: all access goes through
-- the server (service connection), which enforces ownership & entitlements.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
