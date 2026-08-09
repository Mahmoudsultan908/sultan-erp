-- ════════════════════════════════════════════════════════════
-- نظام نقاط ولاء حقيقي للعملاء (سلطانو) — loyalty_points_migration.sql
-- مسودة (لسه مش متنفذة). إضافة بحتة فقط — مفيش أي تعديل أو حذف
-- على جدول موجود، ومفيش أي تريجر أو RPC موجود بيتلمس.
--
-- القواعد اللي اتفق عليها 2026-08-09:
--  - نسبة النقاط (نقطة لكل كام جنيه) قابلة للتعديل من سلطان ERP
--    (إعداد جديد في app_settings)، مش مرقّمة في الكود.
--  - النقاط بتتحسب لما الطلب يوصل لحالة 'delivered' فعليًا (مش وقت
--    الإنشاء) — عشان النقاط تتربط بطلب اتنفذ حقيقي، مش طلب ممكن يتلغي.
--  - النظام كله مطفي افتراضيًا (sultanoo_loyalty_enabled = false) —
--    محدش بياخد نقاط ولا بيشوف حاجة في سلطانو لحد ما يتفعّل يدويًا.
--  - الاستبدال يدوي في V1 (مفيش خصم أوتوماتيكي على الفاتورة) — لما
--    العميل يطلب الاستبدال (واتساب)، الموظف/الأونر بيسجّل حركة سالبة
--    يدويًا في الليدجر من سلطان ERP.
--  - نفس نمط الحماية من الاحتساب المزدوج المتّبع في باقي النظام
--    (returns_migration.sql، sales_ref_idempotency_migration.sql):
--    التريجر بيتأكد إن مفيش سطر ليدجر لنفس الطلب قبل ما يحتسب نقاط.
-- ════════════════════════════════════════════════════════════

-- 1. رصيد النقاط على جدول العملاء نفسه (قراءة سريعة، بيتحدّث بس عن طريق التريجر/دالة الاستبدال) --
ALTER TABLE public.customers
    ADD COLUMN IF NOT EXISTS loyalty_points_balance numeric(14,2) NOT NULL DEFAULT 0;

-- 2. دفتر حركة النقاط (كل عملية إضافة/استبدال كسطر، للمراجعة والتدقيق) --
CREATE TABLE IF NOT EXISTS public.loyalty_points_ledger (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id  uuid NOT NULL REFERENCES public.customers(id),
    order_id     uuid REFERENCES public.customer_orders(id),  -- فاضي لحركات الاستبدال اليدوي
    points_delta numeric(14,2) NOT NULL,                       -- موجب = اكتساب، سالب = استبدال
    reason       text NOT NULL,
    created_by   uuid REFERENCES public.profiles(id),          -- فاضي للاحتساب التلقائي، متعبّي للاستبدال اليدوي
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_customer ON public.loyalty_points_ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_ledger_order    ON public.loyalty_points_ledger(order_id);

ALTER TABLE public.loyalty_points_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY loyalty_ledger_staff_select ON public.loyalty_points_ledger FOR SELECT TO public
    USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','accountant')));

-- 3. احتساب النقاط تلقائيًا لما الطلب يوصل 'delivered' -----------------------------------
CREATE OR REPLACE FUNCTION public.fn_customer_orders_award_loyalty_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_enabled       boolean;
    v_points_per_egp numeric;
    v_points        numeric(14,2);
BEGIN
    -- مفيش احتساب إلا لو الانتقال فعليًا لـ 'delivered' (مش أي تحديث تاني)
    IF NEW.status IS DISTINCT FROM 'delivered' OR OLD.status IS NOT DISTINCT FROM 'delivered' THEN
        RETURN NEW;
    END IF;

    -- حماية من الاحتساب المزدوج (لو الطلب رجع لحالة تانية وبعدين اتسلّم تاني)
    IF EXISTS (SELECT 1 FROM public.loyalty_points_ledger WHERE order_id = NEW.id) THEN
        RETURN NEW;
    END IF;

    v_enabled := COALESCE((SELECT value::boolean FROM public.app_settings WHERE key = 'sultanoo_loyalty_enabled'), false);
    IF NOT v_enabled THEN
        RETURN NEW;
    END IF;

    v_points_per_egp := COALESCE((SELECT value::numeric FROM public.app_settings WHERE key = 'sultanoo_loyalty_points_per_egp'), 0.1);
    v_points := floor(COALESCE(NEW.total_amount, 0) * v_points_per_egp);

    IF v_points > 0 THEN
        INSERT INTO public.loyalty_points_ledger (customer_id, order_id, points_delta, reason)
        VALUES (NEW.customer_id, NEW.id, v_points, 'طلب رقم ' || COALESCE(NEW.order_no, NEW.id::text) || ' — تم التسليم');

        UPDATE public.customers
        SET loyalty_points_balance = loyalty_points_balance + v_points
        WHERE id = NEW.customer_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_orders_award_loyalty_points ON public.customer_orders;
CREATE TRIGGER trg_customer_orders_award_loyalty_points
    AFTER UPDATE OF status ON public.customer_orders
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_customer_orders_award_loyalty_points();

-- 4. دالة استبدال يدوي (تُستدعى من سلطان ERP لما الأونر/الموظف يوافق على استبدال) ------
CREATE OR REPLACE FUNCTION public.fn_loyalty_redeem_points(
    p_customer_id uuid, p_points numeric, p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_points <= 0 THEN
        RAISE EXCEPTION 'عدد النقاط لازم يكون أكبر من صفر';
    END IF;

    INSERT INTO public.loyalty_points_ledger (customer_id, points_delta, reason, created_by)
    VALUES (p_customer_id, -p_points, COALESCE(p_reason, 'استبدال يدوي'), auth.uid());

    UPDATE public.customers
    SET loyalty_points_balance = loyalty_points_balance - p_points
    WHERE id = p_customer_id;
END;
$$;

-- 5. RPCs بيقرأهم سلطانو (نفس نمط fn_sultano_* الموجود، SECURITY DEFINER + anon قابل للاستدعاء) --
CREATE OR REPLACE FUNCTION public.fn_sultano_get_loyalty_settings()
RETURNS TABLE(enabled boolean, points_per_egp numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        COALESCE((SELECT value::boolean FROM public.app_settings WHERE key = 'sultanoo_loyalty_enabled'), false),
        COALESCE((SELECT value::numeric FROM public.app_settings WHERE key = 'sultanoo_loyalty_points_per_egp'), 0.1);
$$;

CREATE OR REPLACE FUNCTION public.fn_sultano_get_customer_loyalty(p_customer_id uuid)
RETURNS TABLE(points_balance numeric)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(c.loyalty_points_balance, 0) FROM public.customers c WHERE c.id = p_customer_id;
$$;

-- 6. صلاحيات التنفيذ لعميل سلطانو (anon key) — نفس نمط باقي fn_sultano_* --------------
GRANT EXECUTE ON FUNCTION public.fn_sultano_get_loyalty_settings() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sultano_get_customer_loyalty(uuid) TO anon, authenticated;
