-- نفس حماية تكرار المزامنة اللي اتعملت لـ customer_payments، بس للفواتير:
-- عمود ref اختياري (يتبعت من تطبيق المندوب زي REP-SALE-<invoiceId محلي>)،
-- وفهرس فريد جزئي يمنع نفس الـ ref يتكرر في فاتورة confirmed تانية —
-- لو المزامنة اتكررت (retry بسبب مشكلة شبكة)، المحاولة التانية ترفض
-- بدل ما تنشئ فاتورة مكررة برقم جديد.
--
-- ملحوظة: CREATE OR REPLACE مع إضافة باراميتر جديد بينشئ overload تاني
-- بدل ما يستبدل القديم فى بوستجرس — لازم DROP للنسخة القديمة (12 باراميتر)
-- بعد إنشاء النسخة الجديدة (13 باراميتر، p_ref DEFAULT NULL) عشان مفيش
-- تعارض/التباس فى استدعاء الديسك توب (اللي مبيبعتش p_ref خالص).

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS ref text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_ref_confirmed_unique
    ON public.sales (ref)
    WHERE status = 'confirmed' AND ref IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_create_sale(
    p_customer_id uuid, p_payment_type text, p_subtotal numeric, p_vat_amount numeric,
    p_total numeric, p_discount numeric, p_warehouse_id uuid, p_rep_id uuid,
    p_treasury_id uuid, p_source_app text, p_created_by uuid, p_items jsonb,
    p_ref text DEFAULT NULL
)
RETURNS TABLE(id uuid, invoice_no text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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

    v_counter := fn_read_settings_counter('invoice_counter');

    IF v_counter IS NULL THEN
        v_counter := 1;
        INSERT INTO public.app_settings (key, value, updated_at)
        VALUES ('invoice_counter', to_jsonb('1'::text), now())
        ON CONFLICT (key) DO NOTHING;
    END IF;

    v_invoice_no := 'INV-' || lpad(v_counter::text, 4, '0');

    INSERT INTO public.sales
        (invoice_no, customer_id, payment_type, subtotal, vat_amount, total, discount,
         status, warehouse_id, rep_id, treasury_id, source_app, created_by, ref)
    VALUES
        (v_invoice_no, p_customer_id, p_payment_type, p_subtotal, p_vat_amount, p_total, p_discount,
         'confirmed', p_warehouse_id, p_rep_id, p_treasury_id, COALESCE(p_source_app, 'erp'), p_created_by, p_ref)
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

DROP FUNCTION IF EXISTS public.fn_create_sale(uuid, text, numeric, numeric, numeric, numeric, uuid, uuid, uuid, text, uuid, jsonb);
