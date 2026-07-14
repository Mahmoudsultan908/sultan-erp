-- ════════════════════════════════════════════════════════════
-- edit_reversal_atomic_migration.sql
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor.
-- آمن للتشغيل أكثر من مرة (CREATE OR REPLACE — idempotent).
--
-- السبب: تعديل فاتورة مبيعات/مشتريات قديمة كان بيلغي الفاتورة القديمة
-- ويرجّع المخزون ورصيد العميل/المورد عن طريق 3 نداءات منفصلة من
-- المتصفح (invReverseOldForEdit / purReverseOldForEdit في sales.js /
-- purchases.js) — لو حصل قطع اتصال أو تحديث للصفحة في نص الخطوات
-- التلاتة، ممكن يفضل المخزون أو الرصيد متسق جزئياً بس (مثلاً الفاتورة
-- القديمة اتلغت بس المخزون ما اترجعش).
--
-- الحل: نقل خطوات الإلغاء (تعليم الفاتورة ملغاة + إرجاع المخزون +
-- إرجاع الرصيد) لدالة واحدة في قاعدة البيانات بتتنفّذ كلها كعملية
-- واحدة (كلها بتنجح أو كلها بترجع) — بنفس الحسابات بالظبط اللي كانت
-- شغالة في JS، من غير أي تغيير في المنطق نفسه. خطوة "إنشاء الفاتورة
-- الجديدة" (بعد الإلغاء) فضلت زي ما هي في JS، من غير تغيير — عشان هي
-- نفس مسار الحفظ العادي المُختبر أصلاً لكل فاتورة جديدة.
-- ════════════════════════════════════════════════════════════

-- ── 1) عكس فاتورة مبيعات قديمة (تعليق للتعديل) ──
CREATE OR REPLACE FUNCTION fn_reverse_sale_for_edit(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_warehouse_id uuid;
    v_customer_id uuid;
    v_payment_type text;
    v_total numeric;
    r RECORD;
BEGIN
    SELECT warehouse_id, customer_id, payment_type, total
    INTO v_warehouse_id, v_customer_id, v_payment_type, v_total
    FROM sales WHERE id = p_sale_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'sale % not found', p_sale_id;
    END IF;

    -- 1) علّم الفاتورة القديمة كملغاة
    UPDATE sales SET status = 'cancelled' WHERE id = p_sale_id;

    -- 2) ارجع الكمية المخصومة من المخزون وقت الفاتورة القديمة (كمية + مجاني)
    --    ★ inventory_stock من غير عمود id — بنحدّث بالمفتاح المركّب
    --    (warehouse_id + product_id) مباشرة ونستخدم FOUND (متغيّر PL/pgSQL
    --    مدمج بيبقى true لو الـ UPDATE لمس صف فعلاً) بدل SELECT id الأول.
    IF v_warehouse_id IS NOT NULL THEN
        FOR r IN
            SELECT product_id, (COALESCE(qty,0) + COALESCE(free_qty,0)) AS need
            FROM sale_items WHERE sale_id = p_sale_id
        LOOP
            IF r.product_id IS NULL OR r.need = 0 THEN CONTINUE; END IF;

            UPDATE inventory_stock SET qty = COALESCE(qty,0) + r.need
            WHERE warehouse_id = v_warehouse_id AND product_id = r.product_id;

            IF NOT FOUND THEN
                INSERT INTO inventory_stock (warehouse_id, product_id, qty) VALUES (v_warehouse_id, r.product_id, r.need);
            END IF;
        END LOOP;
    END IF;

    -- 3) ارجع رصيد العميل لو كانت الفاتورة القديمة آجلة
    IF v_payment_type = 'credit' AND v_customer_id IS NOT NULL THEN
        UPDATE customers SET balance = COALESCE(balance,0) - COALESCE(v_total,0) WHERE id = v_customer_id;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_reverse_sale_for_edit(uuid) TO authenticated;

-- ── 2) عكس فاتورة مشتريات قديمة (تعليق للتعديل) ──
CREATE OR REPLACE FUNCTION fn_reverse_purchase_for_edit(p_purchase_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_warehouse_id uuid;
    v_supplier_id uuid;
    v_payment_type text;
    v_total numeric;
    r RECORD;
BEGIN
    SELECT warehouse_id, supplier_id, payment_type, total
    INTO v_warehouse_id, v_supplier_id, v_payment_type, v_total
    FROM purchases WHERE id = p_purchase_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'purchase % not found', p_purchase_id;
    END IF;

    -- 1) علّم فاتورة الشراء القديمة كملغاة
    UPDATE purchases SET status = 'cancelled' WHERE id = p_purchase_id;

    -- 2) اخصم الكمية اللي كانت اتضافت للمخزون وقت فاتورة الشراء القديمة
    --    (نفس منطق purReverseOldForEdit بالحرف: بيحدّث بس لو الصف موجود
    --    فعلاً، من غير إدراج صف جديد لو مش موجود — مطابق للسلوك الأصلي).
    --    ★ نفس ملاحظة inventory_stock من غير عمود id في الدالة اللي فوق.
    IF v_warehouse_id IS NOT NULL THEN
        FOR r IN
            SELECT product_id, COALESCE(qty,0) AS need
            FROM purchase_items WHERE purchase_id = p_purchase_id
        LOOP
            IF r.product_id IS NULL OR r.need = 0 THEN CONTINUE; END IF;

            UPDATE inventory_stock SET qty = COALESCE(qty,0) - r.need
            WHERE warehouse_id = v_warehouse_id AND product_id = r.product_id;
        END LOOP;
    END IF;

    -- 3) ارجع رصيد المورد لو كانت الفاتورة القديمة آجلة
    IF v_payment_type = 'credit' AND v_supplier_id IS NOT NULL THEN
        UPDATE suppliers SET balance = COALESCE(balance,0) - COALESCE(v_total,0) WHERE id = v_supplier_id;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_reverse_purchase_for_edit(uuid) TO authenticated;
