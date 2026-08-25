-- ربط حركات رأس المال بالخزنة والقيد المحاسبي — تنفيذ ذري
-- لا يعالج الحركة التاريخية 35,000 تلقائيًا؛ تحتاج تحديد خزنة المصدر أولًا.

alter table public.capital_partner_transactions
    add column if not exists treasury_id uuid references public.treasuries(id);

create index if not exists idx_capital_partner_tx_treasury
    on public.capital_partner_transactions(treasury_id);

create or replace function public.fn_post_capital_partner_transaction(
    p_partner_id uuid,
    p_tx_date date,
    p_tx_type text,
    p_amount numeric,
    p_treasury_id uuid,
    p_note text default null,
    p_created_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tx_id uuid;
    v_partner record;
    v_capital_account text;
    v_description text;
    v_journal_lines jsonb;
begin
    if (select auth.uid()) is null then
        raise exception 'يجب تسجيل الدخول لتسجيل حركة رأس المال';
    end if;
    if p_created_by is not null and p_created_by <> (select auth.uid()) then
        raise exception 'المستخدم المنفذ غير مطابق للجلسة الحالية';
    end if;
    if p_partner_id is null or p_tx_date is null then
        raise exception 'بيانات حركة رأس المال غير مكتملة';
    end if;
    if p_tx_type not in ('contribution', 'withdrawal', 'profit_payout') then
        raise exception 'نوع حركة رأس المال غير صحيح';
    end if;
    if p_amount is null or p_amount <= 0 then
        raise exception 'مبلغ حركة رأس المال يجب أن يكون أكبر من صفر';
    end if;
    if p_treasury_id is null then
        raise exception 'يجب اختيار خزنة للحركة';
    end if;
    if not exists (
        select 1 from public.treasuries
        where id = p_treasury_id and is_active = true
    ) then
        raise exception 'الخزنة المختارة غير موجودة أو غير مفعّلة';
    end if;

    select * into v_partner
    from public.capital_partners
    where id = p_partner_id
    for update;

    if not found then
        raise exception 'الشريك غير موجود';
    end if;
    if v_partner.status <> 'active' then
        raise exception 'لا يمكن تسجيل حركة لشريك غير نشط';
    end if;
    if p_tx_type = 'withdrawal' and p_amount > coalesce(v_partner.capital_balance, 0) then
        raise exception 'مبلغ السحب أكبر من رأس مال الشريك الحالي';
    end if;
    if p_tx_type = 'profit_payout' and p_amount > coalesce(v_partner.accrued_profit_balance, 0) then
        raise exception 'مبلغ صرف الأرباح أكبر من الأرباح المتراكمة المستحقة';
    end if;

    -- الـ trigger الحالي يحدّث رصيد رأس المال/الأرباح بعد الإدراج.
    insert into public.capital_partner_transactions
        (partner_id, tx_date, tx_type, amount, note, created_by, treasury_id)
    values
        (p_partner_id, p_tx_date, p_tx_type, p_amount, p_note, (select auth.uid()), p_treasury_id)
    returning id into v_tx_id;

    if p_tx_type = 'contribution' then
        v_capital_account := case when v_partner.partner_type = 'owner' then '3003' else '3004' end;
        v_description := 'إيداع رأس مال - ' || v_partner.name;
        v_journal_lines := jsonb_build_array(
            jsonb_build_object('account_code','1001','debit',p_amount,'credit',0),
            jsonb_build_object('account_code',v_capital_account,'debit',0,'credit',p_amount)
        );
        perform public.post_cash(
            'in', p_amount, v_description, 'capital_partner_transaction',
            v_tx_id, (select auth.uid()), p_treasury_id, p_tx_date::timestamptz
        );
    elsif p_tx_type = 'withdrawal' then
        v_capital_account := case when v_partner.partner_type = 'owner' then '3003' else '3004' end;
        v_description := 'سحب رأس مال - ' || v_partner.name;
        v_journal_lines := jsonb_build_array(
            jsonb_build_object('account_code',v_capital_account,'debit',p_amount,'credit',0),
            jsonb_build_object('account_code','1001','debit',0,'credit',p_amount)
        );
        perform public.post_cash(
            'out', p_amount, v_description, 'capital_partner_transaction',
            v_tx_id, (select auth.uid()), p_treasury_id, p_tx_date::timestamptz
        );
    else
        -- الأرباح المؤجلة الحالية مثبتة على حساب الالتزامات 2002.
        v_description := 'صرف أرباح مستحقة - ' || v_partner.name;
        v_journal_lines := jsonb_build_array(
            jsonb_build_object('account_code','2002','debit',p_amount,'credit',0),
            jsonb_build_object('account_code','1001','debit',0,'credit',p_amount)
        );
        perform public.post_cash(
            'out', p_amount, v_description, 'capital_partner_transaction',
            v_tx_id, (select auth.uid()), p_treasury_id, p_tx_date::timestamptz
        );
    end if;

    perform public.post_journal(
        'CAPITAL-TX-' || left(v_tx_id::text, 8),
        v_description,
        'capital_partner_transaction',
        v_tx_id,
        (select auth.uid()),
        v_journal_lines,
        p_tx_date::timestamptz
    );

    return v_tx_id;
end;
$$;

revoke execute on function public.fn_post_capital_partner_transaction(uuid, date, text, numeric, uuid, text, uuid) from public;
grant execute on function public.fn_post_capital_partner_transaction(uuid, date, text, numeric, uuid, text, uuid) to authenticated;

-- الحركات غير قابلة للإدراج المباشر؛ الإدراج يمر بالعملية الذرية أعلاه.
drop policy if exists "auth_all_capital_partner_tx" on public.capital_partner_transactions;
drop policy if exists "auth_read_capital_partner_tx" on public.capital_partner_transactions;
create policy "auth_read_capital_partner_tx"
    on public.capital_partner_transactions for select to authenticated using (true);
