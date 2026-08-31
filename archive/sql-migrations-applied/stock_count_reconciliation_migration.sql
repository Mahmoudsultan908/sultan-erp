-- ════════════════════════════════════════════════════════════
-- جرد فعلي للمخزون (تسوية) — من طلبات رسالة_للمطور.md
--
-- تصميم متعمد بسيط: تسجيل الكمية المعدودة فعليًا لكل صنف في مخزن
-- معيّن، مقارنتها بالكمية في النظام وقت الجرد (system_qty، بتتاخد
-- snapshot وقت الحفظ)، وتطبيق الكمية المعدودة مباشرة على
-- inventory_stock (تصحيح فعلي) مع سجل تدقيق وحركة تسوية محاسبية.
-- الفرق يُثبت على حسابي "عجز مخزون" و"زيادة مخزون" حسب تكلفة الشراء.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.stock_counts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_id uuid NOT NULL REFERENCES public.warehouses(id),
    notes text,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.stock_count_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    count_id uuid NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES public.products(id),
    system_qty numeric NOT NULL DEFAULT 0,
    counted_qty numeric NOT NULL DEFAULT 0,
    diff numeric GENERATED ALWAYS AS (counted_qty - system_qty) STORED,
    unit_name text
);

ALTER TABLE public.stock_count_items
    ADD COLUMN IF NOT EXISTS unit_cost numeric NOT NULL DEFAULT 0;

INSERT INTO public.accounts (code, name, type, is_active)
VALUES ('4020', 'زيادة مخزون', 'revenue', true), ('5020', 'عجز مخزون', 'expense', true)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_count_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_counts_all ON public.stock_counts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY stock_count_items_all ON public.stock_count_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- الدالة الذرّية: هيدر + بنود + تحديث inventory_stock الفعلي كلهم في
-- ترانزاكشن واحدة (لو أي بند فشل، بوستجرِس بيرجع كل حاجة تلقائيًا —
-- نفس فلسفة fn_create_sale/fn_create_purchase الأخرى في هذا المشروع)
CREATE OR REPLACE FUNCTION public.fn_apply_stock_count(
    p_warehouse_id uuid,
    p_notes text,
    p_created_by uuid,
    p_items jsonb  -- [{product_id, system_qty, counted_qty, unit_name}, ...]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_count_id uuid;
    v_item jsonb;
    v_product_id uuid;
    v_system_qty numeric;
    v_counted_qty numeric;
    v_unit_cost numeric;
    v_diff numeric;
    v_shortage_value numeric := 0;
    v_surplus_value numeric := 0;
    v_lines jsonb := '[]'::jsonb;
BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'لا يوجد أي صنف تم إدخال كمية معدودة له';
    END IF;

    INSERT INTO public.stock_counts (warehouse_id, notes, created_by)
    VALUES (p_warehouse_id, p_notes, p_created_by)
    RETURNING id INTO v_count_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::uuid;
        v_counted_qty := COALESCE((v_item->>'counted_qty')::numeric, 0);
        SELECT COALESCE(s.qty, 0) INTO v_system_qty FROM public.inventory_stock s
        WHERE s.warehouse_id = p_warehouse_id AND s.product_id = v_product_id;
        SELECT COALESCE(p.purchase_price, 0) INTO v_unit_cost FROM public.products p WHERE p.id = v_product_id;
        v_system_qty := COALESCE(v_system_qty, 0);
        v_unit_cost := COALESCE(v_unit_cost, 0);
        v_diff := v_counted_qty - v_system_qty;

        INSERT INTO public.stock_count_items (count_id, product_id, system_qty, counted_qty, unit_name, unit_cost)
        VALUES (
            v_count_id,
            v_product_id, v_system_qty, v_counted_qty, v_item->>'unit_name', v_unit_cost
        );

        INSERT INTO public.inventory_stock (warehouse_id, product_id, qty)
        VALUES (p_warehouse_id, v_product_id, v_counted_qty)
        ON CONFLICT (warehouse_id, product_id)
        DO UPDATE SET qty = EXCLUDED.qty;

        IF v_diff < 0 THEN v_shortage_value := v_shortage_value + abs(v_diff) * v_unit_cost;
        ELSIF v_diff > 0 THEN v_surplus_value := v_surplus_value + v_diff * v_unit_cost;
        END IF;
    END LOOP;

    IF v_shortage_value > 0 THEN
        v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','5020','debit',v_shortage_value,'credit',0), jsonb_build_object('account_code','1004','debit',0,'credit',v_shortage_value));
    END IF;
    IF v_surplus_value > 0 THEN
        v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_code','1004','debit',v_surplus_value,'credit',0), jsonb_build_object('account_code','4020','debit',0,'credit',v_surplus_value));
    END IF;
    IF jsonb_array_length(v_lines) > 0 THEN
        PERFORM public.post_journal('STK-' || substr(v_count_id::text, 1, 12), 'تسوية جرد مخزون', 'stock_count', v_count_id, p_created_by, v_lines);
    END IF;

    RETURN v_count_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_apply_stock_count(uuid, text, uuid, jsonb) TO authenticated;
