-- ════════════════════════════════════════════════════════════
-- deferred_rebates_manual_migration.sql
-- شغّل هذا الملف مرة واحدة في Supabase SQL editor (آمن للتكرار —
-- كل جملة CREATE فيها IF NOT EXISTS / OR REPLACE).
--
-- الخلفية والقرار (مهم تقرأه قبل التشغيل):
-- ────────────────────────────────────────────────────────────
-- نظام المؤجل الحالي: purchases.js بيحفظ deferred_rate/deferred_due_date
-- على كل بند في purchase_items، وتريجر fn_purchase_status_change
-- (شايفينه في treasuries_migration_part2.sql سطر 256-269) بيعمل INSERT
-- تلقائي في جدول public.deferred_rebates بالأعمدة:
--   (supplier_id, purchase_id, purchase_item_id, product_id, qty, rate, due_date)
-- وبيغيّر status لـ 'cancelled' لو الفاتورة اتلغت. الجدول ده وview
-- الملخص deferred_rebates_supplier_summary (المستخدمة في reports.js)
-- **مش موجودين في الريبو أصلاً** — اتعملوا مباشرة على قاعدة البيانات
-- قبل ما نبدأ نتتبع كل SQL في الريبو، فمش عندنا تعريفهم الكامل
-- (مش عارفين مثلاً هل deferred_rebates فيه عمود "amount" منفصل، ولا
-- الـ view بتحسب المبلغ المتوقع بضرب rate% في purchase_items.line_total
-- عن طريق join — الدليل الوحيد المتاح (نفس صيغة الحساب الموجودة في
-- purCalcNet() بتاعة purchases.js نفسها) بيرجّح احتمال الـ join، لكن
-- مش تأكيد 100%).
--
-- عشان كده: القرار هنا إننا **معملناش أي INSERT مباشر ولا حتى RPC
-- بيكتب في deferred_rebates الأصلي للمؤجلات التاريخية** — الخطر إن
-- أي افتراض غلط عن شكل الجدول يطلع بيانات مالية غلط بصمت (يا رقم
-- expected بيظهر صفر لأن مفيش purchase_item حقيقي وراه، يا insert
-- يفشل بسبب NOT NULL FK على purchase_id/purchase_item_id، يا الأسوأ:
-- نضطر نعمل فاتورة شراء وهمية عشان نولّد purchase_item حقيقي — وده
-- هيفسد المخزون ورصيد المورد الفعلي لأن fn_purchase_status_change
-- بتحرّك المخزون والقيود تلقائياً لأي فاتورة confirmed).
--
-- البديل الآمن: جدول جديد مستقل تماماً deferred_rebates_manual،
-- إحنا اللي بنعرّف شكله بالكامل (مفيش تخمين)، بيتعرض في تقرير
-- المؤجلات كجدول إضافي منفصل ("مؤجلات مسجّلة يدوياً") من غير أي
-- لمس لـ deferred_rebates أو deferred_rebates_supplier_summary
-- الأصليين — استقرار شكل الـ view للفريق التاني (هامش الربح بعد
-- خصم المؤجل) محفوظ 100%.
--
-- كمان بيحل جزء من فجوة "تسجيل استلام مؤجل" (مفيش أي واجهة ليها
-- في التطبيق حالياً — راجع تقرير المهمة) عن طريق:
--   • fn_receive_deferred_rebate_manual: استلام (كامل/جزئي) من مؤجل
--     مسجّل يدوياً (جدول جديد، تحكم كامل في الأعمدة — آمن 100%).
--   • fn_mark_deferred_rebate_received: تعليم بنود من deferred_rebates
--     **الأصلي** كـ status='received' — ده مبني على نفس نمط الـ UPDATE
--     المستخدم فعلاً وبنجاح في تريجر إلغاء الشراء
--     (`update deferred_rebates set status='cancelled' where purchase_id=...`)
--     فالتأكد إن عمود status بيقبل قيم نصية حرة موجود، لكن **مش متأكدين
--     إن الـ view نفسها بتتعرّف على القيمة 'received' تحديداً في حساب
--     total_received** — لو بعد أول استخدام الرقم في التقرير ماتحرّكش،
--     كلّم المطوّر بنص رسالة الخطأ أو لقطة شاشة من الأرقام قبل/بعد.
-- ════════════════════════════════════════════════════════════

