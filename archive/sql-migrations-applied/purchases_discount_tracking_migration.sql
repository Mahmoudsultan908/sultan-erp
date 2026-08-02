-- ════════════════════════════════════════════════════════════
-- المشتريات ماكنش فيها تخزين للخصم خالص (لا خصم إضافي على مستوى
-- الفاتورة، ولا نسبة خصم لكل سطر) — الخصم كان بيتحسب جوه line_total
-- بس من غير ما يتسجّل الرقم نفسه فين، فلما تفتح فاتورة شراء فيها خصم
-- للتعديل، الخصم بيختفي (النظام بيرجع للسعر الكامل). نفس فكرة sale_items
-- بالظبط (discount_pct موجود هناك من الأول، وfn_create_sale بيستقبل
-- p_discount من زمان).
-- ════════════════════════════════════════════════════════════

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS discount numeric DEFAULT 0;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS discount_pct numeric DEFAULT 0;

CREATE OR REPLACE FUNCTION public.fn_create_purchase(
    p_supplier_id uuid, p_payment_type text, p_subtotal numeric, p_vat_amount numeric,
    p_total numeric, p_warehouse_id uuid, p_treasury_id uuid, p_created_by uuid, p_items jsonb,
    p_discount numeric DEFAULT 0
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

    v_counter := fn_read_settings_counter('purchase_counter');

    IF v_counter IS NULL THEN
        v_counter := 1;
        INSERT INTO public.app_settings (key, value, updated_at)
        VALUES ('purchase_counter', to_jsonb('1'::text), now())
        ON CONFLICT (key) DO NOTHING;
    END IF;

    v_invoice_no := 'PUR-' || lpad(v_counter::text, 4, '0');

    INSERT INTO public.purchases
        (invoice_no, supplier_id, payment_type, subtotal, vat_amount, total, discount,
         status, warehouse_id, treasury_id, created_by)
    VALUES
        (v_invoice_no, p_supplier_id, p_payment_type, p_subtotal, p_vat_amount, p_total, p_discount,
         'confirmed', p_warehouse_id, p_treasury_id, p_created_by)
    RETURNING purchases.id INTO v_purchase_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        INSERT INTO public.purchase_items
            (purchase_id, product_id, qty, unit_price, line_total,
             deferred_rate, deferred_type, deferred_due_date, units_per_carton_snapshot, discount_pct)
        VALUES
            (v_purchase_id, (v_item->>'product_id')::uuid, (v_item->>'qty')::numeric,
             (v_item->>'unit_price')::numeric, (v_item->>'line_total')::numeric,
             COALESCE((v_item->>'deferred_rate')::numeric, 0),
             COALESCE(v_item->>'deferred_type', 'percent'),
             NULLIF(v_item->>'deferred_due_date', '')::date,
             COALESCE((v_item->>'units_per_carton_snapshot')::numeric, 1),
             COALESCE((v_item->>'discount_pct')::numeric, 0));
    END LOOP;

    UPDATE public.app_settings
    SET value = to_jsonb((v_counter + 1)::text), updated_at = now()
    WHERE key = 'purchase_counter';

    RETURN QUERY SELECT v_purchase_id, v_invoice_no;
END;
$function$;

-- CREATE OR REPLACE مع باراميتر جديد بيعمل overload تاني بدل ما يستبدل
-- القديم (باراميترات مختلفة العدد = دالة مختلفة في نظر Postgres) —
-- لازم نمسح النسخة القديمة (9 باراميتر، من غير p_discount) يدوياً:
DROP FUNCTION IF EXISTS public.fn_create_purchase(uuid, text, numeric, numeric, numeric, uuid, uuid, uuid, jsonb);
