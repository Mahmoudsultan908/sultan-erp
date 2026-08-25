-- تصحيح مسار إيداع 35,000 للمالك بتاريخ 2026-08-16.
-- النقدية دخلت خزنة تقفيل بالفعل عن طريق supplier_to_treasury، لذلك لا
-- ننشئ حركة خزنة جديدة. نعيد فقط تصنيف الالتزام الوهمي إلى رأس مال المالك.

do $$
declare
    v_tx_id constant uuid := '460422da-2f3b-4659-a6b8-ca5e46138836';
    v_partner_id constant uuid := 'e6a613b3-22fb-4eb8-8382-f608c34a5ae9';
    v_supplier_id constant uuid := '198b01d5-2532-4da0-a37a-61fe197bc8b3';
    v_transfer_id constant uuid := '4dc97606-5229-46cc-8c43-45707dc113e8';
    v_treasury_id constant uuid := '364372c1-bdec-406f-91d0-b03fba854d9b';
    v_created_by uuid;
    v_supplier_balance numeric;
begin
    select created_by into v_created_by
    from public.capital_partner_transactions
    where id = v_tx_id
      and partner_id = v_partner_id
      and tx_date = date '2026-08-16'
      and tx_type = 'contribution'
      and amount = 35000
    for update;

    if not found then
        raise exception 'حركة رأس المال 35,000 غير مطابقة للبيانات المعتمدة';
    end if;

    select balance into v_supplier_balance
    from public.suppliers
    where id = v_supplier_id
      and name = 'إيداع رأس مال — باقى الدهب بعد البيع موجدين فى حساب المسثمر محمود عايزين قيد محاسبى'
    for update;

    if not found or v_supplier_balance <> 35000 then
        raise exception 'رصيد المورد المؤقت غير مطابق للقيمة المتوقعة 35,000';
    end if;

    if not exists (
        select 1 from public.balance_transfers
        where id = v_transfer_id
          and transfer_type = 'supplier_to_treasury'
          and from_supplier_id = v_supplier_id
          and treasury_id = v_treasury_id
          and amount = 35000
    ) then
        raise exception 'تحويل المورد إلى خزنة تقفيل غير موجود أو غير مطابق';
    end if;

    if not exists (
        select 1 from public.cash_transactions
        where ref_type = 'balance_transfer'
          and ref_id = v_transfer_id
          and treasury_id = v_treasury_id
          and direction = 'in'
          and amount = 35000
    ) then
        raise exception 'حركة دخول 35,000 إلى خزنة تقفيل غير موجودة';
    end if;

    if not exists (
        select 1
        from public.journal_entries je
        join public.journal_entry_lines dr on dr.entry_id = je.id
        join public.journal_entry_lines cr on cr.entry_id = je.id
        where je.ref_id = v_transfer_id
          and je.ref_type = 'balance_transfer'
          and dr.account_code = '1001' and dr.debit = 35000
          and cr.account_code = '2001' and cr.credit = 35000
    ) then
        raise exception 'قيد دخول المبلغ الحالي غير موجود أو غير مطابق';
    end if;

    if exists (select 1 from public.journal_entries where ref = 'RECLASS-OWNER-CAPITAL-35000-2026-08-16') then
        raise exception 'قيد إعادة التصنيف منفذ بالفعل';
    end if;

    update public.capital_partner_transactions
    set treasury_id = v_treasury_id
    where id = v_tx_id and treasury_id is null;

    if not found then
        raise exception 'حركة رأس المال مرتبطة بخزنة أخرى بالفعل';
    end if;

    update public.suppliers
    set balance = 0,
        is_active = false,
        updated_at = now()
    where id = v_supplier_id;

    perform public.post_journal(
        'RECLASS-OWNER-CAPITAL-35000-2026-08-16',
        'إعادة تصنيف إيداع باقى الدهب من مورد مؤقت إلى رأس مال المالك - النقدية موجودة بالفعل في خزنة تقفيل',
        'capital_partner_transaction_reclass',
        v_tx_id,
        v_created_by,
        jsonb_build_array(
            jsonb_build_object('account_code','2001','debit',35000,'credit',0),
            jsonb_build_object('account_code','3003','debit',0,'credit',35000)
        ),
        timestamptz '2026-08-16 00:00:00+03'
    );
end;
$$;
