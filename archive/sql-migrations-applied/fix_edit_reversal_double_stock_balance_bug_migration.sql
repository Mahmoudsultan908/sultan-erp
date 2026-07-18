-- ════════════════════════════════════════════════════════════
-- إصلاح باگ خصم/إرجاع المخزون والرصيد مرتين عند تعديل فاتورة بيع
-- أو شراء. اتأكد فعليًا (مش تخمين): fn_reverse_sale_for_edit و
-- fn_reverse_purchase_for_edit بيعملوا UPDATE ... SET status =
-- 'cancelled' — وده بيشغّل تريجر trg_sale_status/trg_purchase_status
-- (fn_sale_status_change/fn_purchase_status_change) اللي أصلاً بيعمل
-- كل حاجة صح لحالة الإلغاء: يرجّع المخزون، يعكس الكاش/رصيد العميل أو
-- المورد، يرحّل قيد REV-*، ويسجّل financial_event. لكن الدالتين
-- كانوا بعد UPDATE الحالة بيعملوا نفس إرجاع المخزون (وإرجاع رصيد
-- العميل/المورد لو آجل) تاني يدويًا — يعني كل تعديل فاتورة كان بيرجّع
-- المخزون مرتين فعليًا.
--
-- اتأكد بالاختبار المباشر (نجاح متكرر مرتين، مبيعات ومشتريات):
-- إنشاء فاتورة تجريبية (كمية 1) → المخزون اتغيّر بمقدار 1 (صح) →
-- استدعاء دالة التعديل → المخزون كان بيرجع لضعف القيمة الصح بدل ما
-- يرجع بالظبط لقيمته الأصلية. بعد الإصلاح: المخزون والرصيد رجعوا
-- بالظبط لقيمتهم الأصلية (مرة واحدة بس)، وقيد REV- اتسجل مرة واحدة،
-- ولمرتجع الشراء: deferred_rebates المرتبطة اتلغت صح كمان (حاجة
-- الكود اليدوي القديم مكنش بيعملها أصلاً).
--
-- فيه فاتورتين حقيقيتين اتأثروا بالباگ ده قبل الإصلاح (INV-0010
-- مبيعات، PUR-0002 مشتريات) — تصحيح أرصدة المخزون بتاعتهم موضوع
-- منفصل لسه محتاج قرار مع صاحب المشروع (مش جزء من الملف ده).
--
-- الحل: التريجر أصلاً كامل وصحيح، فشلنا الكود اليدوي المكرر بالكامل
-- من الدالتين وسبنا بس UPDATE الحالة (كافي لوحده، التريجر بيعمل الباقي).
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_reverse_sale_for_edit(p_sale_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sales WHERE id = p_sale_id) THEN
        RAISE EXCEPTION 'sale % not found', p_sale_id;
    END IF;

    -- ده الكافي: تغيير الحالة لـ'cancelled' بيشغّل fn_sale_status_change
    -- تلقائيًا، اللي بيرجّع المخزون + الكاش/رصيد العميل + قيد REV- +
    -- financial_event — بالكامل ومرة واحدة بس.
    UPDATE sales SET status = 'cancelled' WHERE id = p_sale_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_reverse_purchase_for_edit(p_purchase_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM purchases WHERE id = p_purchase_id) THEN
        RAISE EXCEPTION 'purchase % not found', p_purchase_id;
    END IF;

    -- ده الكافي: تغيير الحالة لـ'cancelled' بيشغّل fn_purchase_status_change
    -- تلقائيًا، اللي بيرجّع المخزون + الكاش/رصيد المورد + قيد REV- +
    -- إلغاء deferred_rebates + financial_event — بالكامل ومرة واحدة بس.
    UPDATE purchases SET status = 'cancelled' WHERE id = p_purchase_id;
END;
$function$;
