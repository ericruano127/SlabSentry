-- Cross-session cache of official lookups (saves rate-limited provider calls, e.g. PSA 100/day free tier).
create table cert_lookups (
  grader text not null,
  cert_number text not null,
  data jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (grader, cert_number)
);
alter table cert_lookups enable row level security;
