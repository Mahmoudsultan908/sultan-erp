-- Customer follow-up fields only. They never post collections or alter balance.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS daily_payment_target numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_schedule text NOT NULL DEFAULT 'daily';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customers_daily_payment_target_nonnegative'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_daily_payment_target_nonnegative
      CHECK (daily_payment_target >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'customers_payment_schedule_valid'
      AND conrelid = 'public.customers'::regclass
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_payment_schedule_valid
      CHECK (payment_schedule IN ('daily','weekly','monthly'));
  END IF;
END $$;
