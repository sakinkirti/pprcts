update public.user_settings
set openai_key = null
where openai_key is not null;

alter table public.user_settings
  drop column if exists openai_key;

revoke insert, update, delete on table public.daily_podcasts from authenticated;
grant select on table public.daily_podcasts to authenticated;

create table if not exists public.api_rate_limits (
  rate_limit_key text primary key
    check (char_length(rate_limit_key) = 64),
  request_count integer not null
    check (request_count >= 0),
  reset_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.api_rate_limits enable row level security;
revoke all privileges on table public.api_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.api_rate_limits to service_role;

comment on table public.api_rate_limits is
  'Server-only distributed rate limit counters. Keys are HMAC-SHA256 digests; raw user IDs and IP addresses are not stored.';

create or replace function public.consume_api_rate_limit(
  p_key text,
  p_window_seconds integer,
  p_limit integer
)
returns table (
  is_allowed boolean,
  remaining_requests integer,
  resets_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  with cleanup as (
    delete from public.api_rate_limits
    where reset_at < statement_timestamp() - interval '1 day'
    returning 1
  ),
  upserted as (
    insert into public.api_rate_limits as existing (
      rate_limit_key,
      request_count,
      reset_at,
      updated_at
    )
    values (
      p_key,
      1,
      statement_timestamp() + make_interval(secs => greatest(1, least(p_window_seconds, 86400))),
      statement_timestamp()
    )
    on conflict (rate_limit_key) do update
    set request_count = case
          when existing.reset_at <= statement_timestamp() then 1
          else existing.request_count + 1
        end,
        reset_at = case
          when existing.reset_at <= statement_timestamp() then excluded.reset_at
          else existing.reset_at
        end,
        updated_at = statement_timestamp()
    returning request_count, reset_at
  )
  select
    request_count <= greatest(1, least(p_limit, 100000)),
    greatest(0, greatest(1, least(p_limit, 100000)) - request_count),
    reset_at
  from upserted;
$$;

revoke execute on function public.consume_api_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer)
  to service_role;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'daily_podcasts_status_check'
      and conrelid = 'public.daily_podcasts'::regclass
  ) then
    alter table public.daily_podcasts
      add constraint daily_podcasts_status_check
      check (status in ('queued', 'generating', 'completed', 'failed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'daily_podcasts_content_size_check'
      and conrelid = 'public.daily_podcasts'::regclass
  ) then
    alter table public.daily_podcasts
      add constraint daily_podcasts_content_size_check
      check (
        char_length(title) <= 1000
        and char_length(coalesce(summary, '')) <= 20000
        and char_length(coalesce(transcript, '')) <= 250000
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'user_settings_keywords_size_check'
      and conrelid = 'public.user_settings'::regclass
  ) then
    alter table public.user_settings
      add constraint user_settings_keywords_size_check
      check (char_length(coalesce(keywords, '')) <= 4000);
  end if;
end
$$;
