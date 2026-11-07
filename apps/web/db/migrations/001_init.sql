-- SlabGuard schema. Works on Supabase Postgres or plain Postgres 14+.
-- User ids equal Supabase auth.users ids; no FK to auth schema so the schema is portable.
create extension if not exists pgcrypto;

create table app_users (
  id uuid primary key,
  email text,
  is_admin boolean not null default false,
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------- Plans (admin-editable; seeded from config/plans.json) ----------
create table subscription_plans (
  id text primary key,
  name text not null,
  tagline text not null default '',
  rank int not null,
  monthly_allowance int not null check (monthly_allowance >= 0),
  lifetime_allowance int not null default 0 check (lifetime_allowance >= 0),
  features jsonb not null default '[]',
  marketing_bullets jsonb not null default '[]',
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table subscription_prices (
  id text primary key,
  plan_id text not null references subscription_plans(id),
  interval text not null check (interval in ('month','year')),
  amount_cents int not null check (amount_cents >= 0),
  currency text not null default 'USD',
  stripe_price_id text unique,
  apple_product_id text unique,
  google_product_id text unique,
  active boolean not null default true
);

-- ---------- Subscriptions & billing ----------
create table user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  plan_id text not null references subscription_plans(id),
  price_id text references subscription_prices(id),
  provider text not null check (provider in ('stripe','app_store','play_store','manual')),
  provider_subscription_id text not null,
  provider_customer_id text,
  status text not null check (status in ('active','trialing','past_due','canceled','expired','refunded','paused','incomplete')),
  billing_interval text not null check (billing_interval in ('month','year')),
  started_at timestamptz not null,
  current_period_start timestamptz,
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  provider_updated_at timestamptz,  -- newest provider timestamp applied; older events are ignored
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);
create index on user_subscriptions (user_id);

create table billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  user_id uuid,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received','processed','failed','ignored')),
  error text,
  attempts int not null default 0,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, provider_event_id)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete set null,
  subscription_id uuid references user_subscriptions(id) on delete set null,
  provider text not null,
  provider_payment_id text not null,
  amount_cents int not null,
  refunded_cents int not null default 0,
  currency text not null default 'USD',
  status text not null check (status in ('succeeded','failed','refunded','partially_refunded','disputed','dispute_won','dispute_lost')),
  occurred_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);

create table account_entitlements (
  user_id uuid primary key references app_users(id) on delete cascade,
  plan_id text not null references subscription_plans(id),
  source_subscription_id uuid references user_subscriptions(id) on delete set null,
  features jsonb not null,
  monthly_allowance int not null,
  window_start timestamptz,
  window_end timestamptz,
  renews_at timestamptz,
  will_cancel boolean not null default false,
  computed_at timestamptz not null default now()
);

-- ---------- Credits ----------
create table verification_allowances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  kind text not null check (kind in ('lifetime_free','subscription_period','admin_grant')),
  plan_id text references subscription_plans(id),
  subscription_id uuid references user_subscriptions(id) on delete set null,
  period_start timestamptz not null,
  period_end timestamptz,
  granted int not null check (granted >= 0),
  used int not null default 0 check (used >= 0),
  reserved int not null default 0 check (reserved >= 0),
  unique (user_id, kind, period_start)
);

create table verification_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  mode text not null check (mode in ('in_hand','online_listing')),
  status text not null default 'draft' check (status in ('draft','queued','processing','completed','failed','canceled')),
  title text,
  grader text,
  cert_number text,
  cert_source text,
  cert_confirmed boolean not null default false,
  locked_cert text,          -- after the first delivered report, a session is bound to this slab
  credit_state text not null default 'none' check (credit_state in ('none','reserved','consumed','released')),
  credit_attempt int not null default 0,
  allowance_id uuid references verification_allowances(id) on delete set null,
  reserved_at timestamptz,
  analysis_count int not null default 0,
  overall_assessment text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on verification_sessions (user_id, created_at desc);

create table verification_usage_ledger (
  id bigserial primary key,
  user_id uuid not null,
  session_id uuid references verification_sessions(id) on delete set null,
  allowance_id uuid,
  attempt int not null,
  action text not null check (action in ('reserve','consume','release')),
  reason text,
  created_at timestamptz not null default now(),
  unique (session_id, attempt, action)   -- makes every transition idempotent
);
create index on verification_usage_ledger (user_id, created_at);

-- ---------- Reference data (seeded from @slabguard/core) ----------
create table grading_companies (id text primary key, name text not null, data jsonb not null);
create table holder_generations (id text primary key, grader text not null, name text not null, data jsonb not null, library_version text not null);
create table security_features (id text primary key, data jsonb not null, library_version text not null);

-- ---------- Evidence ----------
create table submitted_images (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references verification_sessions(id) on delete cascade,
  user_id uuid not null,
  role text not null,
  is_original boolean not null default true,   -- processed/derived images are separate rows
  derived_from uuid references submitted_images(id) on delete cascade,
  storage_key text not null,
  mime text not null,
  bytes int not null,
  sha256 text not null,
  quality jsonb,
  provenance jsonb not null,
  superseded boolean not null default false,
  created_at timestamptz not null default now()
);
create index on submitted_images (session_id);

create table extracted_certifications (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references verification_sessions(id) on delete cascade,
  grader text, cert_number text not null, source text not null, raw jsonb,
  created_at timestamptz not null default now()
);

create table official_reference_images (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references verification_sessions(id) on delete cascade,
  grader text, cert_number text,
  side text not null check (side in ('front','back')),
  source text not null check (source in ('official_api','user_supplied_reference')),
  availability text not null check (availability in ('available','unavailable','inaccessible','not_checked')),
  source_url text,
  image_id uuid references submitted_images(id) on delete cascade,
  attestation text,
  retrieved_at timestamptz not null default now()
);

create table image_comparisons (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references verification_sessions(id) on delete cascade,
  analysis_run int not null, side text not null,
  upload_image_id uuid, reference_image_id uuid,
  result jsonb not null, tool_version text not null,
  created_at timestamptz not null default now()
);

create table verification_evidence (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references verification_sessions(id) on delete cascade,
  analysis_run int not null, kind text not null, data jsonb not null, provenance jsonb not null,
  created_at timestamptz not null default now()
);

create table risk_findings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references verification_sessions(id) on delete cascade,
  analysis_run int not null, severity text not null, pattern text not null, data jsonb not null
);

create table verification_reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references verification_sessions(id) on delete cascade,
  analysis_run int not null,
  report jsonb not null,
  rules_version text not null,
  share_token text unique,
  created_at timestamptz not null default now(),
  unique (session_id, analysis_run)
);

-- ---------- Ops ----------
create table jobs (
  id bigserial primary key,
  kind text not null,
  payload jsonb not null,
  priority int not null default 0,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index on jobs (status, priority desc, run_after);

create table processing_costs (
  id bigserial primary key,
  session_id uuid references verification_sessions(id) on delete set null,
  user_id uuid,
  item text not null,
  units numeric not null,
  cost_usd numeric not null,
  created_at timestamptz not null default now()
);

create table rate_limits (key text not null, window_start timestamptz not null, count int not null, primary key (key, window_start));

create table admin_audit_log (
  id bigserial primary key, admin_id uuid not null, action text not null,
  before jsonb, after jsonb, created_at timestamptz not null default now()
);

create table schema_migrations (name text primary key, applied_at timestamptz not null default now());
