-- ════════════════════════════════════════════════════════════
-- treasuries_migration.sql
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor.
-- آمن للتشغيل أكثر من مرة (CREATE OR REPLACE / IF NOT EXISTS — idempotent).
--
-- الجزء ده (Phase 1 من خطة "دعم خزن متعددة") هو الأجزاء المستقلة اللي
-- ما بتلمسش أي trigger موجود فعلياً وشغال على sales/purchases/
-- supplier_payments/customer_payments/expenses/returns — عشان كده أمان
-- تشغيلها من غير ما نشوف تعريف الـ triggers القديمة الأول.
--
-- ما اتضافش هنا لسه (محتاج نتيجة استعلامات Phase 0 من Supabase عشان
-- نكتبه صح من غير ما نكسر حاجة شغالة):
--   • عمود treasury_id على: sales, purchases, sales_returns,
--     purchase_returns, supplier_payments, customer_payments, expenses
--     (عمود cash_transactions.treasury_id نفسه اتضاف تحت — ده آمن لوحده
--     لأنه بس عمود جديد فاضي، لكن اللي محتاج Phase 0 هو تعديل الـ
--     triggers الحالية عشان "تملأه" وقت أي عملية جديدة).
--   • جدول balance_transfers + الـ 3 triggers بتاعته (عميل↔عميل،
--     مورد↔مورد، مورد→خزنة) — محتاجة نعرف إزاي journal_entries/
--     journal_entry_lines بتتربط بحساب العميل/المورد الأول.
--
-- ⚠️ ملاحظة مهمة على get_cash_balance() تحت: الدالة الجديدة مبنية على
-- افتراض إن المنطق الحالي هو ببساطة مجموع (in - out) من cash_transactions
-- (نفس الحساب اللي js/modules/cash-movement.js بيعمله في المتصفح بالضبط
-- ويعرضه جنب رقم الـ RPC، فلو كانا مختلفين كان هيبان كباج ظاهر من زمان).
-- لو الدالة الحقيقية فيها منطق إضافي (مثلاً استبعاد status معيّن)، عدّل
-- الـ WHERE هنا يطابقها قبل ما تشغّل الملف.
-- ════════════════════════════════════════════════════════════

-- ── 1) جدول الخزن ──
CREATE TABLE IF NOT EXISTS treasuries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    is_default boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- خزنة افتراضية واحدة بس مسموح بيها في نفس الوقت
CREATE UNIQUE INDEX IF NOT EXISTS treasuries_one_default
    ON treasuries (is_default) WHERE is_default;

-- زرع 3 خزن بس لو الجدول فاضي (عشان الملف يفضل آمن للتشغيل تاني)
INSERT INTO treasuries (name, is_default)
SELECT * FROM (VALUES
    ('الخزنة الرئيسية', true),
    ('خزنة كاش', false),
    ('خزنة احتياطية', false)
) AS seed(name, is_default)
WHERE NOT EXISTS (SELECT 1 FROM treasuries);

-- ── 1.5) عمود treasury_id على cash_transactions ──
-- إضافة عمود فاضي بس (قابل للـ NULL) — ما بيلمسش أي trigger موجود ولا
-- بيغيّر سلوك أي INSERT حالي. السجلات القديمة كلها بتتحول للخزنة
-- الافتراضية (الرئيسية) عشان أرصدتها القديمة تفضل ظاهرة صح في
-- get_treasury_balances() تحت، بدل ما تتفقد لأنها treasury_id = NULL.
ALTER TABLE cash_transactions ADD COLUMN IF NOT EXISTS treasury_id uuid REFERENCES treasuries(id);

UPDATE cash_transactions
SET treasury_id = (SELECT id FROM treasuries WHERE is_default LIMIT 1)
WHERE treasury_id IS NULL;

-- ── 2) رصيد كل خزنة على حدة ──
CREATE OR REPLACE FUNCTION get_treasury_balances()
RETURNS TABLE(treasury_id uuid, treasury_name text, is_default boolean, balance numeric)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT
        t.id,
        t.name,
        t.is_default,
        COALESCE(SUM(CASE WHEN ct.direction = 'in' THEN ct.amount
                           WHEN ct.direction = 'out' THEN -ct.amount
                           ELSE 0 END), 0) AS balance
    FROM treasuries t
    LEFT JOIN cash_transactions ct ON ct.treasury_id = t.id
    WHERE t.is_active
    GROUP BY t.id, t.name, t.is_default
    ORDER BY t.is_default DESC, t.name;
$$;

GRANT EXECUTE ON FUNCTION get_treasury_balances() TO authenticated;

-- ── 3) get_cash_balance() تدعم فلترة اختيارية بخزنة واحدة ──
-- من غير باراميتر (زي كل نداءات الـ JS الحالية) لسه بترجع الإجمالي عبر
-- كل الخزن — سلوك backward-compatible بالكامل.
CREATE OR REPLACE FUNCTION get_cash_balance(p_treasury_id uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN amount
                              WHEN direction = 'out' THEN -amount
                              ELSE 0 END), 0)
    FROM cash_transactions
    WHERE p_treasury_id IS NULL OR treasury_id = p_treasury_id;
$$;

GRANT EXECUTE ON FUNCTION get_cash_balance(uuid) TO authenticated;

-- ── 4) تحويل بين الخزن — حركة نقدية داخلية بحتة، من غير قيد محاسبي ──
-- (حساب "النقدية" في شجرة الحسابات واحد بس — الخزن تقسيم تشغيلي، مش
-- حسابات GL منفصلة، فالتحويل بينها ما بيغيّرش إجمالي رصيد النقدية).
CREATE TABLE IF NOT EXISTS treasury_transfers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    from_treasury_id uuid NOT NULL REFERENCES treasuries(id),
    to_treasury_id uuid NOT NULL REFERENCES treasuries(id),
    amount numeric NOT NULL CHECK (amount > 0),
    notes text,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (from_treasury_id <> to_treasury_id)
);

CREATE OR REPLACE FUNCTION fn_treasury_transfer_cash()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- ★ لو cash_transactions فيها أعمدة NOT NULL غير الموجودة هنا (مثلاً
    --   created_by إجباري)، ضيفها للـ INSERT دول بعد ما تشوف نتيجة Phase 0.
    INSERT INTO cash_transactions (treasury_id, direction, amount, reason, ref_type)
    VALUES (NEW.from_treasury_id, 'out', NEW.amount, 'تحويل إلى خزنة أخرى', 'treasury_transfer');

    INSERT INTO cash_transactions (treasury_id, direction, amount, reason, ref_type)
    VALUES (NEW.to_treasury_id, 'in', NEW.amount, 'تحويل من خزنة أخرى', 'treasury_transfer');

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_treasury_transfer ON treasury_transfers;
CREATE TRIGGER trg_treasury_transfer
    AFTER INSERT ON treasury_transfers
    FOR EACH ROW EXECUTE FUNCTION fn_treasury_transfer_cash();
