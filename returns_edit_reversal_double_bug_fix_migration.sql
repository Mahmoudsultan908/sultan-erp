-- ════════════════════════════════════════════════════════════
-- إصلاح باگ "الرجوع المزدوج" (double-balance-reversal) في تعديل
-- مرتجعات البيع/الشراء — نفس فئة fix_edit_reversal_double_stock_
-- balance_bug_migration.sql (فواتير البيع/الشراء) بس هنا للمرتجعات.
--
-- ★ مهم: الاتنين (مرتجع بيع/مرتجع شراء) مش نفس الشكل بالظبط —
--   اتأكد بقراءة تعريفات الدوال الحية عبر Supabase MCP قبل التعديل:
--
-- 1) مرتجع البيع (fn_sales_return_status_change): مفيهوش أي منطق
--    مخزون خالص (اتشال بالكامل قبل كده في sales_return_atomic_
--    creation_and_dead_twin_cleanup_migration.sql لأنه كان بيقرأ من
--    جدول توأم فاضي دايمًا). المصدر الوحيد الحي لمخزون مرتجع البيع
--    هو trg_sale_return_item_stock (بيزوّد المخزون عند إنشاء المرتجع).
--    يعني fn_reverse_sales_return_for_edit كانت بتعمل حاجتين مختلفتين:
--    (أ) عكس المخزون — ده صحيح ولازم يفضل زي ما هو، مفيش تريجر تاني
--        بيعمله. (ب) عكس رصيد العميل — ده مكرر فعلاً مع تريجر
--        fn_sales_return_status_change (فرع cancelled بيعمل بالظبط
--        نفس UPDATE customers SET balance = balance + total).
--    الإصلاح هنا: نشيل بس تكرار الرصيد (ب)، ونسيب عكس المخزون (أ).
--
-- 2) مرتجع الشراء (fn_purchase_return_status_change): على عكس مرتجع
--    البيع، فيه فرع "cancelled" شغّال فعليًا وبيعكس المخزون (باستخدام
--    adjust_stock) + رصيد المورد + قيد. لكن اتأكد إن الفرع ده بيستخدم
--    v_wh = المخزن الرئيسي *دايمًا* (hardcoded)، مش warehouse_id
--    بتاع المرتجع نفسه — بعكس fn_purchase_status_change (فواتير
--    الشراء) اللي بتستخدم coalesce(new.warehouse_id, المخزن الرئيسي).
--    وبما إن fn_reverse_purchase_return_for_edit القديمة كانت بترجّع
--    المخزون يدويًا في warehouse_id الحقيقي بتاع المرتجع (مش الرئيسي)،
--    كان في رجوع مزدوج فعلي لو المرتجع في المخزن الرئيسي، ورجوع في
--    مخزن غلط تمامًا لو المرتجع في مخزن تاني (زي "المكنه").
--    الإصلاح هنا: (أ) نصحح v_wh في فرع cancelled بس عشان يستخدم
--    warehouse_id الحقيقي بتاع المرتجع (زي فواتير الشراء بالظبط)،
--    (ب) نشيل fn_reverse_purchase_return_for_edit اليدوية تمامًا
--    ونخلي التريجر المُصحَّح هو المصدر الوحيد لكل حاجة (رصيد + مخزون
--    + قيد) — فرع "confirmed" (وقت الإنشاء) فضل زي ما هو (dead loop
--    غير مؤثر لأن البنود لسه ما اتسجلتش وقت ما التريجر ده بيتنفذ على
--    الهيدر، فمفيش أي تغيير سلوك حقيقي هناك).
-- ════════════════════════════════════════════════════════════

