create index if not exists idx_automation_rules_archived_by
         on public.automation_rules(archived_by)
         where archived_by is not null;