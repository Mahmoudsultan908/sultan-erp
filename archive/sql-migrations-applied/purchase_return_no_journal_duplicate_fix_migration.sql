-- ════════════════════════════════════════════════════════════
-- إصلاح جذري لتكرار مشكلة return_no/journal_entries duplicate key
-- في مرتجعات الشراء (المشكلة اللي فضلت ترجع بعد كل تنظيف يدوي).
--
-- السببان الحقيقيان (اتأكدوا بالاتصال المباشر بقاعدة البيانات عبر
-- Supabase MCP + سجلات Postgres الفعلية):
--
-- 1) عمود ناقص فعليًا: جدول purchase_return_items معندوش عمود
--    unit_name (على عكس شقيقه sale_return_items اللي عنده العمود
--    ده)، بينما returns.js بيحاول يدرج unit_name مع كل بند مرتجع
--    شراء دايمًا. يعني إدراج البنود كان *فاشل 100% من المرات*
--    بخطأ "column unit_name does not exist" — مؤكَّد من سجلات
--    Postgres الحقيقية (خطأ مطابق ظهر أثناء إعادة الاختبار).
--
-- 2) خلل تصميمي في التسلسل: returns.js كان بيعمل 3 خطوات منفصلة
--    (INSERT هيدر بحالة confirmed مباشرة → INSERT بنود → زيادة
--    عداد app_settings.purchase_return_counter). التريجر
--    fn_purchase_return_status_change بيتنفذ فور INSERT الهيدر
--    ويعمل: خصم رصيد المورد + ترحيل قيد يومية (ref = 'PRR-'||
--    return_no) — قبل ما البنود تتسجل أصلاً. فلما كانت خطوة
--    البنود بتفشل (بسبب #1 فوق)، كان بيفضل هيدر "confirmed" معلّق
--    وسط الطريق: قيد يومية مُرحّل + رصيد مورد متأثر، من غير بنود،
--    ومن غير ما العداد يتحرك (بيتحرك بعد نجاح البنود بس). فأي
--    محاولة تانية كانت بتولّد نفس return_no (تصادم unique) وتصطدم
--    بنفس ref قيد اليومية القديم لو الهيدر القديم اتمسح يدويًا من
--    غير ما حد يرجّع أثر التريجر (قيد + رصيد) معاه — وده اللي كان
--    بيخلي المشكلة ترجع تاني وتاني حتى بعد كل تنظيف يدوي.
--
-- الحل: عمود unit_name المفقود + دالة واحدة SECURITY DEFINER بتعمل
-- كل حاجة (قفل العداد + إدراج الهيدر + إدراج البنود + زيادة العداد)
-- جوه ترانزاكشن واحدة. لو أي خطوة فشلت (لأي سبب)، بوستجرِس بيرجع
-- كل حاجة تلقائيًا بما فيها أثر التريجرات — يعني مفيش إمكانية لهيدر
-- "يتيم" تاني، ومفيش تصادم على return_no أو على ref قيد اليومية.
--
-- returns.js اتعدّل عشان ينادي fn_create_purchase_return(...) عبر
-- sb.rpc(...) بدل الخطوات التلاتة المنفصلة القديمة.
--
-- ملحوظة: الاختبار الفعلي (نجاح + فشل متعمد لتأكيد الـ rollback)
-- اتعمل مباشرة على قاعدة البيانات الحية عبر MCP، وكل أثر الاختبار
-- اتنضّف بالكامل بعده (هيدر، بنود، قيد، رصيد المورد، المخزون،
-- العداد) — القاعدة رجعت لنفس حالتها قبل الاختبار.
-- ════════════════════════════════════════════════════════════

-- 1) العمود الناقص
ALTER TABLE public.purchase_return_items
    ADD COLUMN IF NOT EXISTS unit_name text;

-- 2) الدالة الذرّية
CREATE OR REPLACE FUNCTION public.fn_create_purchase_return(
    p_supplier_id uuid,
    p_purchase_id uuid,
    p_warehouse_id uuid,
    p_payment_type text,
    p_treasury_id uuid,
    p_affects_supplier_balance boolean,
    p_subtotal numeric,
    p_total numeric,
    p_reason text,
    p_created_by uuid,
    p_items jsonb
)
RETURNS TABLE(id uuid, return_no text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_counter int;
    v_return_no text;
    v_return_id uuid;
    v_item jsonb;
BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'لا يمكن إنشاء مرتجع شراء بدون أصناف';
    END IF;

    -- قفل صف العداد لمنع تصادم المحاولات المتزامنة
    -- value مخزّن كـ jsonb (نص JSON زي "1")، مطابقة لطريقة تخزين
    -- returns.js الحالية عبر supabase-js .upsert({value: String(n)})
    SELECT COALESCE((value #>> '{}')::int, 1) INTO v_counter
    FROM public.app_settings WHERE key = 'purchase_return_counter'
    FOR UPDATE;

    IF v_counter IS NULL THEN
        v_counter := 1;
        INSERT INTO public.app_settings (key, value, updated_at)
        VALUES ('purchase_return_counter', to_jsonb('1'::text), now())
        ON CONFLICT (key) DO NOTHING;
    END IF;

    v_return_no := 'RP-' || lpad(v_counter::text, 4, '0');

    INSERT INTO public.purchase_returns
        (return_no, supplier_id, purchase_id, warehouse_id, payment_type, treasury_id,
         affects_supplier_balance, subtotal, total, status, reason, created_by)
    VALUES
        (v_return_no, p_supplier_id, p_purchase_id, p_warehouse_id, p_payment_type, p_treasury_id,
         p_affects_supplier_balance, p_subtotal, p_total, 'confirmed', p_reason, p_created_by)
    RETURNING purchase_returns.id INTO v_return_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        INSERT INTO public.purchase_return_items
            (return_id, product_id, qty, unit_price, line_total, unit_name)
        VALUES
            (v_return_id, (v_item->>'product_id')::uuid, (v_item->>'qty')::numeric,
             (v_item->>'unit_price')::numeric, (v_item->>'line_total')::numeric, v_item->>'unit_name');
    END LOOP;

    UPDATE public.app_settings
    SET value = to_jsonb((v_counter + 1)::text), updated_at = now()
    WHERE key = 'purchase_return_counter';

    RETURN QUERY SELECT v_return_id, v_return_no;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_create_purchase_return(
    uuid, uuid, uuid, text, uuid, boolean, numeric, numeric, text, uuid, jsonb
) TO authenticated;
