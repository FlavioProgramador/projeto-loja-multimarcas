create index if not exists idx_privacy_requests_requested_by
  on public.privacy_requests (requested_by, requested_at desc);

create index if not exists idx_privacy_requests_resolved_by
  on public.privacy_requests (resolved_by, resolved_at desc)
  where resolved_by is not null;
