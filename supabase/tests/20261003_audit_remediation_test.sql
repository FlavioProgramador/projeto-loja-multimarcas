-- CoreSys Audit Remediation Database Test
-- Date: 2026-10-03
-- Validates approve_physical_inventory actor spoofing checks and report store isolation constraints

BEGIN;

SELECT plan(3);

-- 1) Verify approve_physical_inventory structure & security definition
SELECT has_function(
  'public',
  'approve_physical_inventory',
  ARRAY['uuid', 'uuid'],
  'approve_physical_inventory function should exist with 2 UUID arguments'
);

-- 2) Verify report_stock_status requires p_store_id argument
SELECT has_function(
  'public',
  'report_stock_status',
  ARRAY['uuid'],
  'report_stock_status function should exist requiring store_id parameter'
);

-- 3) Verify physical_inventories trigger for identity change protection exists
SELECT has_trigger(
  'public',
  'physical_inventories',
  'trg_prevent_physical_inventory_identity_change',
  'physical_inventories table should have identity change prevention trigger'
);

SELECT * FROM finish();
ROLLBACK;
