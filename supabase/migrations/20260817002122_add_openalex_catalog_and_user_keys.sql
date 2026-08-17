alter table public.user_settings
  add column if not exists openalex_key_ciphertext text,
  add column if not exists openalex_key_last_four text;

alter table public.papers
  add column if not exists openalex_id text,
  add column if not exists pubmed_id text,
  add column if not exists doi text,
  add column if not exists work_type text,
  add column if not exists source_type text,
  add column if not exists primary_topic text;

create unique index if not exists papers_openalex_id_key
  on public.papers (openalex_id)
  where openalex_id is not null;

create index if not exists papers_doi_idx
  on public.papers (doi)
  where doi is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.user_settings'::regclass
      and conname = 'user_settings_openalex_key_last_four_check'
  ) then
    alter table public.user_settings
      add constraint user_settings_openalex_key_last_four_check
      check (openalex_key_last_four is null or char_length(openalex_key_last_four) = 4);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.papers'::regclass
      and conname = 'papers_openalex_id_check'
  ) then
    alter table public.papers
      add constraint papers_openalex_id_check
      check (openalex_id is null or openalex_id ~ '^W[0-9]+$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.papers'::regclass
      and conname = 'papers_pubmed_id_check'
  ) then
    alter table public.papers
      add constraint papers_pubmed_id_check
      check (pubmed_id is null or pubmed_id ~ '^[0-9]{1,12}$');
  end if;
end
$$;

comment on column public.user_settings.openalex_key_ciphertext is
  'AES-256-GCM encrypted user OpenAlex API key. Never granted to browser roles.';
comment on column public.user_settings.openalex_key_last_four is
  'Non-secret suffix used only to display credential status.';
comment on column public.papers.openalex_id is
  'Stable OpenAlex work identifier used for cross-disciplinary discovery and full-text resolution.';
comment on column public.papers.pmid is
  'Legacy external relationship key. Contains a PMID when available, otherwise the OpenAlex work identifier.';
