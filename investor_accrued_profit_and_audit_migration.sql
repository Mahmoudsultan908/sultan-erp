-- ════════════════════════════════════════════════════════════
-- investor_accrued_profit_and_audit_migration.sql
-- إضافة بحتة: عمودين جدد + توسيع CHECK constraint + استبدال دالتين
-- موجودتين (CREATE OR REPLACE بنفس الاسم، نفس نمط migration
-- fn_capital_partner_tx_apply_search_path اللي اتنفذت قبل كده).
-- صفر شهور مقفولة لحد دلوقتي (اتفحص لايف) — فمفيش أي بيانات قديمة
-- محتاجة backfill.
-- ════════════════════════════════════════════════════════════

-- 1) الرصيد التراكمي للأرباح المستحقة وغير المسحوبة (payout_mode='accumulate')
--    منفصل تمامًا عن capital_balance (رأس المال الفعلي/نسبة الملكية)
alter table public.capital_partners
    add column if not exists accrued_profit_balance numeric(14,2) not null default 0;

-- 2) نسخة مجمّدة من تفصيل بنود المصروفات وقت التقفيل (audit trail) —
--    لازم تتحفظ وقت التقفيل لأن excluded_from_investor_split ممكن يتغيّر
--    بعد كده، فتفصيل شهر مقفول لازم يفضل قابل للمراجعة زي ما كان وقتها
alter table public.investor_profit_snapshots_v2
    add column if not exists expense_breakdown jsonb not null default '[]'::jsonb;

-- 3) توسيع tx_type ليشمل صرف أرباح متراكمة (مش رأس مال) —
--    نفس جدول capital_partner_transactions، نفس التريجر، سطر جديد بس
alter table public.capital_partner_transactions
    drop constraint if exists capital_partner_transactions_tx_type_check;
alter table public.capital_partner_transactions
    add constraint capital_partner_transactions_tx_type_check
    check (tx_type in ('contribution','withdrawal','profit_payout'));

-- 4) التريجر: فرع جديد لـ profit_payout بيأثر على accrued_profit_balance
--    بس (مش capital_balance) — عشان صرف أرباح مايقللش نصيب الشريك من
--    الملكية/نسبة رأس المال المستقبلية
create or replace function public.fn_capital_partner_tx_apply()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
    if new.tx_type = 'contribution' then
        update public.capital_partners set capital_balance = capital_balance + new.amount where id = new.partner_id;
    elsif new.tx_type = 'withdrawal' then
        update public.capital_partners set capital_balance = capital_balance - new.amount where id = new.partner_id;
    elsif new.tx_type = 'profit_payout' then
        update public.capital_partners set accrued_profit_balance = accrued_profit_balance - new.amount where id = new.partner_id;
    end if;
    return new;
end;
$$;

-- 5) fn_close_investor_month: باراميتر جديد لتفصيل المصروفات + تحديث
--    accrued_profit_balance لكل شريك accumulate (فوق تحديث cumulative_deficit
--    الموجود بالفعل) في نفس التحديث الذرّي الواحد
create or replace function public.fn_close_investor_month(
    p_period_month date,
    p_monthly_sales numeric,
    p_cogs numeric,
    p_operating_expenses numeric,
    p_net_profit numeric,
    p_is_loss boolean,
    p_effort_amount numeric,
    p_capital_pool_amount numeric,
    p_total_capital_base numeric,
    p_notes text,
    p_created_by uuid,
    p_lines jsonb,
    p_expense_breakdown jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_snapshot_id uuid;
    v_line jsonb;
begin
    if p_lines is null or jsonb_array_length(p_lines) = 0 then
        raise exception 'لا يمكن تقفيل شهر بدون شركاء';
    end if;

    insert into public.investor_profit_snapshots_v2
        (period_month, monthly_sales, cogs, operating_expenses, net_profit, is_loss,
         effort_amount, capital_pool_amount, total_capital_base, notes, created_by, expense_breakdown)
    values
        (p_period_month, p_monthly_sales, p_cogs, p_operating_expenses, p_net_profit, p_is_loss,
         p_effort_amount, p_capital_pool_amount, p_total_capital_base, p_notes, p_created_by,
         coalesce(p_expense_breakdown, '[]'::jsonb))
    returning id into v_snapshot_id;

    for v_line in select * from jsonb_array_elements(p_lines)
    loop
        insert into public.investor_profit_snapshot_lines
            (snapshot_id, partner_id, capital_at_period, days_in_period, capital_ratio,
             gross_share, deficit_before, deficit_applied, net_payable, payout_mode)
        values
            (v_snapshot_id,
             (v_line->>'partner_id')::uuid,
             (v_line->>'capital_at_period')::numeric,
             (v_line->>'days_in_period')::integer,
             (v_line->>'capital_ratio')::numeric,
             (v_line->>'gross_share')::numeric,
             (v_line->>'deficit_before')::numeric,
             (v_line->>'deficit_applied')::numeric,
             (v_line->>'net_payable')::numeric,
             v_line->>'payout_mode');

        update public.capital_partners
        set cumulative_deficit = (v_line->>'new_deficit')::numeric,
            accrued_profit_balance = accrued_profit_balance +
                case when v_line->>'payout_mode' = 'accumulate'
                     then greatest((v_line->>'net_payable')::numeric, 0)
                     else 0 end
        where id = (v_line->>'partner_id')::uuid;
    end loop;

    return v_snapshot_id;
end;
$function$;

-- مفيش anon/authenticated exec زيادة عن كده — نفس نمط باقي RPCs المالية.

-- 6) CREATE OR REPLACE بتوقيع مختلف (باراميتر إضافي) بيعمل overload جديد،
--    مش استبدال — بوستجرس بيعتبرهم دالتين مختلفتين. لازم نمسح النسخة
--    القديمة (11 باراميتر) عشان PostgREST يفضل يلاقي توقيع واحد بس لاسم
--    الـ RPC ده (overloads بتسبب "Could not choose the best candidate function").
drop function if exists public.fn_close_investor_month(
    date, numeric, numeric, numeric, numeric, boolean, numeric, numeric, numeric, text, uuid, jsonb
);
