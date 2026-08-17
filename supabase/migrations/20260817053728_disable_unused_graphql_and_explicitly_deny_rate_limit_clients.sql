create policy api_rate_limits_deny_client_access
  on public.api_rate_limits
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop extension if exists pg_graphql;
