-- ════════════════════════════════════════════════════════════
-- مراجعة محاسبية/مالية: نفس فئة إصلاح مرتجعات الشراء/البيع النهاردة
-- (purchase_return_no_journal_duplicate_fix_migration.sql /
-- sales_return_atomic_creation_and_dead_twin_cleanup_migration.sql)،
-- بس لفواتير المبيعات والمشتريات نفسها — أهم وأكتر استخدامًا حاجة
-- في النظام كله. مطبَّق مباشرة على القاعدة الحية عبر Supabase MCP،
-- الملف ده للسجل في الريبو.
--
-- التأكيد جه من مراجعة الـ triggers مباشرة (مش تخمين): كل من
-- fn_sale_status_change و fn_purchase_status_change بترحّل قيد
-- اليومية وتأثر على رصيد العميل/المورد فور INSERT الهيدر (status=
-- 'confirmed' مباشرة) — قبل ما البنود تتسجل أصلاً في sale_items/
-- purchase_items. sales.js و purchases.js كانوا بيعملوا 3-4 خطوات
-- منفصلة (هيدر → بنود → تحديث كاش محلي → زيادة عداد)، وأي فشل بين
-- إدراج الهيدر وإدراج البنود كان بيسيب هيدر "confirmed" معلّق بقيد
-- وبرصيد متأثر من غير بنود، والعداد ميترفعش، فأي محاولة تانية كانت
-- هتتصادم على نفس invoice_no.
--
-- دليل إضافي على إن ده مش نظري بس: sales.js فيه تعليق قديم (كان في
-- invSave قبل الإصلاح) بيوصف بالظبط نفس الاحتمالية دي، والمعالجة
-- الوحيدة كانت فحص تكرار قبل الإدراج (بيوضّح الخطأ بس مايمنعوش).
-- كمان اتلاقى عداد invoice_counter نفسه فاسد (jsonb string مُرمّز
-- مرتين، يعني JS بتاعة parseInt() كانت بترجع NaN وتقع على fallback=1،
-- وده كان هيسبب تصادم فوري على INV-0001 (موجود بالفعل) لأول حد
-- يحاول يسجّل فاتورة بيع جديدة من الواجهة الحية دلوقتي) — اتصلح
-- بتطبيع القيمة، ومنطق الدالة الذرّية الجديدة بيتعامل مع الحالتين
-- (jsonb نظيف أو متسخ) بأمان.
--
-- الحل: fn_create_sale/fn_create_purchase (SECURITY DEFINER) بتعمل
-- هيدر + بنود + عداد جوه ترانزاكشن واحدة، بنفس ترتيب الإدراج القديم
-- بالظبط (فحلقات التريجرات الميتة no-op جوه fn_sale_status_change/
-- fn_purchase_status_change فضلت بنفس سلوكها الحالي من غير أي تغيير).
-- sales.js (المسار الأونلاين + معالج مزامنة الأوفلاين registerSyncHandler
-- ('sale', ...)) و purchases.js اتعدّلوا عشان ينادوا الدالتين دول
-- بدل الخطوات المنفصلة القديمة.
-- ════════════════════════════════════════════════════════════

-- تطبيع عداد invoice_counter الفاسد (jsonb مُرمّز مرتين)
UPDATE public.app_settings SET value = to_jsonb('12'::text), updated_at = now()
WHERE key = 'invoice_counter' AND value #>> '{}' <> (value #>> '{}');
-- (تُرك هنا كتوثيق فقط — القيمة الفعلية اتصلحت وقت التنفيذ المباشر
--  بناءً على آخر رقم فاتورة حقيقي وقتها؛ لو اتشغّل الملف ده لاحقًا
--  على نسخة تانية، راجع أعلى invoice_no في جدول sales وطبّع القيمة يدويًا)

