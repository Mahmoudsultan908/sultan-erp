-- ════════════════════════════════════════════════════════════
-- treasuries_migration_part2.sql
-- شغّل هذا بعد treasuries_migration.sql (مرة واحدة، آمن للتكرار).
--
-- ده الجزء اللي كان محتاج نتيجة Phase 0. اكتشفنا إن كل الـ triggers
-- (sales/purchases/sales_returns/expenses/supplier_payments/
-- customer_payments/opening_balances) بتنادي دالة مركزية واحدة اسمها
-- post_cash() لتسجيل حركة الخزنة — يعني مش محتاجين نعدّل 7 دوال معقدة،
-- بس نضيف باراميتر treasury_id لـ post_cash() نفسها، ونعدّل كل نداء
-- ليها (7 دوال × نداءين تأكيد/عكس) عشان تمرر new.treasury_id. باقي كل
-- سطر في كل دالة **زي ما هو بالظبط من غير أي تغيير في المنطق**.
--
-- purchase_returns اتقصدت عمداً بره — trigger بتاعها (fn_purchase_
-- return_status_change) أصلاً مبيناديش post_cash إطلاقاً ("لا خزنة
-- إطلاقاً، حسب الاتفاق" — تعليق موجود في الكود نفسه)، فمفيهاش عمود
-- treasury_id ولا محتاجة تعديل.
--
-- قرار نطاق: treasury_transfers (الملف اللي فات) وbalance_transfers
-- (تحت) اتعملوا INSERT-only بسيط من غير عمود status/إلغاء — عكس أي
-- تحويل غلط بيبقى بعمل تحويل عكسي مماثل، بدل ما نضيف آلية إلغاء
-- مركبة محدش طلبها. لو عايز إلغاء/عكس لاحقاً قولّي نضيفه بنفس نمط
-- status='cancelled' المستخدم في باقي الجداول.
-- ════════════════════════════════════════════════════════════

-- ── 0) إصلاح: get_cash_balance() القديمة (من غير باراميتر) لسه موجودة
--    جنب النسخة الجديدة get_cash_balance(uuid) اللي اتعملت في الملف
--    اللي فات — CREATE OR REPLACE بيستبدل بس لو نفس توقيع الباراميترات
--    بالظبط، فالدالتين اتسجلوا لوحدهم في قاعدة البيانات. ده بيسبب
--    "Could not choose the best candidate function" من Supabase/PostgREST
--    لأي نداء sb.rpc('get_cash_balance') من غير باراميتر (7 أماكن في
--    الكود). لازم نمسح النسخة القديمة عشان يفضل توقيع واحد بس.
DROP FUNCTION IF EXISTS public.get_cash_balance();

-- ── 1) عمود treasury_id على الجداول اللي فعلاً بتلمس الخزنة ──
-- ★ عمداً من غير backfill هنا: فيه trigger حماية (fn_block_amount_edit_
--   after_confirm) بيمنع أي UPDATE على صف مؤكد (status='confirmed') غير
--   تغيير status لـ cancelled. مش مشكلة — العمود الجديد مش محتاج قيمة في
--   السجلات القديمة، هو بس هيتملى في أي عملية جديدة من هنا وبعدين. رصيد
--   الخزن التاريخي فعلاً معتمد على cash_transactions.treasury_id، وده
--   اتعمله backfill بنجاح في الملف اللي فات (مفيهوش الـ trigger ده).
ALTER TABLE sales             ADD COLUMN IF NOT EXISTS treasury_id uuid REFERENCES treasuries(id);
ALTER TABLE purchases         ADD COLUMN IF NOT EXISTS treasury_id uuid REFERENCES treasuries(id);
ALTER TABLE sales_returns     ADD COLUMN IF NOT EXISTS treasury_id uuid REFERENCES treasuries(id);
ALTER TABLE expenses          ADD COLUMN IF NOT EXISTS treasury_id uuid REFERENCES treasuries(id);
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS treasury_id uuid REFERENCES treasuries(id);
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS treasury_id uuid REFERENCES treasuries(id);
ALTER TABLE opening_balances  ADD COLUMN IF NOT EXISTS treasury_id uuid REFERENCES treasuries(id);

