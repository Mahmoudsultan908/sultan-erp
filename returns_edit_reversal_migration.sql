-- ════════════════════════════════════════════════════════════
-- returns_edit_reversal_migration.sql
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor — بعد ما
-- returns_migration.sql (جداول sales_returns/purchase_returns وتريجرز
-- المخزون/الرصيد بتاعتها) يكون شغّال فعلاً.
-- آمن للتشغيل أكثر من مرة (CREATE OR REPLACE — idempotent).
--
-- السبب: صفحة "مراجعة الفواتير" (invoice-review.js) اتوسّعت عشان
-- تدعم تعديل مرتجعات المبيعات/المشتريات، بنفس فلسفة تعديل الفواتير
-- العادية (edit_reversal_atomic_migration.sql): تعديل مرتجع = إلغاء
-- المرتجع القديم (وعكس أثره على المخزون/الرصيد) + تسجيل مرتجع جديد،
-- بدل التعديل المباشر فوق نفس السجل — عشان يفضل فيه أثر تاريخي (audit
-- trail) لكل تعديل.
--
-- الدالتين دول بيعكسوا بالظبط عكس اتجاه تريجرز returns_migration.sql:
--   • fn_sale_return_item_stock   بيزوّد المخزون  → العكس: بينقصه
--   • fn_sales_return_balance     بينقص رصيد العميل (لو آجل) → العكس: بيزوّده
--   • fn_purchase_return_item_stock بينقص المخزون → العكس: بيزوّده
--   • fn_purchase_return_balance  بينقص رصيد المورد → العكس: بيزوّده
-- ════════════════════════════════════════════════════════════

-- ── 1) عكس مرتجع مبيعات قديم (تعليق للتعديل) ──
CREATE OR REPLACE FUNCTION fn_reverse_sales_return_for_edit(p_return_id uuid)
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
    FROM sales_returns WHERE id = p_return_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'sales_return % not found', p_return_id;
    END IF;

    -- 1) علّم المرتجع القديم كملغى
    UPDATE sales_returns SET status = 'cancelled' WHERE id = p_return_id;

    -- 2) اخصم الكمية اللي كانت اترجّعت للمخزون وقت المرتجع القديم
    --    (عكس fn_sale_return_item_stock اللي بيزوّد المخزون عند INSERT)
    IF v_warehouse_id IS NOT NULL THEN
        FOR r IN
            SELECT product_id, COALESCE(qty,0) AS need
            FROM sale_return_items WHERE return_id = p_return_id
        LOOP
            IF r.product_id IS NULL OR r.need = 0 THEN CONTINUE; END IF;

            UPDATE inventory_stock SET qty = COALESCE(qty,0) - r.need
            WHERE warehouse_id = v_warehouse_id AND product_id = r.product_id;
        END LOOP;
    END IF;

    -- 3) ارجّع رصيد العميل لو كان المرتجع القديم آجل
    --    (عكس fn_sales_return_balance اللي بينقص رصيد العميل عند INSERT)
    IF v_payment_type = 'credit' AND v_customer_id IS NOT NULL THEN
        UPDATE customers SET balance = COALESCE(balance,0) + COALESCE(v_total,0) WHERE id = v_customer_id;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_reverse_sales_return_for_edit(uuid) TO authenticated;

-- ── 2) عكس مرتجع مشتريات قديم (تعليق للتعديل) ──
CREATE OR REPLACE FUNCTION fn_reverse_purchase_return_for_edit(p_return_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_warehouse_id uuid;
    v_supplier_id uuid;
    v_total numeric;
    r RECORD;
BEGIN
    SELECT warehouse_id, supplier_id, total
    INTO v_warehouse_id, v_supplier_id, v_total
    FROM purchase_returns WHERE id = p_return_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'purchase_return % not found', p_return_id;
    END IF;

    -- 1) علّم المرتجع القديم كملغى
    UPDATE purchase_returns SET status = 'cancelled' WHERE id = p_return_id;

    -- 2) رجّع الكمية اللي كانت اتخصمت من المخزون وقت المرتجع القديم
    --    (عكس fn_purchase_return_item_stock اللي بينقص المخزون عند INSERT)
    IF v_warehouse_id IS NOT NULL THEN
        FOR r IN
            SELECT product_id, COALESCE(qty,0) AS need
            FROM purchase_return_items WHERE return_id = p_return_id
        LOOP
            IF r.product_id IS NULL OR r.need = 0 THEN CONTINUE; END IF;

            UPDATE inventory_stock SET qty = COALESCE(qty,0) + r.need
            WHERE warehouse_id = v_warehouse_id AND product_id = r.product_id;

            IF NOT FOUND THEN
                INSERT INTO inventory_stock (warehouse_id, product_id, qty) VALUES (v_warehouse_id, r.product_id, r.need);
            END IF;
        END LOOP;
    END IF;

    -- 3) ارجّع رصيد المورد (fn_purchase_return_balance بينقص رصيد المورد
    --    عند INSERT من غير شرط على payment_type — فالعكس هنا كمان من غير شرط)
    IF v_supplier_id IS NOT NULL THEN
        UPDATE suppliers SET balance = COALESCE(balance,0) + COALESCE(v_total,0) WHERE id = v_supplier_id;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_reverse_purchase_return_for_edit(uuid) TO authenticated;

-- ملاحظة: زي edit_reversal_atomic_migration.sql بالظبط — الدالتين دول
-- بيتنفّذوا كعملية واحدة ذرّية (كلها بتنجح أو كلها بترجع) بدل نداءات
-- منفصلة من المتصفح، عشان لو حصل قطع اتصال في نص الخطوات ميفضلش
-- المخزون/الرصيد متسق جزئياً بس.