CREATE OR REPLACE FUNCTION public.fn_create_sale(
    p_customer_id uuid,
    p_payment_type text,
    p_subtotal numeric,
    p_vat_amount numeric,
    p_total numeric,
    p_discount numeric,
    p_warehouse_id uuid,
    p_rep_id uuid,
    p_treasury_id uuid,
    p_source_app text,
    p_created_by uuid,
    p_items jsonb
)
RETURNS TABLE(id uuid, invoice_no text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_counter int;
    v_invoice_no text;
    v_sale_id uuid;
    v_item jsonb;
BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'لا يمكن إنشاء فاتورة بيع بدون أصناف';
    END IF;

    SELECT COALESCE((value #>> '{}')::int, 1) INTO v_counter
    FROM public.app_settings WHERE key = 'invoice_counter'
    FOR UPDATE;

    IF v_counter IS NULL THEN
        v_counter := 1;
        INSERT INTO public.app_settings (key, value, updated_at)
        VALUES ('invoice_counter', to_jsonb('1'::text), now())
        ON CONFLICT (key) DO NOTHING;
    END IF;

    v_invoice_no := 'INV-' || lpad(v_counter::text, 4, '0');

    INSERT INTO public.sales
        (invoice_no, customer_id, payment_type, subtotal, vat_amount, total, discount,
         status, warehouse_id, rep_id, treasury_id, source_app, created_by)
    VALUES
        (v_invoice_no, p_customer_id, p_payment_type, p_subtotal, p_vat_amount, p_total, p_discount,
         'confirmed', p_warehouse_id, p_rep_id, p_treasury_id, COALESCE(p_source_app, 'erp'), p_created_by)
    RETURNING sales.id INTO v_sale_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        INSERT INTO public.sale_items
            (sale_id, product_id, qty, unit_price, line_total, unit_type,
             units_per_carton_snapshot, discount_pct, free_qty, cost_price_snapshot, unit_name)
        VALUES
            (v_sale_id, (v_item->>'product_id')::uuid, (v_item->>'qty')::numeric,
             (v_item->>'unit_price')::numeric, (v_item->>'line_total')::numeric,
             COALESCE(v_item->>'unit_type', 'sale_unit'),
             COALESCE((v_item->>'units_per_carton_snapshot')::numeric, 1),
             COALESCE((v_item->>'discount_pct')::numeric, 0),
             COALESCE((v_item->>'free_qty')::numeric, 0),
             COALESCE((v_item->>'cost_price_snapshot')::numeric, 0),
             v_item->>'unit_name');
    END LOOP;

    UPDATE public.app_settings
    SET value = to_jsonb((v_counter + 1)::text), updated_at = now()
    WHERE key = 'invoice_counter';

    RETURN QUERY SELECT v_sale_id, v_invoice_no;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_create_sale(
    uuid, text, numeric, numeric, numeric, numeric, uuid, uuid, uuid, text, uuid, jsonb
) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_create_purchase(
    p_supplier_id uuid,
    p_payment_type text,
    p_subtotal numeric,
    p_vat_amount numeric,
    p_total numeric,
    p_warehouse_id uuid,
    p_treasury_id uuid,
    p_created_by uuid,
    p_items jsonb
)
RETURNS TABLE(id uuid, invoice_no text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_counter int;
    v_invoice_no text;
    v_purchase_id uuid;
    v_item jsonb;
BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'لا يمكن إنشاء فاتورة شراء بدون أصناف';
    END IF;

    SELECT COALESCE((value #>> '{}')::int, 1) INTO v_counter
    FROM public.app_settings WHERE key = 'purchase_counter'
    FOR UPDATE;

    IF v_counter IS NULL THEN
        v_counter := 1;
        INSERT INTO public.app_settings (key, value, updated_at)
        VALUES ('purchase_counter', to_jsonb('1'::text), now())
        ON CONFLICT (key) DO NOTHING;
    END IF;

    v_invoice_no := 'PUR-' || lpad(v_counter::text, 4, '0');

    INSERT INTO public.purchases
        (invoice_no, supplier_id, payment_type, subtotal, vat_amount, total,
         status, warehouse_id, treasury_id, created_by)
    VALUES
        (v_invoice_no, p_supplier_id, p_payment_type, p_subtotal, p_vat_amount, p_total,
         'confirmed', p_warehouse_id, p_treasury_id, p_created_by)
    RETURNING purchases.id INTO v_purchase_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        INSERT INTO public.purchase_items
            (purchase_id, product_id, qty, unit_price, line_total,
             deferred_rate, deferred_type, deferred_due_date, units_per_carton_snapshot)
        VALUES
            (v_purchase_id, (v_item->>'product_id')::uuid, (v_item->>'qty')::numeric,
             (v_item->>'unit_price')::numeric, (v_item->>'line_total')::numeric,
             COALESCE((v_item->>'deferred_rate')::numeric, 0),
             COALESCE(v_item->>'deferred_type', 'percent'),
             NULLIF(v_item->>'deferred_due_date', '')::date,
             COALESCE((v_item->>'units_per_carton_snapshot')::numeric, 1));
    END LOOP;

    UPDATE public.app_settings
    SET value = to_jsonb((v_counter + 1)::text), updated_at = now()
    WHERE key = 'purchase_counter';

    RETURN QUERY SELECT v_purchase_id, v_invoice_no;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_create_purchase(
    uuid, text, numeric, numeric, numeric, uuid, uuid, uuid, jsonb
) TO authenticated;