-- ── 2) post_cash() تدعم خزنة اختيارية — تفشل بأمان لخزنة افتراضية لو محدش بعتها ──
CREATE OR REPLACE FUNCTION public.post_cash(
    p_direction text, p_amount numeric, p_reason text, p_ref_type text,
    p_ref_id uuid, p_created_by uuid, p_treasury_id uuid DEFAULT NULL
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_treasury_id uuid;
begin
  if p_amount is null or p_amount <= 0 then return null; end if;
  v_treasury_id := coalesce(p_treasury_id, (select id from treasuries where is_default limit 1));
  insert into public.cash_transactions (direction, amount, reason, ref_type, ref_id, created_by, treasury_id)
  values (p_direction, p_amount, p_reason, p_ref_type, p_ref_id, p_created_by, v_treasury_id)
  returning id into v_id;
  return v_id;
end;
$function$;

-- ── 3) كل الـ triggers اللي بتنادي post_cash — نفس المنطق بالحرف، بس بتمرر treasury_id ──

CREATE OR REPLACE FUNCTION public.fn_opening_balance_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_lines jsonb;
begin
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then

    if new.balance_type = 'cash' then
      perform public.validate_cash_account(coalesce(new.cash_account_code, '1001'));
      perform public.post_cash('in', new.amount, 'رصيد افتتاحي - خزنة', 'opening_balance', new.id, new.created_by, new.treasury_id);
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code', coalesce(new.cash_account_code,'1001'), 'debit', new.amount, 'credit', 0),
        jsonb_build_object('account_code', '3001', 'debit', 0, 'credit', new.amount));

    elsif new.balance_type = 'customer' then
      update public.customers set balance = balance + new.amount, updated_at = now() where id = new.customer_id;
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code', '1003', 'debit', new.amount, 'credit', 0),
        jsonb_build_object('account_code', '3001', 'debit', 0, 'credit', new.amount));

    elsif new.balance_type = 'supplier' then
      update public.suppliers set balance = balance + new.amount, updated_at = now() where id = new.supplier_id;
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code', '3001', 'debit', new.amount, 'credit', 0),
        jsonb_build_object('account_code', '2001', 'debit', 0, 'credit', new.amount));

    elsif new.balance_type = 'inventory' then
      perform public.adjust_stock(new.warehouse_id, new.product_id, new.qty);
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code', '1004', 'debit', new.amount, 'credit', 0),
        jsonb_build_object('account_code', '3001', 'debit', 0, 'credit', new.amount));

    elsif new.balance_type = 'prior_profit_loss' then
      if new.amount >= 0 then
        v_lines := jsonb_build_array(
          jsonb_build_object('account_code', '3001', 'debit', new.amount, 'credit', 0),
          jsonb_build_object('account_code', '3002', 'debit', 0, 'credit', new.amount));
      else
        v_lines := jsonb_build_array(
          jsonb_build_object('account_code', '3002', 'debit', -new.amount, 'credit', 0),
          jsonb_build_object('account_code', '3001', 'debit', 0, 'credit', -new.amount));
      end if;
    end if;

    perform public.post_journal('OB-'||substr(new.id::text,1,8), 'رصيد افتتاحي - '||new.balance_type,
      'opening_balance', new.id, new.created_by, v_lines);
    perform public.log_financial_event('create', 'opening_balance', new.id,
      'إثبات رصيد افتتاحي: '||new.balance_type, null, to_jsonb(new), new.created_by);

  elsif new.status = 'cancelled' and old.status = 'confirmed' then

    if new.balance_type = 'cash' then
      perform public.post_cash('out', new.amount, 'عكس رصيد افتتاحي - خزنة', 'reversal', new.id, new.created_by, new.treasury_id);
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code', coalesce(new.cash_account_code,'1001'), 'debit', 0, 'credit', new.amount),
        jsonb_build_object('account_code', '3001', 'debit', new.amount, 'credit', 0));

    elsif new.balance_type = 'customer' then
      update public.customers set balance = balance - new.amount, updated_at = now() where id = new.customer_id;
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code', '1003', 'debit', 0, 'credit', new.amount),
        jsonb_build_object('account_code', '3001', 'debit', new.amount, 'credit', 0));

    elsif new.balance_type = 'supplier' then
      update public.suppliers set balance = balance - new.amount, updated_at = now() where id = new.supplier_id;
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code', '3001', 'debit', 0, 'credit', new.amount),
        jsonb_build_object('account_code', '2001', 'debit', new.amount, 'credit', 0));

    elsif new.balance_type = 'inventory' then
      perform public.adjust_stock(new.warehouse_id, new.product_id, -new.qty);
      v_lines := jsonb_build_array(
        jsonb_build_object('account_code', '1004', 'debit', 0, 'credit', new.amount),
        jsonb_build_object('account_code', '3001', 'debit', new.amount, 'credit', 0));

    elsif new.balance_type = 'prior_profit_loss' then
      if new.amount >= 0 then
        v_lines := jsonb_build_array(
          jsonb_build_object('account_code', '3001', 'debit', 0, 'credit', new.amount),
          jsonb_build_object('account_code', '3002', 'debit', new.amount, 'credit', 0));
      else
        v_lines := jsonb_build_array(
          jsonb_build_object('account_code', '3002', 'debit', 0, 'credit', -new.amount),
          jsonb_build_object('account_code', '3001', 'debit', -new.amount, 'credit', 0));
      end if;
    end if;

    perform public.post_journal('REV-OB-'||substr(new.id::text,1,8), 'عكس رصيد افتتاحي - '||new.balance_type,
      'opening_balance', new.id, new.created_by, v_lines);
    perform public.log_financial_event('cancel', 'opening_balance', new.id,
      'إلغاء رصيد افتتاحي: '||new.balance_type, to_jsonb(old), to_jsonb(new), new.created_by);

  end if;
  return new;
