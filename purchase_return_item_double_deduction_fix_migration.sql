-- ════════════════════════════════════════════════════════════
-- إصلاح خصم المخزون مرتين لكل مرتجع شراء (باگ مخزون حقيقي —
-- أخطر من باگات الرصيد اللي اتصلحت قبل كده، لأنه بيمس أرقام المخزون
-- الفعلية مش رصيد مالي بس)
--
-- الاستعلام اللي طلبته أكّد إن فيه *تريجرين* منفصلين شغالين فعلاً على
-- purchase_return_items بعد INSERT:
--   1) trg_purchase_return_item_stock → fn_purchase_return_item_stock()
--      (من returns_migration.sql — بتخصم من warehouse_id المرتجع
--      نفسه، بالكمية الخام زي ما هي، من غير شرط تأكيد)
--   2) trg_purchase_return_item_insert → fn_purchase_return_item_insert()
--      (اتعملت مباشرة على القاعدة من غير ما تتسجل في الريبو — بتخصم
--      دايمًا من المخزن الرئيسي بس (بغض النظر عن المخزن المُختار في
--      المرتجع فعليًا)، وبتضرب الكمية × units_per_carton_snapshot)
--
-- يعني كل مرتجع شراء بيتأكد كان بيخصم المخزون مرتين من مخزنين محتملين
-- مختلفين. والأخطر: دالة "تعديل مرتجع شراء" (fn_reverse_purchase_return_for_edit
-- من returns_edit_reversal_migration.sql) بترجّع بس أثر التريجر الأول
-- (رقم 1)، فأثر التريجر التاني (رقم 2) كان بيفضل قاعد على المخزون
-- الرئيسي للأبد من غير ما يترجع، وده بيتراكم مع كل تعديل مرتجع.
--
-- القرار (بطلب صاحب المشروع): مرتجعات الشراء بتتعامل بالوحدة الصغرى
-- فقط، بدون أي تحويل علبة/كرتونة — يعني نشيل التريجر التاني (رقم 2)
-- كامل، ونخلي التريجر الأول (رقم 1) هو المصدر الوحيد بعد ما نضيفله
-- شرط التأكيد (دفاع إضافي، حاليًا مش بيغيّر أي سلوك فعلي لأن العنصر
-- بيتسجل بعد ما يتم إنشاء المرتجع بحالة 'confirmed' على طول). دالة
-- التعديل (fn_reverse_purchase_return_for_edit) هتفضل صح من غير أي
-- تعديل عليها، لأنها أصلاً مكتوبة على نفس منطق التريجر الأول.
-- ════════════════════════════════════════════════════════════

-- 1) شيل التريجر/الدالة التانية المكرّرة كامل
DROP TRIGGER IF EXISTS trg_purchase_return_item_insert ON public.purchase_return_items;
DROP FUNCTION IF EXISTS public.fn_purchase_return_item_insert();

-- 2) الدالة الناجية: نفس منطقها الأصلي بالظبط + شرط تأكيد + upsert آمن
--    (بدل UPDATE بسيط ممكن يعمل no-op لو الصف مش موجود أصلاً)
CREATE OR REPLACE FUNCTION public.fn_purchase_return_item_stock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_wh uuid; v_status text;
BEGIN
    SELECT warehouse_id, status INTO v_wh, v_status
    FROM public.purchase_returns WHERE id = NEW.return_id;

    IF v_wh IS NOT NULL AND v_status = 'confirmed' THEN
        INSERT INTO public.inventory_stock (warehouse_id, product_id, qty)
        VALUES (v_wh, NEW.product_id, -NEW.qty)
        ON CONFLICT (warehouse_id, product_id)
        DO UPDATE SET qty = public.inventory_stock.qty - NEW.qty;
    END IF;
    RETURN NEW;
END;
$function$;
