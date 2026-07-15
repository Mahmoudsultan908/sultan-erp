-- ════════════════════════════════════════════════════════════
-- إصلاح خصم رصيد العميل مرتين لنفس مرتجع البيع (باگ مالي حقيقي)
--
-- الاستعلام اللي طلبته أكّد إن فيه *تريجرين* منفصلين شغالين فعلاً على
-- sales_returns بعد INSERT:
--   1) trg_sales_return_balance → fn_sales_return_balance()
--      (من returns_migration.sql، وعدّلناها إمبارح عشان تحترم
--      affects_customer_balance)
--   2) trg_sales_return_status → fn_sales_return_status_change()
--      (من treasuries_migration_part2.sql — الأحدث، وهي كمان اللي
--      بتعمل الخصم النقدي من الخزنة وبتسجّل القيد المحاسبي)
--
-- النتيجة: أي مرتجع بيع "آجل" (payment_type <> 'cash') كان بيخصم من
-- رصيد العميل *مرتين* (مرة من كل تريجر) — ومعنى كده إن checkbox
-- "خصم من رصيد العميل؟" اللي ضفناه إمبارح كان بيتحكم في نص المشكلة بس
-- (تريجر واحد من الاتنين)، مش كل المشكلة.
--
-- الحل: نخلي fn_sales_return_status_change هي المصدر الوحيد لتحريك
-- رصيد العميل (هي كمان المسؤولة عن الخزنة والقيد، فمنطقي تبقى هي
-- المرجع الواحد)، ونعلّمها تحترم affects_customer_balance الجديد،
-- ونشيل التريجر التاني القديم المكرر خالص.
-- ════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS trg_sales_return_balance ON public.sales_returns;

CREATE OR REPLACE FUNCTION public.fn_sales_return_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_counter text; v_wh uuid; v_item record; v_smallest_qty numeric;
begin
  v_counter := case when new.payment_type = 'cash' then '1001' else '1003' end;
  v_wh := (select id from public.warehouses where is_main limit 1);

  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then

    if new.payment_type = 'cash' then
      perform public.post_cash('out', new.total, 'مرتجع بيع #'||new.return_no, 'sales_return', new.id, new.created_by, new.treasury_id);
    elsif coalesce(new.affects_customer_balance, true) then
      update public.customers set balance = balance - new.total, updated_at = now() where id = new.customer_id;
    end if;

    perform public.post_journal('SR-'||new.return_no, 'مرتجع بيع #'||new.return_no, 'sales_return', new.id, new.created_by,
      public.build_lines('4001', new.total, 0, v_counter, new.total, true));

    for v_item in select product_id, qty, unit_type, units_per_carton_snapshot
                  from public.sales_return_items where return_id = new.id
    loop
      perform public.validate_units_snapshot(v_item.units_per_carton_snapshot);
      v_smallest_qty := case when v_item.unit_type = 'purchase_unit'
                              then v_item.qty * v_item.units_per_carton_snapshot else v_item.qty end;
      perform public.adjust_stock(v_wh, v_item.product_id, v_smallest_qty);
    end loop;

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

    for v_item in select product_id, qty, unit_type, units_per_carton_snapshot
                  from public.sales_return_items where return_id = new.id
    loop
      v_smallest_qty := case when v_item.unit_type = 'purchase_unit'
                              then v_item.qty * v_item.units_per_carton_snapshot else v_item.qty end;
      perform public.adjust_stock(v_wh, v_item.product_id, -v_smallest_qty);
    end loop;

    perform public.log_financial_event('cancel', 'sales_return', new.id, 'إلغاء مرتجع بيع #'||new.return_no,
      to_jsonb(old), to_jsonb(new), new.created_by);

  end if;
  return new;
end;
$function$;

-- ملاحظة: حلقة sales_return_items هنا (جدول بصيغة الجمع) مش نفس الجدول
-- الحقيقي اللي التطبيق بيكتب فيه فعلاً (sale_return_items، مفرد —
-- راجع returns_migration.sql/returns.js) ومفيهوش أعمدة unit_type/
-- units_per_carton_snapshot أصلاً. يعني الحلقة دي no-op دايماً حالياً
-- (0 صفوف)، وتحريك المخزون الحقيقي بيحصل من تريجر تاني منفصل
-- (trg_sale_return_item_stock على sale_return_items المفرد) — سيبناها
-- زي ما هي من غير لمس، مش جزء من مشكلة الخصم المضاعف.
