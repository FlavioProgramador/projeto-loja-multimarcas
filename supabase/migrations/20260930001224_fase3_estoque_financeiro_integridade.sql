BEGIN;
UPDATE public.financial_transactions
SET type=CASE lower(type) WHEN 'entrada' THEN 'INCOME' WHEN 'saida' THEN 'EXPENSE' ELSE type END,
    updated_at=timezone('utc',now())
WHERE type IN ('entrada','saida');
ALTER TABLE public.financial_transactions DROP CONSTRAINT IF EXISTS financial_transactions_type_check;
ALTER TABLE public.financial_transactions ADD CONSTRAINT financial_transactions_type_check CHECK (type IN ('INCOME','EXPENSE'));
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_method_check CHECK (method IN ('PIX','CREDIT_CARD','DEBIT_CARD','CASH'));
COMMIT;
