create or replace function public.get_database_operational_health()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with db as (
    select
      numbackends,
      xact_commit,
      xact_rollback,
      deadlocks,
      temp_files,
      temp_bytes,
      blk_read_time,
      blk_write_time
    from pg_stat_database
    where datname = current_database()
  ),
  sessions as (
    select
      count(*) filter (where state = 'active') as active_sessions,
      count(*) filter (
        where state = 'active'
          and query_start < now() - interval '5 seconds'
      ) as long_running_sessions,
      count(*) filter (
        where wait_event_type = 'Lock'
      ) as blocked_sessions
    from pg_stat_activity
    where datname = current_database()
      and pid <> pg_backend_pid()
  )
  select jsonb_build_object(
    'checked_at', now(),
    'connections', db.numbackends,
    'active_sessions', sessions.active_sessions,
    'long_running_sessions_5s', sessions.long_running_sessions,
    'blocked_sessions', sessions.blocked_sessions,
    'deadlocks_since_stats_reset', db.deadlocks,
    'xact_commit', db.xact_commit,
    'xact_rollback', db.xact_rollback,
    'rollback_ratio',
      case
        when db.xact_commit + db.xact_rollback = 0 then 0
        else round((db.xact_rollback::numeric / (db.xact_commit + db.xact_rollback)) * 100, 4)
      end,
    'temp_files', db.temp_files,
    'temp_bytes', db.temp_bytes,
    'blk_read_time_ms', db.blk_read_time,
    'blk_write_time_ms', db.blk_write_time,
    'status',
      case
        when sessions.blocked_sessions > 0 or sessions.long_running_sessions > 5 then 'critical'
        when db.deadlocks > 0 then 'warning'
        else 'ok'
      end
  )
  from db, sessions;
$$;

revoke all on function public.get_database_operational_health() from public, anon, authenticated;
grant execute on function public.get_database_operational_health() to service_role;

create or replace function public.get_slow_query_metrics(p_limit integer default 20)
returns table (
  queryid bigint,
  calls bigint,
  total_exec_time_ms double precision,
  mean_exec_time_ms double precision,
  rows bigint,
  query text
)
language sql
stable
security definer
set search_path = pg_catalog, extensions
as $$
  select
    p.queryid,
    p.calls,
    p.total_exec_time,
    p.mean_exec_time,
    p.rows,
    regexp_replace(p.query, '\s+', ' ', 'g') as query
  from extensions.pg_stat_statements p
  where p.dbid = (select oid from pg_database where datname = current_database())
    and p.calls > 0
  order by p.mean_exec_time desc
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

revoke all on function public.get_slow_query_metrics(integer) from public, anon, authenticated;
grant execute on function public.get_slow_query_metrics(integer) to service_role;
