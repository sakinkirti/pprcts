alter table public.user_settings
  add column if not exists briefing_cadence text not null default 'off',
  add column if not exists briefing_timezone text,
  add column if not exists briefing_time time without time zone not null default '06:00',
  add column if not exists briefing_weekday smallint not null default 1;

update public.user_settings
set briefing_cadence = case
  when briefing_enabled is true then 'daily'
  else 'off'
end
where briefing_cadence = 'off';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_settings'::regclass
      and conname = 'user_settings_briefing_cadence_check'
  ) then
    alter table public.user_settings
      add constraint user_settings_briefing_cadence_check
      check (briefing_cadence in ('off', 'daily', 'weekly'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_settings'::regclass
      and conname = 'user_settings_briefing_timezone_check'
  ) then
    alter table public.user_settings
      add constraint user_settings_briefing_timezone_check
      check (
        briefing_timezone is null
        or briefing_timezone ~ '^[A-Za-z0-9_+./-]{1,100}$'
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.user_settings'::regclass
      and conname = 'user_settings_briefing_weekday_check'
  ) then
    alter table public.user_settings
      add constraint user_settings_briefing_weekday_check
      check (briefing_weekday between 0 and 6);
  end if;
end
$$;

grant select (briefing_cadence, briefing_timezone, briefing_time, briefing_weekday)
  on table public.user_settings to authenticated;
grant insert (briefing_cadence, briefing_timezone, briefing_time, briefing_weekday)
  on table public.user_settings to authenticated;
grant update (briefing_cadence, briefing_timezone, briefing_time, briefing_weekday)
  on table public.user_settings to authenticated;

comment on column public.user_settings.briefing_cadence is
  'Automatic research briefing cadence. Off keeps manual generation available.';
comment on column public.user_settings.briefing_timezone is
  'IANA time zone used to schedule automatic research briefings in the user selected local time.';
comment on column public.user_settings.briefing_time is
  'User-selected local wall-clock time for automatic research briefing generation.';
comment on column public.user_settings.briefing_weekday is
  'Weekly briefing weekday using JavaScript numbering: Sunday 0 through Saturday 6.';
comment on column public.user_settings.briefing_enabled is
  'Legacy compatibility flag. New clients use briefing_cadence.';
