-- ════════════════════════════════════════════════════════════
-- إصلاح فرق الأرقام بين "تقرير المؤجلات" ومودال "تسجيل استلام مؤجل"
--
-- deferred_rebates_supplier_summary بيجمع dr.expected_amount مباشرة
-- (عمود generated ثابت = qty * rate). لكن fn_list_pending_deferred_rebates
-- (من deferred_rebates_manual_migration.sql) كانت بتعيد حساب المبلغ
-- بصيغة تانية تماماً (line_total × rate/100 عن طريق join على
-- purchase_items) — افتراض قديم إن rate نسبة %، مش متسق مع الجدول
-- نفسه. النتيجة: نفس المورد بيظهر برقم "متوقع" في التقرير الملخّص،
-- ورقم مختلف تماماً في تفاصيل مودال الاستلام لنفس البنود بالظبط.
--
-- الحل: نخلي الدالة تقرأ dr.expected_amount مباشرة (زي الملخّص بالظبط)
-- بدل ما تعيد حسابها بصيغة مختلفة — ده كمان بيلغي الحاجة لـ join على
-- purchase_items خالص.
-- ════════════════════════════════════════════════════════════

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
    SELECT dr.id, p.name, dr.qty, dr.rate, dr.due_date, dr.expected_amount
    FROM public.deferred_rebates dr
    LEFT JOIN public.products p ON p.id = dr.product_id
    WHERE dr.supplier_id = p_supplier_id AND dr.status = 'pending'
    ORDER BY dr.due_date NULLS LAST;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_list_pending_deferred_rebates(uuid) TO authenticated;
