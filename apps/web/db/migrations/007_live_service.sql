-- Phase E: releases (patches), changelogs, ground truth, technique log, model registry.

create table releases (
  id serial primary key,
  version text not null unique,
  status text not null default 'draft' check (status in ('draft','published')),
  components jsonb not null,           -- rules, library (version + sha256), vision tools, app, models
  public_notes text not null,          -- user-facing; must not reveal detection methods (linted)
  internal_notes text not null,        -- what changed, why, data used
  accuracy jsonb,                      -- evaluation on the labeled set at creation (replayed with this release's rules)
  gate jsonb,                          -- comparison vs the previous published release
  gate_override_reason text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  published_by uuid,
  published_at timestamptz
);
create function release_guard() returns trigger language plpgsql as $$
begin
  if old.status = 'published' and (new.components is distinct from old.components or new.public_notes is distinct from old.public_notes
     or new.internal_notes is distinct from old.internal_notes or new.accuracy is distinct from old.accuracy or new.version is distinct from old.version) then
    raise exception 'release % is published and immutable', old.version;
  end if;
  return new;
end $$;
create trigger release_guard before update on releases for each row execute function release_guard();

alter table verification_reports add column release_version text;

-- Ground truth: independent labels from staff, linked to consent (enforced in the API).
create table ground_truth_labels (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references verification_sessions(id) on delete cascade,
  truth text not null check (truth in ('genuine','counterfeit','altered')),
  basis text not null check (basis in ('grader_confirmation','grader_submission_result','expert_inspection','law_enforcement_or_marketplace','internal_test_sample')),
  note text not null,
  labeled_by uuid not null,
  created_at timestamptz not null default now(),
  unique (session_id, labeled_by)
);

create table counterfeit_techniques (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null,           -- internal only
  categories text[] not null default '{}',
  graders text[] not null default '{}',
  generations text[] not null default '{}',
  first_seen date,
  source text not null,
  status text not null default 'reported' check (status in ('reported','confirmed','mitigated','not_reproducible')),
  mitigation_release text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- For future learned models (all analysis is deterministic today).
create table model_registry (
  id serial primary key,
  name text not null,
  version text not null,
  task text not null,
  artifact_uri text not null,
  training_data_note text not null,    -- dataset + consent basis
  metrics jsonb,
  status text not null default 'candidate' check (status in ('candidate','active','retired')),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (name, version)
);

alter table releases enable row level security;
alter table ground_truth_labels enable row level security;
alter table counterfeit_techniques enable row level security;
alter table model_registry enable row level security;
