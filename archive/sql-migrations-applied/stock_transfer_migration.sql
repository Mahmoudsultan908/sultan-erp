-- ════════════════════════════════════════════════════════════
-- stock_transfer_migration.sql
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor
-- آمن للتشغيل أكثر من مرة (كل أمر بيتحقق قبل ما يعمل حاجة)
--
-- الغرض: قبل هذا الملف، كانت شاشة "تحويل مخزون" (stock-transfer.js)
-- بتعدّل inventory_stock مباشرة من الـ JS من غير أي سجل تاريخي —
-- زي ما موثّق في تعليق warehouse-reports.js:
--   "⚠️ تحويلات المخزون (stock-transfer.js) مش متضمّنة في الحركة حالياً
--   لأنها بترفّع/تنقص inventory_stock مباشرة من غير ما تسجّل سجل تاريخي."
-- هذا الملف بيضيف جدول رأس (stock_transfers) + جدول بنود
-- (stock_transfer_items) لتسجيل تاريخ كل عملية تحويل بأصنافها،
-- بنفس فلسفة sales_returns/sale_return_items في returns_migration.sql:
-- الواجهة (stock-transfer.js) بتعمل INSERT فقط على الرأس ثم البنود،
-- والـ trigger هنا هو اللي بيحرّك inventory_stock تلقائياً.
--
-- ملاحظة نطاق: تحويل المخزون نقل فيزيائي بحت — لا يوجد قيد محاسبي ولا
-- تأثير على رصيد عميل/مورد/خزنة (نفس فلسفة treasury_transfers في
-- treasuries_migration.sql: INSERT-only، بدون عمود status/إلغاء —
-- تحويل غلط بيتصلّح بعمل تحويل عكسي مماثل).
-- ════════════════════════════════════════════════════════════

-- ── 1) جدول رأس التحويل (لو مش موجود) ──
CREATE TABLE IF NOT EXISTS stock_transfers (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_no        text NOT NULL,
    from_warehouse_id  uuid NOT NULL REFERENCES warehouses(id),
    to_warehouse_id    uuid NOT NULL REFERENCES warehouses(id),
    transfer_date      date NOT NULL DEFAULT CURRENT_DATE,
    notes              text,
    created_by         uuid,
    created_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (from_warehouse_id <> to_warehouse_id)
);
-- أعمدة قد تكون ناقصة لو الجدول كان موجوداً بالفعل بشكل جزئي
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE stock_transfers ADD COLUMN IF NOT EXISTS created_by uuid;

-- ── 2) جدول بنود التحويل (صنف + كمية لكل سطر، لو مش موجود) ──
CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_id   uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id    uuid NOT NULL REFERENCES products(id),
    qty           numeric NOT NULL CHECK (qty > 0),
    unit_name     text
);

-- ── 3) تفعيل RLS + سياسة بسيطة (المستخدمون المسجّلون فقط) ──
ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_stock_transfers" ON stock_transfers;
CREATE POLICY "auth_all_stock_transfers" ON stock_transfers FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "auth_all_stock_transfer_items" ON stock_transfer_items;
CREATE POLICY "auth_all_stock_transfer_items" ON stock_transfer_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════
-- 4) Trigger: تحديث المخزون تلقائياً عند إضافة بند تحويل
--    بيخصم الكمية من مخزن المصدر (from_warehouse_id) ويضيفها
--    لمخزن الهدف (to_warehouse_id) — قراءة الرأس عن طريق transfer_id.
-- ════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_stock_transfer_item_apply() RETURNS trigger
SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from uuid; v_to uuid;
BEGIN
    SELECT from_warehouse_id, to_warehouse_id INTO v_from, v_to
    FROM stock_transfers WHERE id = NEW.transfer_id;

    IF v_from IS NOT NULL THEN
        UPDATE inventory_stock SET qty = qty - NEW.qty
        WHERE warehouse_id = v_from AND product_id = NEW.product_id;
    END IF;

    IF v_to IS NOT NULL THEN
        INSERT INTO inventory_stock (warehouse_id, product_id, qty)
        VALUES (v_to, NEW.product_id, NEW.qty)
        ON CONFLICT (warehouse_id, product_id)
        DO UPDATE SET qty = inventory_stock.qty + NEW.qty;
    END IF;

    RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_transfer_item_apply ON stock_transfer_items;
CREATE TRIGGER trg_stock_transfer_item_apply
    AFTER INSERT ON stock_transfer_items
    FOR EACH ROW EXECUTE FUNCTION fn_stock_transfer_item_apply();

-- ملاحظة: SECURITY DEFINER بيخلي المشغل يشتغل بصلاحية مالك الدالة
-- (عادة postgres في Supabase) بدل صلاحية المستخدم المسجّل دخوله،
-- وده اللي بيحل خطأ "new row violates row-level security policy"
-- اللي بيظهر لأن جدول inventory_stock عنده RLS مفعّل بدون سياسة
-- INSERT/UPDATE للمستخدم العادي.
-- الملف بالكامل آمن لإعادة التشغيل (idempotent) — لو شغّلته قبل كده،
-- شغّله تاني زي ما هو وهيحدّث الدالة بالنسخة الجديدة دي تلقائياً
-- (CREATE OR REPLACE).
--
-- ملاحظة: js/modules/stock-transfer.js الجديد بيتحقق من توفّر الكمية
-- في مخزن المصدر قبل الحفظ (client-side)، لكن ده تحقق واجهة بس —
-- لو حابب حماية إضافية على مستوى القاعدة (منع qty سالب في inventory_stock)
-- ضيف CHECK أو trigger BEFORE على inventory_stock بنفسك حسب حاجتك،
-- الملف ده اكتفى بنفس مستوى الحماية المستخدم في returns_migration.sql.
