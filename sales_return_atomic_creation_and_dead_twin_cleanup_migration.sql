-- ════════════════════════════════════════════════════════════
-- نفس إصلاح مرتجعات الشراء (purchase_return_no_journal_duplicate_
-- fix_migration.sql) بس لمرتجعات المبيعات — قبل ما تتعرض لنفس
-- مشكلة return_no/journal_entries duplicate key. مطبَّق مباشرة على
-- القاعدة الحية عبر Supabase MCP، الملف ده للسجل في الريبو.
--
-- returns.js كان بيعمل 3 خطوات منفصلة (INSERT هيدر بحالة confirmed
-- → INSERT بنود → زيادة عداد sales_return_counter)، وتريجر
-- fn_sales_return_status_change بيرحّل قيد اليومية ويؤثر على رصيد
-- العميل فور INSERT الهيدر — قبل ما البنود تتسجل. لسه معملتش نفس
-- مشكلة الشراء (لأن sale_return_items عنده عمود unit_name بالفعل)،
-- لكن أي فشل تاني (شبكة، RLS، قيد فحص) كان ممكن يعمل نفس اليتيم
-- بالظبط. الحل: نفس فكرة الدالة الذرّية.
--
-- اكتشاف جانبي أثناء المراجعة (موثّق جزئيًا قبل كده في أرشيف
-- sales_returns_double_deduction_fix_migration.sql بس متصلحش وقتها):
-- فيه جدول "توأم" اسمه sales_return_items (بالجمع — مختلف عن
-- sale_return_items الحقيقي المفرد اللي التطبيق بيكتب فيه فعلاً)،
-- كان فاضي تمامًا (0 صف) وعليه تريجر منفصل fn_sales_return_item_insert
-- بيعمل تحويل كرتونة/علبة — بالظبط نفس نمط التريجر التوأم اللي كان
-- بيسبب خصم المخزون المزدوج في مرتجعات الشراء الصبح. مفيش أي كود في
-- الريبو بيكتب في الجدول ده، فهو كان خامل 100% كتريجر مستقل، لكن
-- fn_sales_return_status_change (الدالة الحقيقية الشغالة) كانت
-- بتقرأ منه هي كمان في حلقة تعديل مخزون منفصلة (no-op دايمًا لأن
-- الجدول فاضي، لا أكتر ولا أقل — موثّق في الأرشيف). المخزون الفعلي
-- لمرتجعات البيع بيتحدد بالكامل عن طريق fn_sale_return_item_stock
-- (تريجر تاني منفصل على sale_return_items المفرد الحقيقي).
--
-- ★ درس مُتعلَّم أثناء التنفيذ: أول محاولة شالت الجدول التوأم مباشرة
--   من غير ما تصحح fn_sales_return_status_change الأول، وده كسر كل
--   تأكيد مرتجع بيع فورًا (كل استعلام كان بيرمي "relation
--   sales_return_items does not exist"). اتصلح فورًا بنفس الجلسة
--   (قبل أي مستخدم حقيقي يتأثر) بتحديث الدالة عشان تشيل الحلقة
--   الميتة بالكامل. الترتيب الصح دايمًا: صحّح كل حاجة بتشاور على
--   الجدول *قبل* ما تشيله، مش بعده.
-- ════════════════════════════════════════════════════════════

-- 1) شيل التوأم الميت بالكامل (تريجر + دالة + الجدول الفاضي)
DROP TRIGGER IF EXISTS trg_sales_return_item_insert ON public.sales_return_items;
DROP FUNCTION IF EXISTS public.fn_sales_return_item_insert();
DROP TABLE IF EXISTS public.sales_return_items;

