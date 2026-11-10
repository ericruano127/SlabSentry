-- Phase C: new checks + fair market value.

alter table verification_sessions
  add column grade_label text,          -- e.g. "PSA 10"; from the official record or confirmed by the user
  add column item_title text,           -- user-provided description when no official record is available
  add column asking_price_cents int check (asking_price_cents is null or asking_price_cents >= 0),
  add column currency text not null default 'USD';

-- One-time codes that attest a photo was captured live in the app during this session.
create table capture_nonces (
  nonce text primary key,
  session_id uuid not null references verification_sessions(id) on delete cascade,
  user_id uuid not null,
  issued_at timestamptz not null default now(),
  used_at timestamptz,
  image_id uuid
);
create index on capture_nonces (session_id);

-- Pseudonymous index for cloned-certificate detection: HMAC keys only, no raw cert or user ids.
create table cert_sightings (
  id bigserial primary key,
  cert_key text not null,               -- HMAC(secret, grader|cert)
  user_key text not null,               -- HMAC(secret, user id) — lets account deletion remove sightings
  session_id uuid references verification_sessions(id) on delete set null,
  category text not null,
  item_phash text,
  item_dhash text,
  created_at timestamptz not null default now()
);
create index on cert_sightings (cert_key, created_at);
create index on cert_sightings (user_key);

-- Verified reference templates (label crops, UV patterns, microprint crops) per holder generation.
create table verified_templates (
  id uuid primary key default gen_random_uuid(),
  generation_id text not null,
  kind text not null check (kind in ('label','uv','microprint')),
  storage_key text not null,
  source_session_id uuid,
  source_image_id uuid,
  verification_note text not null,      -- how authenticity of the source slab was established
  status text not null default 'active' check (status in ('active','retired')),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
create index on verified_templates (generation_id, kind, status);

-- Market value: user-entered comparable sales and cached provider responses.
create table market_comps (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references verification_sessions(id) on delete cascade,
  user_id uuid not null,
  source text not null,
  price_cents int not null check (price_cents > 0),
  currency text not null default 'USD',
  sold_at date,
  url text,
  title text,
  grade_label text,
  created_at timestamptz not null default now()
);
create index on market_comps (session_id);
create table market_cache (
  provider text not null,
  query_key text not null,
  data jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (provider, query_key)
);

-- Market value is available on every plan by default (editable in Admin → Plans).
update subscription_plans set features = features || '["market_value"]'::jsonb where not features ? 'market_value';

alter table capture_nonces enable row level security;
alter table cert_sightings enable row level security;
alter table verified_templates enable row level security;
alter table market_comps enable row level security;
alter table market_cache enable row level security;
