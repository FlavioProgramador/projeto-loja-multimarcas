revoke truncate, references, trigger on public.automation_rules from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.automation_runs from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.automation_events from authenticated;
grant select on public.automation_rules, public.automation_runs, public.automation_events to authenticated;