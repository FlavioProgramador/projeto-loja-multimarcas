# Security validation tests

This directory documents the CI-level security checks for Phase 3.

The authoritative database authorization checks run against the Supabase project through the SQL/RLS test suite (`npm run test:db`). Tests must use disposable test identities and must never mutate production data.

Required scenarios:
- cross-store SELECT is denied;
- cross-store INSERT/UPDATE/DELETE is denied;
- cashier/employee cannot read `cost_price`;
- admin/manager can read authorized product cost;
- direct `sales` UPDATE is denied;
- sale idempotency cannot be read directly by client roles.

No real user credentials belong in this directory. CI must provide only non-production test credentials through GitHub/Supabase secrets when integration tests are enabled.
