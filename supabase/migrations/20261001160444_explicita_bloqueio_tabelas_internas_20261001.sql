do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='data_export_audit'
      and policyname='Bloquear acesso direto data_export_audit'
  ) then
    create policy "Bloquear acesso direto data_export_audit"
      on public.data_export_audit
      as restrictive
      for all
      to public
      using (false)
      with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='privacy_requests'
      and policyname='Bloquear acesso direto privacy_requests'
  ) then
    create policy "Bloquear acesso direto privacy_requests"
      on public.privacy_requests
      as restrictive
      for all
      to public
      using (false)
      with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='sale_idempotency'
      and policyname='Bloquear acesso direto sale_idempotency'
  ) then
    create policy "Bloquear acesso direto sale_idempotency"
      on public.sale_idempotency
      as restrictive
      for all
      to public
      using (false)
      with check (false);
  end if;
end $$;
