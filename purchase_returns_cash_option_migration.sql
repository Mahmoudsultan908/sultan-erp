-- ════════════════════════════════════════════════════════════
-- إضافة خيار "دفع نقدًا للمرتجع الآن؟" لمرتجع المشتريات — نفس فكرة
-- مرتجع المبيعات بالظبط (راجع sales_returns_affects_balance_migration.sql
-- وreturns.js retPayCash). قبل الملف ده، مرتجع المشتريات معندوش أي خيار
-- نقدي/آجل خالص وبيخصم رصيد المورد دايماً وبشكل غير مشروط.
--
-- المنطق الجديد لـ fn_purchase_return_status_change:
--   - payment_type='cash' → المورد رجّعلنا فلوس فعلاً: cash "in" في
--     الخزنة (عكس مرتجع البيع اللي بيدفع "out")، رصيد المورد ميتلمّسش.
--   - payment_type='credit' (الافتراضي) → لو affects_supplier_balance:
--     نفس السلوك القديم بالظبط (خصم من رصيد المورد).
-- القيد المحاسبي بيتبدّل الطرف التاني بس (1001 نقدية بدل 2001 مديونية
-- المورد) — نفس فلسفة v_counter في fn_sales_return_status_change.
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.purchase_returns
    ADD COLUMN IF NOT EXISTS payment_type text NOT NULL DEFAULT 'credit';
ALTER TABLE public.purchase_returns
    ADD COLUMN IF NOT EXISTS treasury_id uuid REFERENCES public.treasuries(id);
ALTER TABLE public.purchase_returns
    ADD COLUMN IF NOT EXISTS affects_supplier_balance boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.fn_purchase_return_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_wh uuid; v_item record; v_smallest_qty numeric; v_counter text;
begin
  v_wh := (select id from public.warehouses where is_main limit 1);
  v_counter := case when new.payment_type = 'cash' then '1001' else '2001' end;

  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then

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
