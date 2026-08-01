-- ════════════════════════════════════════════════════════════
-- accrued_liabilities_migration.sql
-- التزامات مؤجلة — مصروفات مسجّلة محاسبيًا (قيد يومية) بس لسه ما
-- اتصرفتش فعليًا من الخزنة (زي مرتب مؤجل أو إيجار مؤجل). لما تتصرف
-- فعليًا، بتتسدد من شاشة المصروفات (تبويب "التزامات مؤجلة") — حركة
-- خزنة بس، من غير ما يتحسب مصروف جديد (عشان متتكررش وقت الدفع الفعلي).
-- ════════════════════════════════════════════════════════════

create table if not exists public.accrued_liabilities_manual (
    id uuid primary key default gen_random_uuid(),
    description text not null,
    account_code text not null default '2002',
    amount numeric(14,2) not null,
    paid_amount numeric(14,2) not null default 0,
    due_date date,
    notes text,
    status text not null default 'pending' check (status in ('pending','settled')),
    created_at timestamptz not null default now(),
    created_by uuid references public.profiles(id)
);
alter table public.accrued_liabilities_manual enable row level security;
drop policy if exists "auth_all_accrued_liabilities_manual" on public.accrued_liabilities_manual;
create policy "auth_all_accrued_liabilities_manual" on public.accrued_liabilities_manual for all to authenticated using (true) with check (true);

-- تسديد التزام مؤجل: حركة خزنة (post_cash) + قيد يومية (Dr الالتزام / Cr الخزينة)
-- بس، من غير ما يلمس أي حساب مصروف — المصروف نفسه اتسجل خالص وقت إثبات
-- الالتزام، مش وقت السداد.
create or replace function public.fn_settle_accrued_liability(
    p_id uuid,
    p_amount numeric,
    p_treasury_id uuid,
    p_created_by uuid
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
    v_row public.accrued_liabilities_manual%rowtype;
    v_remaining numeric;
    v_account_code text;
begin
    select * into v_row from public.accrued_liabilities_manual where id = p_id for update;
    if v_row.id is null then
        raise exception 'الالتزام غير موجود';
    end if;
    v_remaining := v_row.amount - v_row.paid_amount;
    if p_amount is null or p_amount <= 0 then
        raise exception 'أدخل مبلغاً صحيحاً';
    end if;
    if p_amount > v_remaining + 0.01 then
        raise exception 'المبلغ أكبر من المتبقي (%)', v_remaining;
    end if;

    v_account_code := coalesce(v_row.account_code, '2002');

    perform public.post_cash('out', p_amount, 'تسديد التزام مؤجل: ' || v_row.description, 'accrued_liability', v_row.id, p_created_by, p_treasury_id);
    perform public.post_journal('SETTLE-ACCR-' || v_row.id, 'تسديد التزام مؤجل: ' || v_row.description, 'accrued_liability', v_row.id, p_created_by,
        jsonb_build_array(
            jsonb_build_object('account_code', v_account_code, 'debit', p_amount, 'credit', 0),
            jsonb_build_object('account_code', '1001', 'debit', 0, 'credit', p_amount)
        ));

    update public.accrued_liabilities_manual
    set paid_amount = paid_amount + p_amount,
        status = case when paid_amount + p_amount >= amount - 0.01 then 'settled' else 'pending' end
    where id = p_id;
end;
$function$;
