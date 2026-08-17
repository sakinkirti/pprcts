begin;

alter table public.user_settings
  add column if not exists openai_key_ciphertext text,
  add column if not exists openai_key_last_four text;

create index if not exists user_library_paper_pmid_idx
  on public.user_library (paper_pmid);

drop policy if exists "Enable update for authenticated users only" on public.daily_podcasts;
drop policy if exists "Users can update own podcasts" on public.daily_podcasts;
drop policy if exists "Enable delete for users based on user_id" on public.daily_podcasts;
drop policy if exists "Enable insert for users based on user_id" on public.daily_podcasts;
drop policy if exists "Enable users to view their own data only" on public.daily_podcasts;

create policy "Users select own podcasts"
  on public.daily_podcasts for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users insert own podcasts"
  on public.daily_podcasts for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update own podcasts"
  on public.daily_podcasts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete own podcasts"
  on public.daily_podcasts for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Enable delete for users based on user_id" on public.user_library;
drop policy if exists "Enable insert for users based on user_id" on public.user_library;
drop policy if exists "Enable users to view their own data only" on public.user_library;

create policy "Users select own library"
  on public.user_library for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users insert own library"
  on public.user_library for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users delete own library"
  on public.user_library for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can view their own settings" on public.user_settings;
drop policy if exists "Users can insert their own settings" on public.user_settings;
drop policy if exists "Users can update their own settings" on public.user_settings;

create policy "Users select own settings"
  on public.user_settings for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users insert own settings"
  on public.user_settings for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users update own settings"
  on public.user_settings for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Enable insert for authenticated users only" on public.papers;
drop policy if exists "Enable read access for all users" on public.papers;
drop policy if exists "Enable update for authenticated users only" on public.papers;

create policy "Authenticated users read cached papers"
  on public.papers for select to authenticated
  using (true);

revoke all privileges on table public.papers from anon, authenticated;
revoke all privileges on table public.user_library from anon, authenticated;
revoke all privileges on table public.user_settings from anon, authenticated;
revoke all privileges on table public.daily_podcasts from anon, authenticated;

grant select on table public.papers to authenticated;
grant select, insert, delete on table public.user_library to authenticated;
grant select (user_id, briefing_enabled, keywords, updated_at, openai_key_last_four)
  on table public.user_settings to authenticated;
grant insert (user_id, briefing_enabled, keywords, updated_at)
  on table public.user_settings to authenticated;
grant update (briefing_enabled, keywords, updated_at)
  on table public.user_settings to authenticated;
grant select, insert, update, delete on table public.daily_podcasts to authenticated;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

update storage.buckets
set public = false,
    file_size_limit = 52428800,
    allowed_mime_types = array['audio/mpeg']
where id in ('audio-summaries', 'daily-podcasts');

drop policy if exists "Allow authenticated reads" on storage.objects;
drop policy if exists "Allow authenticated reads w56kct_0" on storage.objects;
drop policy if exists "Allow authenticated upload" on storage.objects;
drop policy if exists "Allow authenticated uploads" on storage.objects;
drop policy if exists "Users can delete their own daily podcasts" on storage.objects;

create policy "Authenticated users read cached summary audio"
  on storage.objects for select to authenticated
  using (bucket_id = 'audio-summaries');

create policy "Users read own daily podcast audio"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'daily-podcasts'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (regexp_split_to_array(name, '_'))[2] = (select auth.uid())::text
    )
  );

commit;