end;
$function$;

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
      perform public.post_cash('in', new.total, 'فاتورة بيع #'||new.invoice_no, 'sale', new.id, new.created_by, new.treasury_id);
    else
      update public.customers set balance = balance + new.total, updated_at = now() where id = new.customer_id;
    end if;

    perform public.post_journal('SALE-'||new.invoice_no, 'فاتورة بيع #'||new.invoice_no, 'sale', new.id, new.created_by,
      public.build_lines(v_counter, new.total, new.vat_amount, '4001', new.subtotal, true));

    for v_item in select product_id, qty, unit_type, units_per_carton_snapshot
                  from public.sale_items where sale_id = new.id
    loop
      perform public.validate_units_snapshot(v_item.units_per_carton_snapshot);
      v_smallest_qty := case when v_item.unit_type = 'purchase_unit'
                              then v_item.qty * v_item.units_per_carton_snapshot else v_item.qty end;
      perform public.adjust_stock(v_wh, v_item.product_id, -v_smallest_qty);
    end loop;

    perform public.log_financial_event('create', 'sale', new.id, 'فاتورة بيع #'||new.invoice_no,
      null, to_jsonb(new), new.created_by, coalesce(new.source_app,'erp'));

  elsif new.status = 'cancelled' and old.status = 'confirmed' then

    if new.payment_type = 'cash' then
      perform public.post_cash('out', new.total, 'عكس فاتورة بيع #'||new.invoice_no, 'reversal', new.id, new.created_by, new.treasury_id);
    else
      update public.customers set balance = balance - new.total, updated_at = now() where id = new.customer_id;
    end if;

    perform public.post_journal('REV-SALE-'||new.invoice_no, 'عكس فاتورة بيع #'||new.invoice_no, 'sale', new.id, new.created_by,
      public.build_lines(v_counter, new.total, new.vat_amount, '4001', new.subtotal, false));

    for v_item in select product_id, qty, unit_type, units_per_carton_snapshot
                  from public.sale_items where sale_id = new.id
    loop
      v_smallest_qty := case when v_item.unit_type = 'purchase_unit'
                              then v_item.qty * v_item.units_per_carton_snapshot else v_item.qty end;
      perform public.adjust_stock(v_wh, v_item.product_id, v_smallest_qty);
    end loop;

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
      perform public.post_cash('out', new.total, 'فاتورة شراء #'||new.invoice_no, 'purchase', new.id, new.created_by, new.treasury_id);
    else
      update public.suppliers set balance = balance + new.total, updated_at = now() where id = new.supplier_id;
    end if;

    perform public.post_journal('PUR-'||new.invoice_no, 'فاتورة شراء #'||new.invoice_no, 'purchase', new.id, new.created_by,
      public.build_lines('1004', new.subtotal, new.vat_amount, v_counter, new.total, true));

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
      perform public.post_cash('in', new.total, 'عكس فاتورة شراء #'||new.invoice_no, 'reversal', new.id, new.created_by, new.treasury_id);
    else
      update public.suppliers set balance = balance - new.total, updated_at = now() where id = new.supplier_id;
    end if;

    perform public.post_journal('REV-PUR-'||new.invoice_no, 'عكس فاتورة شراء #'||new.invoice_no, 'purchase', new.id, new.created_by,
      public.build_lines('1004', new.subtotal, new.vat_amount, v_counter, new.total, false));

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
    else
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
    else
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

