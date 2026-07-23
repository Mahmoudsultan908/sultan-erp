-- إصلاح: القيد المحاسبي لفاتورة فيها خصم كان بيقيّد الإيراد/قيمة المخزون
-- بالمبلغ الإجمالي (subtotal) لكن يقيّد العميل/المورد بالمبلغ الصافي
-- (total)، فيفضل القيد مش متوازن بمقدار الخصم بالظبط. الحل: نستخدم
-- total (الصافي) في الطرفين، يطابق فعليًا اللي بيتقيد على رصيد
-- العميل/المورد أصلًا. صحّحنا كمان قيدين تاريخيين كانوا متأثرين
-- (SALE-INV-0104 فرق 240، PUR-PUR-0006 فرق 4.03) يدويًا بعد نشر الإصلاح.

CREATE OR REPLACE FUNCTION public.fn_sale_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_counter text; v_wh uuid; v_item record; v_smallest_qty numeric;
begin
  v_counter := case when new.payment_type = 'cash' then '1001' else '1003' end;
  v_wh := coalesce(new.warehouse_id, (select id from public.warehouses where is_main limit 1));

  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then

    if new.payment_type = 'cash' then
      perform public.post_cash('in', new.total, 'فاتورة بيع #'||new.invoice_no, 'sale', new.id, new.created_by, new.treasury_id, new.created_at);
    else
      update public.customers set balance = balance + new.total, updated_at = now() where id = new.customer_id;
    end if;

    perform public.post_journal('SALE-'||new.invoice_no, 'فاتورة بيع #'||new.invoice_no, 'sale', new.id, new.created_by,
      public.build_lines(v_counter, new.total, new.vat_amount, '4001', new.total, true), new.created_at);

    if coalesce(new.source_app, 'erp') <> 'rep_van' then
      for v_item in select product_id, qty, unit_type, units_per_carton_snapshot
                    from public.sale_items where sale_id = new.id
      loop
        perform public.validate_units_snapshot(v_item.units_per_carton_snapshot);
        v_smallest_qty := case when v_item.unit_type = 'purchase_unit'
                                then v_item.qty * v_item.units_per_carton_snapshot else v_item.qty end;
        perform public.adjust_stock(v_wh, v_item.product_id, -v_smallest_qty);
      end loop;
    end if;

    perform public.log_financial_event('create', 'sale', new.id, 'فاتورة بيع #'||new.invoice_no,
      null, to_jsonb(new), new.created_by, coalesce(new.source_app,'erp'));

  elsif new.status = 'cancelled' and old.status = 'confirmed' then

    if new.payment_type = 'cash' then
      perform public.post_cash('out', new.total, 'عكس فاتورة بيع #'||new.invoice_no, 'reversal', new.id, new.created_by, new.treasury_id, now());
    else
      update public.customers set balance = balance - new.total, updated_at = now() where id = new.customer_id;
    end if;

    perform public.post_journal('REV-SALE-'||new.invoice_no, 'عكس فاتورة بيع #'||new.invoice_no, 'sale', new.id, new.created_by,
      public.build_lines(v_counter, new.total, new.vat_amount, '4001', new.total, false), now());

    if coalesce(new.source_app, 'erp') <> 'rep_van' then
      for v_item in select product_id, qty, unit_type, units_per_carton_snapshot
                    from public.sale_items where sale_id = new.id
      loop
        v_smallest_qty := case when v_item.unit_type = 'purchase_unit'
                                then v_item.qty * v_item.units_per_carton_snapshot else v_item.qty end;
        perform public.adjust_stock(v_wh, v_item.product_id, v_smallest_qty);
      end loop;
    end if;

    perform public.log_financial_event('cancel', 'sale', new.id, 'إلغاء فاتورة بيع #'||new.invoice_no,
      to_jsonb(old), to_jsonb(new), new.created_by, coalesce(new.source_app,'erp'));

  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_purchase_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_counter text; v_wh uuid; v_item record; v_smallest_qty numeric;
begin
  v_counter := case when new.payment_type = 'cash' then '1001' else '2001' end;
  v_wh := coalesce(new.warehouse_id, (select id from public.warehouses where is_main limit 1));

  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then

    if new.payment_type = 'cash' then
      perform public.post_cash('out', new.total, 'فاتورة شراء #'||new.invoice_no, 'purchase', new.id, new.created_by, new.treasury_id, new.created_at);
    else
      update public.suppliers set balance = balance + new.total, updated_at = now() where id = new.supplier_id;
    end if;

    perform public.post_journal('PUR-'||new.invoice_no, 'فاتورة شراء #'||new.invoice_no, 'purchase', new.id, new.created_by,
      public.build_lines('1004', new.total, new.vat_amount, v_counter, new.total, true), new.created_at);

    for v_item in select id, product_id, qty, units_per_carton_snapshot, deferred_rate, deferred_due_date
                  from public.purchase_items where purchase_id = new.id
    loop
      perform public.validate_units_snapshot(v_item.units_per_carton_snapshot);
      v_smallest_qty := v_item.qty * v_item.units_per_carton_snapshot;
      perform public.adjust_stock(v_wh, v_item.product_id, v_smallest_qty);

      if coalesce(v_item.deferred_rate, 0) > 0 then
        insert into public.deferred_rebates
          (supplier_id, purchase_id, purchase_item_id, product_id, qty, rate, due_date)
        values
          (new.supplier_id, new.id, v_item.id, v_item.product_id, v_item.qty, v_item.deferred_rate, v_item.deferred_due_date);
      end if;
    end loop;

    perform public.log_financial_event('create', 'purchase', new.id, 'فاتورة شراء #'||new.invoice_no,
      null, to_jsonb(new), new.created_by);

  elsif new.status = 'cancelled' and old.status = 'confirmed' then

    if new.payment_type = 'cash' then
      perform public.post_cash('in', new.total, 'عكس فاتورة شراء #'||new.invoice_no, 'reversal', new.id, new.created_by, new.treasury_id, now());
    else
      update public.suppliers set balance = balance - new.total, updated_at = now() where id = new.supplier_id;
    end if;

    perform public.post_journal('REV-PUR-'||new.invoice_no, 'عكس فاتورة شراء #'||new.invoice_no, 'purchase', new.id, new.created_by,
      public.build_lines('1004', new.total, new.vat_amount, v_counter, new.total, false), now());

    for v_item in select product_id, qty, units_per_carton_snapshot from public.purchase_items where purchase_id = new.id loop
      v_smallest_qty := v_item.qty * v_item.units_per_carton_snapshot;
      perform public.adjust_stock(v_wh, v_item.product_id, -v_smallest_qty);
    end loop;

    update public.deferred_rebates set status = 'cancelled', updated_at = now()
    where purchase_id = new.id and status <> 'cancelled';

    perform public.log_financial_event('cancel', 'purchase', new.id, 'إلغاء فاتورة شراء #'||new.invoice_no,
      to_jsonb(old), to_jsonb(new), new.created_by);

  end if;
  return new;
end;
$function$;
