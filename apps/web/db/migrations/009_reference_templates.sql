-- Reference library admin: review workflow for verified templates (label / UV / microprint).
-- Submissions start as 'pending'; a second staff member approves ('active') or rejects them.
-- Only active templates are used in analysis. Existing templates (registered before review existed) stay active.

alter table verified_templates drop constraint if exists verified_templates_status_check;
alter table verified_templates alter column status set default 'pending';
alter table verified_templates add constraint verified_templates_status_check check (status in ('pending','active','rejected','retired'));

alter table verified_templates
  add column grader text,
  add column cert_number text,
  add column variant text,                       -- e.g. "regular", "gold label", "autograph" (label variants of one generation)
  add column evidence_type text check (evidence_type in ('grader_confirmed','submitted_by_us','grader_registry_image','trusted_dealer','other')),
  add column source_kind text not null default 'session_image' check (source_kind in ('session_image','upload')),
  add column source_storage_key text,            -- full original (metadata-stripped) the template was cut from
  add column sha256 text,
  add column quality jsonb,
  add column consistency jsonb,                  -- comparison with templates already active at submission time
  add column reviewed_by uuid,
  add column reviewed_at timestamptz,
  add column review_note text,
  add column self_approved boolean not null default false,
  add column retired_by uuid,
  add column retired_at timestamptz,
  add column retire_reason text;

-- Two-person rule, enforced by the database: the approver must differ from the submitter
-- unless self-approval was explicitly allowed for a single-operator deployment (recorded).
alter table verified_templates add constraint verified_templates_two_person
  check (reviewed_by is null or reviewed_by <> created_by or self_approved);
-- Templates registered before this workflow had a single approver; say so instead of inventing a review.
update verified_templates set review_note = 'Registered before the review workflow (single approver)' where status = 'active' and reviewed_at is null;

create unique index verified_templates_no_dupes on verified_templates (generation_id, kind, sha256)
  where status in ('pending','active') and sha256 is not null;
create index on verified_templates (status, created_at);