CREATE OR REPLACE FUNCTION public.fn_expense_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_acc text;
begin
  select account_code into v_acc from public.expense_categories where id = new.category_id;

  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then

    perform public.post_cash('out', new.amount, 'مصروف #'||new.ref, 'expense', new.id, new.created_by, new.treasury_id);
    perform public.post_journal('EXP-'||new.ref, 'مصروف #'||new.ref, 'expense', new.id, new.created_by,
      public.build_lines(v_acc, new.amount, 0, '1001', new.amount, true));
    perform public.log_financial_event('create', 'expense', new.id, 'مصروف #'||new.ref,
      null, to_jsonb(new), new.created_by);

  elsif new.status = 'cancelled' and old.status = 'confirmed' then

    perform public.post_cash('in', new.amount, 'عكس مصروف #'||new.ref, 'reversal', new.id, new.created_by, new.treasury_id);
    perform public.post_journal('REV-EXP-'||new.ref, 'عكس مصروف #'||new.ref, 'expense', new.id, new.created_by,
      public.build_lines(v_acc, new.amount, 0, '1001', new.amount, false));
    perform public.log_financial_event('cancel', 'expense', new.id, 'إلغاء مصروف #'||new.ref,
      to_jsonb(old), to_jsonb(new), new.created_by);

  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_payment_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then

    perform public.post_cash('out', new.amount, 'دفع لمورد #'||new.ref, 'payment', new.id, new.created_by, new.treasury_id);
    update public.suppliers set balance = balance - new.amount, updated_at = now() where id = new.supplier_id;
    perform public.post_journal('PAY-'||new.ref, 'دفع لمورد #'||new.ref, 'payment', new.id, new.created_by,
      public.build_lines('2001', new.amount, 0, '1001', new.amount, true));
    perform public.log_financial_event('create', 'payment', new.id, 'دفع لمورد #'||new.ref,
      null, to_jsonb(new), new.created_by);

  elsif new.status = 'cancelled' and old.status = 'confirmed' then

    perform public.post_cash('in', new.amount, 'عكس دفعة مورد #'||new.ref, 'reversal', new.id, new.created_by, new.treasury_id);
    update public.suppliers set balance = balance + new.amount, updated_at = now() where id = new.supplier_id;
    perform public.post_journal('REV-PAY-'||new.ref, 'عكس دفعة مورد #'||new.ref, 'payment', new.id, new.created_by,
      public.build_lines('2001', new.amount, 0, '1001', new.amount, false));
    perform public.log_financial_event('cancel', 'payment', new.id, 'إلغاء دفعة مورد #'||new.ref,
      to_jsonb(old), to_jsonb(new), new.created_by);

  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_customer_payment_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status <> 'confirmed') then

    perform public.post_cash('in', new.amount, 'تحصيل من عميل #'||coalesce(new.ref,new.id::text), 'collection', new.id, new.created_by, new.treasury_id);
    update public.customers set balance = balance - new.amount, updated_at = now() where id = new.customer_id;
    perform public.post_journal('CPAY-'||substr(new.id::text,1,8), 'تحصيل من عميل #'||coalesce(new.ref,new.id::text), 'collection', new.id, new.created_by,
      public.build_lines('1001', new.amount, 0, '1003', new.amount, true));
    perform public.log_financial_event('create', 'customer_payment', new.id, 'تحصيل من عميل #'||coalesce(new.ref,new.id::text),
      null, to_jsonb(new), new.created_by);

  elsif new.status = 'cancelled' and old.status = 'confirmed' then

    perform public.post_cash('out', new.amount, 'عكس تحصيل #'||coalesce(new.ref,new.id::text), 'reversal', new.id, new.created_by, new.treasury_id);
    update public.customers set balance = balance + new.amount, updated_at = now() where id = new.customer_id;
    perform public.post_journal('REV-CPAY-'||substr(new.id::text,1,8), 'عكس تحصيل من عميل #'||coalesce(new.ref,new.id::text), 'collection', new.id, new.created_by,
      public.build_lines('1001', new.amount, 0, '1003', new.amount, false));
    perform public.log_financial_event('cancel', 'customer_payment', new.id, 'إلغاء تحصيل #'||coalesce(new.ref,new.id::text),
      to_jsonb(old), to_jsonb(new), new.created_by);

  end if;
  return new;
end;
$function$;