-- 2) صحّح fn_sales_return_status_change: شيل حلقة تعديل المخزون
--    الميتة اللي كانت بتشاور على الجدول اللي اتشال فوق (كانت no-op
--    دايمًا فمفيش أي تغيير فعلي في السلوك)
CREATE OR REPLACE FUNCTION public.fn_sales_return_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_counter text;
begin
  v_counter := case when new.payment_type = 'cash' then '1001' else '1003' end;

  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then

    if new.payment_type = 'cash' then
      perform public.post_cash('out', new.total, 'مرتجع بيع #'||new.return_no, 'sales_return', new.id, new.created_by, new.treasury_id);
    elsif coalesce(new.affects_customer_balance, true) then
      update public.customers set balance = balance - new.total, updated_at = now() where id = new.customer_id;
    end if;

    perform public.post_journal('SR-'||new.return_no, 'مرتجع بيع #'||new.return_no, 'sales_return', new.id, new.created_by,
      public.build_lines('4001', new.total, 0, v_counter, new.total, true));

    perform public.log_financial_event('create', 'sales_return', new.id, 'مرتجع بيع #'||new.return_no,
      null, to_jsonb(new), new.created_by);

  elsif new.status = 'cancelled' and old.status = 'confirmed' then

    if new.payment_type = 'cash' then
      perform public.post_cash('in', new.total, 'عكس مرتجع بيع #'||new.return_no, 'reversal', new.id, new.created_by, new.treasury_id);
    elsif coalesce(new.affects_customer_balance, true) then
      update public.customers set balance = balance + new.total, updated_at = now() where id = new.customer_id;
    end if;

    perform public.post_journal('REV-SR-'||new.return_no, 'عكس مرتجع بيع #'||new.return_no, 'sales_return', new.id, new.created_by,
      public.build_lines('4001', new.total, 0, v_counter, new.total, false));

    perform public.log_financial_event('cancel', 'sales_return', new.id, 'إلغاء مرتجع بيع #'||new.return_no,
      to_jsonb(old), to_jsonb(new), new.created_by);

  end if;
  return new;
end;
$function$;

-- 3) الدالة الذرّية لإنشاء مرتجع بيع (هيدر + بنود + عداد في ترانزاكشن واحدة)
CREATE OR REPLACE FUNCTION public.fn_create_sales_return(
    p_customer_id uuid,
    p_sale_id uuid,
    p_warehouse_id uuid,
    p_payment_type text,
    p_treasury_id uuid,
    p_rep_id uuid,
    p_affects_customer_balance boolean,
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
        RAISE EXCEPTION 'لا يمكن إنشاء مرتجع بيع بدون أصناف';
    END IF;

    SELECT COALESCE((value #>> '{}')::int, 1) INTO v_counter
    FROM public.app_settings WHERE key = 'sales_return_counter'
    FOR UPDATE;

    IF v_counter IS NULL THEN
        v_counter := 1;
        INSERT INTO public.app_settings (key, value, updated_at)
        VALUES ('sales_return_counter', to_jsonb('1'::text), now())
        ON CONFLICT (key) DO NOTHING;
    END IF;

    v_return_no := 'RS-' || lpad(v_counter::text, 4, '0');

    INSERT INTO public.sales_returns
        (return_no, customer_id, sale_id, warehouse_id, payment_type, treasury_id,
         rep_id, affects_customer_balance, subtotal, total, status, reason, created_by)
    VALUES
        (v_return_no, p_customer_id, p_sale_id, p_warehouse_id, p_payment_type, p_treasury_id,
         p_rep_id, p_affects_customer_balance, p_subtotal, p_total, 'confirmed', p_reason, p_created_by)
    RETURNING sales_returns.id INTO v_return_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        INSERT INTO public.sale_return_items
            (return_id, product_id, qty, unit_price, discount_pct, line_total, unit_name)
        VALUES
            (v_return_id, (v_item->>'product_id')::uuid, (v_item->>'qty')::numeric,
             (v_item->>'unit_price')::numeric, COALESCE((v_item->>'discount_pct')::numeric, 0),
             (v_item->>'line_total')::numeric, v_item->>'unit_name');
    END LOOP;

    UPDATE public.app_settings
    SET value = to_jsonb((v_counter + 1)::text), updated_at = now()
    WHERE key = 'sales_return_counter';

    RETURN QUERY SELECT v_return_id, v_return_no;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_create_sales_return(
    uuid, uuid, uuid, text, uuid, uuid, boolean, numeric, numeric, text, uuid, jsonb
) TO authenticated;
