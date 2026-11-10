-- Phase B: data-driven, versioned reference library + item categories.

create table library_releases (
  id serial primary key,
  version text not null unique,
  status text not null default 'draft' check (status in ('draft','published','retired')),
  content jsonb not null,
  content_sha256 text,               -- sha256 of canonical JSON, set at publish; verified on every load
  notes text,
  based_on int references library_releases(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  published_by uuid,
  published_at timestamptz
);
-- Exactly one published release at a time.
create unique index library_one_published on library_releases ((status)) where status = 'published';

-- Tamper protection: once published (or retired), content and hash can never change.
create function library_release_guard() returns trigger language plpgsql as $$
begin
  if old.status <> 'draft' and (new.content is distinct from old.content or new.content_sha256 is distinct from old.content_sha256 or new.version is distinct from old.version) then
    raise exception 'library release % is %, its content is immutable', old.version, old.status;
  end if;
  if old.status = 'retired' and new.status = 'draft' then
    raise exception 'retired releases cannot become drafts';
  end if;
  return new;
end $$;
create trigger library_release_guard before update on library_releases for each row execute function library_release_guard();
create function library_release_no_delete() returns trigger language plpgsql as $$
begin
  if old.status <> 'draft' then raise exception 'published/retired library releases cannot be deleted'; end if;
  return old;
end $$;
create trigger library_release_no_delete before delete on library_releases for each row execute function library_release_no_delete();
alter table library_releases enable row level security;

-- Item category per session (default covers every pre-Phase-B session).
alter table verification_sessions add column category text not null default 'sports_cards';

-- Superseded by library_releases (were only seeded copies of code constants).
drop table if exists holder_generations;
drop table if exists security_features;
drop table if exists grading_companies;
