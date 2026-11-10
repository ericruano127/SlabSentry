-- Phase F: progress reporting, job timing for metrics.
alter table verification_sessions add column progress int not null default 0, add column stage text;
alter table jobs add column started_at timestamptz, add column finished_at timestamptz;
create index if not exists jobs_finished_idx on jobs (finished_at) where finished_at is not null;