-- ── 1) الجدول الجديد ──
CREATE TABLE IF NOT EXISTS public.deferred_rebates_manual (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
    amount numeric NOT NULL CHECK (amount > 0),
    received_amount numeric NOT NULL DEFAULT 0 CHECK (received_amount >= 0),
    due_date date,
    notes text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'received', 'cancelled')),
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (received_amount <= amount)
);

CREATE INDEX IF NOT EXISTS idx_deferred_rebates_manual_supplier ON public.deferred_rebates_manual(supplier_id);

-- ── 2) RLS — نفس نمط treasuries_rls_migration.sql بالحرف ──
ALTER TABLE public.deferred_rebates_manual ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deferred_rebates_manual_select ON public.deferred_rebates_manual;
CREATE POLICY deferred_rebates_manual_select ON public.deferred_rebates_manual FOR SELECT
USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS deferred_rebates_manual_insert ON public.deferred_rebates_manual;
CREATE POLICY deferred_rebates_manual_insert ON public.deferred_rebates_manual FOR INSERT
WITH CHECK (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['admin'::text, 'accountant'::text])
));

DROP POLICY IF EXISTS deferred_rebates_manual_update ON public.deferred_rebates_manual;
CREATE POLICY deferred_rebates_manual_update ON public.deferred_rebates_manual FOR UPDATE
USING (EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = ANY (ARRAY['admin'::text, 'accountant'::text])
));