-- 1) مرتجع البيع: نفس الفكرة، نسيب عكس المخزون، نشيل تكرار رصيد العميل بس
CREATE OR REPLACE FUNCTION public.fn_reverse_sales_return_for_edit(p_return_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_warehouse_id uuid;
    r RECORD;
BEGIN
    SELECT warehouse_id INTO v_warehouse_id
    FROM public.sales_returns WHERE id = p_return_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'sales_return % not found', p_return_id;
    END IF;

    -- يفجّر trg_sales_return_status → فرع cancelled: عكس رصيد العميل
    -- (لو آجل) + قيد REV-SR + financial event — التريجر مفيهوش أي
    -- منطق مخزون خالص لمرتجعات البيع (اتأكد من الكود الحي)
    UPDATE public.sales_returns SET status = 'cancelled' WHERE id = p_return_id;

    -- اخصم الكمية اللي كانت اترجّعت للمخزون وقت المرتجع القديم
    -- (عكس fn_sale_return_item_stock اللي بيزوّد المخزون عند INSERT —
    -- ده المصدر الوحيد لمخزون مرتجعات البيع، مفيش تريجر بيعكسه عند الإلغاء)
    IF v_warehouse_id IS NOT NULL THEN
        FOR r IN
            SELECT product_id, COALESCE(qty,0) AS need
            FROM public.sale_return_items WHERE return_id = p_return_id
        LOOP
            IF r.product_id IS NULL OR r.need = 0 THEN CONTINUE; END IF;

            UPDATE public.inventory_stock SET qty = COALESCE(qty,0) - r.need
            WHERE warehouse_id = v_warehouse_id AND product_id = r.product_id;
        END LOOP;
    END IF;
END;
$function$;

-- 2) مرتجع الشراء: صحّح مخزن الفرع cancelled في التريجر عشان يستخدم
--    warehouse_id الحقيقي بتاع المرتجع (زي فواتير الشراء بالظبط)
CREATE OR REPLACE FUNCTION public.fn_purchase_return_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_wh uuid; v_item record; v_smallest_qty numeric; v_counter text;
begin
  v_counter := case when new.payment_type = 'cash' then '1001' else '2001' end;

  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then
    v_wh := (select id from public.warehouses where is_main limit 1);

    if new.payment_type = 'cash' then
      perform public.post_cash('in', new.total, 'مرتجع شراء #'||new.return_no, 'purchase_return', new.id, new.created_by, new.treasury_id);
    elsif coalesce(new.affects_supplier_balance, true) then
      update public.suppliers set balance = balance - new.total, updated_at = now() where id = new.supplier_id;
    end if;

    -- مدين v_counter (نقدية 1001 أو تخفيض مديونية المورد 2001) / دائن 1004 (خروج بضاعة)
    perform public.post_journal('PRR-'||new.return_no, 'مرتجع شراء #'||new.return_no, 'purchase_return', new.id, new.created_by,
      jsonb_build_array(
        jsonb_build_object('account_code',v_counter,'debit',new.total,'credit',0),
        jsonb_build_object('account_code','1004','debit',0,'credit',new.total)));

    for v_item in select product_id, qty, units_per_carton_snapshot
                  from public.purchase_return_items where return_id = new.id
    loop
      v_smallest_qty := v_item.qty * v_item.units_per_carton_snapshot;
      perform public.adjust_stock(v_wh, v_item.product_id, -v_smallest_qty);
    end loop;

    perform public.log_financial_event('create', 'purchase_return', new.id, 'مرتجع شراء #'||new.return_no,
      null, to_jsonb(new), new.created_by);

  elsif new.status = 'cancelled' and old.status = 'confirmed' then
    -- ★ الفرق عن قبل: هنا لازم نستخدم warehouse_id الحقيقي بتاع
    --   المرتجع (زي fn_purchase_status_change بالظبط) مش المخزن
    --   الرئيسي دايمًا — لأن ده الفرع اللي بيتنفذ فعليًا وقت الإلغاء
    --   (البنود موجودة فعلاً وقتها)، بعكس فرع confirmed اللي بيفضل
    --   no-op لأن البنود لسه ما اتسجلتش وقت ما هذا التريجر يشتغل
    v_wh := coalesce(new.warehouse_id, (select id from public.warehouses where is_main limit 1));

    if new.payment_type = 'cash' then
      perform public.post_cash('out', new.total, 'عكس مرتجع شراء #'||new.return_no, 'reversal', new.id, new.created_by, new.treasury_id);
    elsif coalesce(new.affects_supplier_balance, true) then
      update public.suppliers set balance = balance + new.total, updated_at = now() where id = new.supplier_id;
    end if;

    perform public.post_journal('REV-PRR-'||new.return_no, 'عكس مرتجع شراء #'||new.return_no, 'purchase_return', new.id, new.created_by,
      jsonb_build_array(
        jsonb_build_object('account_code',v_counter,'debit',0,'credit',new.total),
        jsonb_build_object('account_code','1004','debit',new.total,'credit',0)));

    for v_item in select product_id, qty, units_per_carton_snapshot
                  from public.purchase_return_items where return_id = new.id
    loop
      v_smallest_qty := v_item.qty * v_item.units_per_carton_snapshot;
      perform public.adjust_stock(v_wh, v_item.product_id, v_smallest_qty);
    end loop;

    perform public.log_financial_event('cancel', 'purchase_return', new.id, 'إلغاء مرتجع شراء #'||new.return_no,
      to_jsonb(old), to_jsonb(new), new.created_by);

  end if;
  return new;
end;
$function$;

-- 3) مرتجع الشراء: دلوقتي التريجر المُصحَّح هو المصدر الوحيد لكل حاجة
--    عند الإلغاء — نشيل الكود اليدوي المكرر تمامًا (نفس ما اتعمل
--    لمرتجع البيع بس من غير عكس مخزون يدوي، لأن التريجر بقى بيعمله صح)
CREATE OR REPLACE FUNCTION public.fn_reverse_purchase_return_for_edit(p_return_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.purchase_returns WHERE id = p_return_id) THEN
        RAISE EXCEPTION 'purchase_return % not found', p_return_id;
    END IF;

    -- يفجّر trg_purchase_return_status → فرع cancelled المُصحَّح فوق:
    -- عكس المخزون (في المخزن الحقيقي بتاع المرتجع) + رصيد المورد + قيد REV-PRR
    UPDATE public.purchase_returns SET status = 'cancelled' WHERE id = p_return_id;
END;
$function$;
