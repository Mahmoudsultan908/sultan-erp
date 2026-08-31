-- Applied to the production Supabase project.
-- Purchase suggestions and purchase orders already read/write this optional date.
ALTER TABLE public.purchase_orders
    ADD COLUMN IF NOT EXISTS expected_date date;