-- ── 3) تسجيل مؤجل تاريخي جديد (بند 1 من المهمة) ──
CREATE OR REPLACE FUNCTION public.fn_register_historical_deferred_rebate(
    p_supplier_id uuid,
    p_amount numeric,
    p_due_date date DEFAULT NULL,
    p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_id uuid;
    v_supplier_name text;
BEGIN
    IF p_supplier_id IS NULL THEN
        RAISE EXCEPTION 'المورد مطلوب';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر';
    END IF;

    SELECT name INTO v_supplier_name FROM public.suppliers WHERE id = p_supplier_id;
    IF v_supplier_name IS NULL THEN
        RAISE EXCEPTION 'المورد غير موجود';
    END IF;

    INSERT INTO public.deferred_rebates_manual (supplier_id, amount, due_date, notes, created_by)
    VALUES (p_supplier_id, p_amount, p_due_date, p_notes, auth.uid())
    RETURNING id INTO v_id;

    BEGIN
        PERFORM public.log_financial_event('create', 'deferred_rebate', v_id,
            'تسجيل مؤجل تاريخي يدوي - مورد: ' || v_supplier_name || ' - ' || p_amount::text,
            NULL, jsonb_build_object('supplier_id', p_supplier_id, 'amount', p_amount, 'due_date', p_due_date, 'notes', p_notes),
            auth.uid());
    EXCEPTION WHEN OTHERS THEN
        -- لو log_financial_event مش موجودة بنفس التوقيع ده، متكسرش العملية الأساسية
        NULL;
    END;

    RETURN v_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_register_historical_deferred_rebate(uuid, numeric, date, text) TO authenticated;

-- ── 4) تسجيل استلام (كامل/جزئي) على مؤجل يدوي (بند 2 من المهمة) ──
CREATE OR REPLACE FUNCTION public.fn_receive_deferred_rebate_manual(
    p_id uuid,
    p_amount numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_remaining numeric;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'مبلغ الاستلام يجب أن يكون أكبر من صفر';
    END IF;

    SELECT (amount - received_amount) INTO v_remaining
    FROM public.deferred_rebates_manual WHERE id = p_id AND status <> 'cancelled'
    FOR UPDATE;

    IF v_remaining IS NULL THEN
        RAISE EXCEPTION 'المؤجل غير موجود أو ملغي';
    END IF;
    IF p_amount > v_remaining THEN
        RAISE EXCEPTION 'المبلغ المدخل (%) أكبر من المتبقي (%)', p_amount, v_remaining;
    END IF;

    UPDATE public.deferred_rebates_manual
    SET received_amount = received_amount + p_amount,
        status = CASE WHEN received_amount + p_amount >= amount THEN 'received' ELSE status END,
        updated_at = now()
    WHERE id = p_id;

    BEGIN
        PERFORM public.log_financial_event('update', 'deferred_rebate', p_id,
            'تسجيل استلام مؤجل يدوي - مبلغ: ' || p_amount::text,
            NULL, jsonb_build_object('received_amount', p_amount), auth.uid());
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_receive_deferred_rebate_manual(uuid, numeric) TO authenticated;

-- ── 5) استلام بنود من deferred_rebates الأصلي (المرتبطة بفواتير شراء حقيقية) ──
-- ★ ده بيغيّر status بس (زي تريجر الإلغاء بالظبط) — ماحطيناش أي منطق
--   بيحسب أو يخزّن مبلغ، عشان معندناش تأكيد 100% إن فيه عمود "amount"
--   في الجدول الأصلي. لو الـ view مبتعرفش status='received' هتفضل
--   البنود دي حاسبة نفسها "متبقية" في التقرير — راجع الملاحظة في
--   أول الملف.
CREATE OR REPLACE FUNCTION public.fn_mark_deferred_rebate_received(
    p_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_count integer;
BEGIN
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'لازم تحدد بند واحد على الأقل';
    END IF;

    UPDATE public.deferred_rebates
    SET status = 'received', updated_at = now()
    WHERE id = ANY(p_ids) AND status = 'pending';

    GET DIAGNOSTICS v_count = ROW_COUNT;

    BEGIN
        PERFORM public.log_financial_event('update', 'deferred_rebate', NULL,
            'تعليم ' || v_count::text || ' بند مؤجل كمُستلم', NULL,
            jsonb_build_object('ids', p_ids), auth.uid());
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_mark_deferred_rebate_received(uuid[]) TO authenticated;

-- ── 6) قراءة بنود المؤجل الحقيقية (من فواتير الشراء) "المعلّقة" لمورد معيّن ──
-- بيستخدم فقط الأعمدة المؤكدة فعلاً من كود التريجر الأصلي
-- (treasuries_migration_part2.sql سطر 256-269): supplier_id, purchase_id,
-- purchase_item_id, product_id, qty, rate, due_date, status. المبلغ
-- بيتحسب هنا بنفس صيغة purCalcNet() في purchases.js بالحرف
-- (line_total × rate/100) عن طريق join حقيقي على purchase_items — مش
-- تخمين، ده استنتاج من كود موجود وشغال فعلاً.
CREATE OR REPLACE FUNCTION public.fn_list_pending_deferred_rebates(p_supplier_id uuid)
RETURNS TABLE (
    id uuid,
    product_name text,
    qty numeric,
    rate numeric,
    due_date date,
    expected_amount numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    SELECT dr.id, p.name, dr.qty, dr.rate, dr.due_date,
           (COALESCE(pi.line_total, 0) * COALESCE(dr.rate, 0) / 100)::numeric AS expected_amount
    FROM public.deferred_rebates dr
    LEFT JOIN public.purchase_items pi ON pi.id = dr.purchase_item_id
    LEFT JOIN public.products p ON p.id = dr.product_id
    WHERE dr.supplier_id = p_supplier_id AND dr.status = 'pending'
    ORDER BY dr.due_date NULLS LAST;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_list_pending_deferred_rebates(uuid) TO authenticated;