-- ── 4) balance_transfers — عميل↔عميل / مورد↔مورد / مورد→خزنة (استرداد نقدي) ──
-- INSERT-only بسيط (زي treasury_transfers) — عكس تحويل غلط = تحويل عكسي مماثل.
--
-- عميل↔عميل ومورد↔مورد: نفس حساب التحكم (1003 العملاء أو 2001 الموردين)
-- على الطرفين، فالقيد بيتوازن على نفسه (صافي الأثر على الحساب = صفر —
-- ده صح محاسبياً، لأن إجمالي مديونية العملاء/الموردين مش بيتغيّر، بس
-- التوزيع الداخلي بين العميل/المورد بيتغيّر، وده متسجّل في balance
-- الفردي لكل واحد + سطر balance_transfers نفسه كمرجع).
--
-- مورد→خزنة: نفس شكل "عكس دفعة مورد" بالظبط (cash in / debit 1001 /
-- credit 2001) — لأنها اقتصادياً نفس العملية (استرجاع رصيد دائن كان
-- للمورد في صورة كاش).
CREATE TABLE IF NOT EXISTS balance_transfers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transfer_type text NOT NULL CHECK (transfer_type IN ('customer_to_customer','supplier_to_supplier','supplier_to_treasury')),
    from_customer_id uuid REFERENCES customers(id),
    to_customer_id uuid REFERENCES customers(id),
    from_supplier_id uuid REFERENCES suppliers(id),
    to_supplier_id uuid REFERENCES suppliers(id),
    treasury_id uuid REFERENCES treasuries(id),
    amount numeric NOT NULL CHECK (amount > 0),
    notes text,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (transfer_type = 'customer_to_customer' AND from_customer_id IS NOT NULL AND to_customer_id IS NOT NULL AND from_customer_id <> to_customer_id)
        OR (transfer_type = 'supplier_to_supplier' AND from_supplier_id IS NOT NULL AND to_supplier_id IS NOT NULL AND from_supplier_id <> to_supplier_id)
        OR (transfer_type = 'supplier_to_treasury' AND from_supplier_id IS NOT NULL AND treasury_id IS NOT NULL)
    )
);

CREATE OR REPLACE FUNCTION fn_balance_transfer_apply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
    if new.transfer_type = 'customer_to_customer' then
        update customers set balance = balance - new.amount, updated_at = now() where id = new.from_customer_id;
        update customers set balance = balance + new.amount, updated_at = now() where id = new.to_customer_id;
        perform post_journal('BT-'||substr(new.id::text,1,8), 'تحويل رصيد بين عملاء', 'balance_transfer', new.id, new.created_by,
            jsonb_build_array(
                jsonb_build_object('account_code','1003','debit',new.amount,'credit',0),
                jsonb_build_object('account_code','1003','debit',0,'credit',new.amount)));
        perform log_financial_event('create', 'balance_transfer', new.id, 'تحويل رصيد من عميل لعميل', null, to_jsonb(new), new.created_by);

    elsif new.transfer_type = 'supplier_to_supplier' then
        update suppliers set balance = balance - new.amount, updated_at = now() where id = new.from_supplier_id;
        update suppliers set balance = balance + new.amount, updated_at = now() where id = new.to_supplier_id;
        perform post_journal('BT-'||substr(new.id::text,1,8), 'تحويل رصيد بين موردين', 'balance_transfer', new.id, new.created_by,
            jsonb_build_array(
                jsonb_build_object('account_code','2001','debit',new.amount,'credit',0),
                jsonb_build_object('account_code','2001','debit',0,'credit',new.amount)));
        perform log_financial_event('create', 'balance_transfer', new.id, 'تحويل رصيد من مورد لمورد', null, to_jsonb(new), new.created_by);

    elsif new.transfer_type = 'supplier_to_treasury' then
        update suppliers set balance = balance + new.amount, updated_at = now() where id = new.from_supplier_id;
        perform post_cash('in', new.amount, 'استرداد نقدي من رصيد مورد', 'balance_transfer', new.id, new.created_by, new.treasury_id);
        perform post_journal('BT-'||substr(new.id::text,1,8), 'استرداد نقدي من رصيد مورد', 'balance_transfer', new.id, new.created_by,
            jsonb_build_array(
                jsonb_build_object('account_code','1001','debit',new.amount,'credit',0),
                jsonb_build_object('account_code','2001','debit',0,'credit',new.amount)));
        perform log_financial_event('create', 'balance_transfer', new.id, 'استرداد نقدي من مورد لخزنة', null, to_jsonb(new), new.created_by);
    end if;

    return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_balance_transfer ON balance_transfers;
CREATE TRIGGER trg_balance_transfer
    AFTER INSERT ON balance_transfers
    FOR EACH ROW EXECUTE FUNCTION fn_balance_transfer_apply();
