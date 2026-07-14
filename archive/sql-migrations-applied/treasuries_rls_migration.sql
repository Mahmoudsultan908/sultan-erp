-- ════════════════════════════════════════════════════════════
-- treasuries_rls_migration.sql
-- شغّل هذا بعد treasuries_migration_part2.sql (مرة واحدة، آمن للتكرار).
--
-- الجداول الجديدة (treasuries, treasury_transfers, balance_transfers)
-- اتعملت بدون أي RLS policy — بما إن RLS مفعّل افتراضياً في المشروع ده
-- على أي جدول جديد (زي ما أكّدت نتيجة استعلام pg_policies)، النتيجة إن
-- أي INSERT/SELECT من المتصفح كان بيترفض بالكامل ("new row violates
-- row-level security policy"). الحل: نفس القاعدة بالظبط المستخدمة في
-- supplier_payments/customer_payments/expenses —
--   • SELECT: أي مستخدم مسجّل دخول (auth.uid() IS NOT NULL)
--   • INSERT: admin أو accountant أو cashier بس (زي عمليات الخزنة التانية)
-- ════════════════════════════════════════════════════════════

ALTER TABLE treasuries ENABLE ROW LEVEL SECURITY;
ALTER TABLE treasury_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_transfers ENABLE ROW LEVEL SECURITY;

-- ── treasuries ──
DROP POLICY IF EXISTS treasuries_select ON treasuries;
CREATE POLICY treasuries_select ON treasuries FOR SELECT
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS treasuries_insert ON treasuries;
CREATE POLICY treasuries_insert ON treasuries FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['admin'::text, 'accountant'::text])
));

DROP POLICY IF EXISTS treasuries_update ON treasuries;
CREATE POLICY treasuries_update ON treasuries FOR UPDATE
USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['admin'::text, 'accountant'::text])
));

-- ── treasury_transfers ──
DROP POLICY IF EXISTS treasury_transfers_select ON treasury_transfers;
CREATE POLICY treasury_transfers_select ON treasury_transfers FOR SELECT
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS treasury_transfers_insert ON treasury_transfers;
CREATE POLICY treasury_transfers_insert ON treasury_transfers FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['admin'::text, 'accountant'::text, 'cashier'::text])
));

-- ── balance_transfers ──
DROP POLICY IF EXISTS balance_transfers_select ON balance_transfers;
CREATE POLICY balance_transfers_select ON balance_transfers FOR SELECT
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS balance_transfers_insert ON balance_transfers;
CREATE POLICY balance_transfers_insert ON balance_transfers FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['admin'::text, 'accountant'::text, 'cashier'::text])
));
