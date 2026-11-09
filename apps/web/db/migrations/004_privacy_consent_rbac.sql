-- Phase A: privacy, consent, RBAC.

-- ---------- Staff roles (least privilege). is_admin kept for backwards compatibility only.
alter table app_users
  add column role text not null default 'user' check (role in ('user','support','analyst','admin','owner')),
  add column terms_version text,
  add column privacy_version text,
  add column terms_accepted_at timestamptz,
  add column training_consent boolean not null default false,
  add column training_consent_version text,
  add column training_consent_at timestamptz;
update app_users set role = 'admin' where is_admin;

-- ---------- Versioned legal documents (draft text flagged for legal review)
create table legal_documents (
  kind text not null check (kind in ('terms','privacy','training_consent','data_collection')),
  version text not null,
  title text not null,
  body_md text not null,
  effective_at timestamptz not null default now(),
  requires_acceptance boolean not null default true,
  published boolean not null default false,
  legal_review_status text not null default 'pending' check (legal_review_status in ('pending','approved')),
  created_at timestamptz not null default now(),
  primary key (kind, version)
);

-- ---------- Append-only consent audit trail
create table consent_events (
  id bigserial primary key,
  user_id uuid not null,               -- kept after account deletion (no FK) as proof of consent history
  kind text not null check (kind in ('terms','privacy','training_consent')),
  version text not null,
  action text not null check (action in ('accepted','granted','revoked')),
  source text not null check (source in ('web','mobile','api','system')),
  user_agent text,
  created_at timestamptz not null default now()
);
create index on consent_events (user_id, created_at);
create rule consent_events_no_update as on update to consent_events do instead nothing;
create rule consent_events_no_delete as on delete to consent_events do instead nothing;

-- ---------- Privacy requests (CCPA/CPRA access, deletion, opt-out) log
create table privacy_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  kind text not null check (kind in ('access','deletion','opt_out_training','opt_in_training')),
  status text not null default 'completed' check (status in ('received','completed','failed')),
  detail jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on privacy_requests (user_id, created_at);

-- ---------- Images: sanitizer signals, consent snapshot, retention
alter table submitted_images
  add column metadata_signals jsonb,
  add column training_consent boolean not null default false,  -- snapshot at upload; existing uploads = not consented
  add column consent_version text,
  add column purged_at timestamptz,
  alter column storage_key drop not null;

-- Training eligibility = consent at upload time AND consent still granted now AND not purged.
create view training_eligible_images as
  select i.id, i.session_id, i.user_id, i.role, i.sha256, i.consent_version, i.created_at
    from submitted_images i join app_users u on u.id = i.user_id
   where i.is_original and i.training_consent and u.training_consent and u.deleted_at is null and i.purged_at is null;

alter table legal_documents enable row level security;
alter table consent_events enable row level security;
alter table privacy_requests enable row level security;
