alter table public.papers
  add column if not exists summary_basis text,
  add column if not exists summary_metadata jsonb not null default '{}'::jsonb,
  add column if not exists summary_fingerprint text,
  add column if not exists content_status text not null default 'abstract_only',
  add column if not exists content_source text,
  add column if not exists content_url text,
  add column if not exists content_license text,
  add column if not exists content_version text,
  add column if not exists content_retrieved_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.papers'::regclass
      and conname = 'papers_summary_basis_check'
  ) then
    alter table public.papers
      add constraint papers_summary_basis_check
      check (summary_basis is null or summary_basis in ('full_text', 'abstract'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.papers'::regclass
      and conname = 'papers_content_status_check'
  ) then
    alter table public.papers
      add constraint papers_content_status_check
      check (content_status in ('full_text', 'abstract_only', 'metadata_only'));
  end if;
end
$$;

comment on column public.papers.summary_basis is
  'Evidence boundary used for the generated summary: full_text or abstract.';
comment on column public.papers.summary_metadata is
  'Non-sensitive summary provenance. Raw article text and evidence quotations are never stored.';
comment on column public.papers.summary_fingerprint is
  'SHA-256 digest of the generated summary used for cache integrity.';
comment on column public.papers.content_url is
  'Landing page for the source used or evaluated; never an arbitrary fetch target.';
