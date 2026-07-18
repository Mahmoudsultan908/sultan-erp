-- ════════════════════════════════════════════════════════════
-- جرد فعلي للمخزون (تسوية) — من طلبات رسالة_للمطور.md
--
-- تصميم متعمد بسيط: تسجيل الكمية المعدودة فعليًا لكل صنف في مخزن
-- معيّن، مقارنتها بالكمية في النظام وقت الجرد (system_qty، بتتاخد
-- snapshot وقت الحفظ)، وتطبيق الكمية المعدودة مباشرة على
-- inventory_stock (تصحيح فعلي، مش قيد محاسبي جديد ولا حركة مخزون
-- منفصلة — نفس أسلوب باقي دوال تصحيح المخزون في هذا المشروع، زي
-- fn_purchase_return_item_stock، مفيش تجريد "حركة مخزون" مستقل).
--
-- ★ قرار تصميم مقصود: مفيش أي أثر محاسبي (قيد يومية) للفرق الناتج عن
--   الجرد — الجدولين دول سجل تدقيق بس (system_qty وقت الجرد، الكمية
--   المعدودة، والفرق) لمعرفة تاريخ التسويات، بدون ربطه بأي حساب
--   "عجز/زيادة مخزون". لو محتاجين الأثر المالي ده لاحقًا (مثلاً حساب
--   قيمة العجز كمصروف)، محتاج قرار منفصل مع صاحب المشروع أولًا.
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
BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'لا يوجد أي صنف تم إدخال كمية معدودة له';
    END IF;

    INSERT INTO public.stock_counts (warehouse_id, notes, created_by)
    VALUES (p_warehouse_id, p_notes, p_created_by)
    RETURNING id INTO v_count_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        INSERT INTO public.stock_count_items (count_id, product_id, system_qty, counted_qty, unit_name)
        VALUES (
            v_count_id,
            (v_item->>'product_id')::uuid,
            COALESCE((v_item->>'system_qty')::numeric, 0),
            COALESCE((v_item->>'counted_qty')::numeric, 0),
            v_item->>'unit_name'
        );

        INSERT INTO public.inventory_stock (warehouse_id, product_id, qty)
        VALUES (p_warehouse_id, (v_item->>'product_id')::uuid, COALESCE((v_item->>'counted_qty')::numeric, 0))
        ON CONFLICT (warehouse_id, product_id)
        DO UPDATE SET qty = COALESCE((v_item->>'counted_qty')::numeric, 0);
    END LOOP;

    RETURN v_count_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_apply_stock_count(uuid, text, uuid, jsonb) TO authenticated;
