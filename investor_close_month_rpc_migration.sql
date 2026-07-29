-- ════════════════════════════════════════════════════════════
-- fn_close_investor_month — RPC تقفيل الشهر لموديل رأس مال المستثمرين
-- مسودة (لسه مش متنفذة، اتصال Supabase واقع وقت الكتابة). إضافة بحتة:
-- دالة جديدة بس، مفيش تعديل على أي جدول أو تريجر موجود.
--
-- ليه RPC مش عدة INSERT من الواجهة: تقفيل الشهر بيكتب فى 3 حاجات مع
-- بعض (Header فى investor_profit_snapshots_v2 + سطر لكل شريك فى
-- investor_profit_snapshot_lines + تحديث cumulative_deficit لكل شريك
-- فى capital_partners) — لازم يحصلوا الثلاثة مع بعض ذرّياً، زي أي عملية
-- مالية تانية فى النظام (fn_create_sale, fn_create_sales_return...)،
-- مش 3 نداءات منفصلة من js/modules/investors.js ممكن يفشل نصها.
--
-- period_month عليها unique constraint بالفعل على investor_profit_
-- snapshots_v2 — فتكرار تقفيل نفس الشهر هيفشل بـ unique violation
-- تلقائيًا من غير أي شرط إضافي هنا.
-- ════════════════════════════════════════════════════════════

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
    p_lines jsonb
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
         effort_amount, capital_pool_amount, total_capital_base, notes, created_by)
    values
        (p_period_month, p_monthly_sales, p_cogs, p_operating_expenses, p_net_profit, p_is_loss,
         p_effort_amount, p_capital_pool_amount, p_total_capital_base, p_notes, p_created_by)
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
        set cumulative_deficit = (v_line->>'new_deficit')::numeric
        where id = (v_line->>'partner_id')::uuid;
    end loop;

    return v_snapshot_id;
end;
$function$;

-- مفيش anon/authenticated exec زيادة عن كده — نفس نمط باقي RPCs المالية
-- (fn_create_sale, fn_create_sales_return) اللي بتتنفّذ من الواجهة بعد تسجيل الدخول بس.
