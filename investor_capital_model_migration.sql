-- ════════════════════════════════════════════════════════════
-- موديل رأس مال المستثمرين المتعدد — investor_capital_model_migration.sql
-- مسودة (لسه مش متنفذة). إضافة بحتة فقط — مفيش أي تعديل أو حذف
-- على جدول موجود، ومفيش أي نقل فعلي لأي رصيد حالي (الـ50,000 ج.م
-- المسجلة غلط تحت الموردين، وربط رأس مال المستثمرين الفعلي،
-- وتقفيل يوليو) — دي بتتنفذ في migration منفصل أول الشهر الجديد.
--
-- القواعد اللي المستثمر ده بيمثلها (اتفق عليها 2026-07-28):
--  - صاحب المحل + المستثمرين في وعاء واحد (capital_partners)،
--    كل واحد نصيبه من "جزء رأس المال" = رصيده / إجمالي الوعاء.
--  - effort_ratio بتاعة صاحب المحل بتتاخد كاملة من فوق قبل التقسيم.
--  - خسارة الشهر بترحّل كعجز (cumulative_deficit) وتتخصم من أرباح
--    شهور جاية، مش من رأس المال مباشرة.
--  - كل شريك له payout_mode خاص بيه (cash / accumulate).
--  - مصروفات شخصية (زي عربية صاحب المحل) بتتستبعد بعلامة على
--    expense_categories، ومابتأثرش على عملية القسمة.
-- ════════════════════════════════════════════════════════════

-- 1. حسابات حقوق الملكية الجديدة ------------------------------------------
-- ملحوظة: الأكواد 3003/3004 افتراض امتداد لتسلسل 3001/3002 الموجودين حاليًا
-- (الأرصدة الافتتاحية، أرباح وخسائر مرحّلة) — يتراجع قبل التنفيذ لو الكود مستخدم.
insert into public.accounts (code, name, type, parent_id)
values
    ('3003', 'رأس مال المالك', 'equity', null),
    ('3004', 'رأس مال المستثمرين', 'equity', null)
on conflict (code) do nothing;

-- 2. شركاء رأس المال (صاحب المحل + المستثمرين في جدول واحد) ----------------
create table if not exists public.capital_partners (
    id                 uuid primary key default gen_random_uuid(),
    partner_type       text not null check (partner_type in ('owner','investor')),
    name               text not null,
    phone              text,
    join_date          date not null,
    capital_balance    numeric(14,2) not null default 0,
    cumulative_deficit numeric(14,2) not null default 0,
    effort_ratio       numeric(5,4),  -- معنى بس لصاحب المحل (partner_type='owner')
    monthly_salary     numeric(14,2), -- لو اتقرر مرتب ثابت لاحقًا؛ فاضي دلوقتي عمدًا
    payout_mode        text not null default 'accumulate' check (payout_mode in ('cash','accumulate')),
    status             text not null default 'active' check (status in ('active','exited')),
    notes              text,
    created_at         timestamptz not null default now(),
    created_by         uuid references public.profiles(id)
);

-- شريك واحد بس من نوع owner
create unique index if not exists capital_partners_single_owner
    on public.capital_partners (partner_type) where partner_type = 'owner';

-- 3. دفتر حركة رأس المال (إيداعات/سحوبات فقط — مش أرباح، الأرباح في جدول التقفيل) --
create table if not exists public.capital_partner_transactions (
    id         uuid primary key default gen_random_uuid(),
    partner_id uuid not null references public.capital_partners(id),
    tx_date    date not null,
    tx_type    text not null check (tx_type in ('contribution','withdrawal')),
    amount     numeric(14,2) not null check (amount > 0),
    note       text,
    created_at timestamptz not null default now(),
    created_by uuid references public.profiles(id)
);

create index if not exists idx_capital_partner_tx_partner on public.capital_partner_transactions(partner_id);

-- الرصيد بيتحدث عن طريق تريجر مش JS، زي باقي أرصدة النظام (عملاء/موردين/مخزون)
create or replace function public.fn_capital_partner_tx_apply()
returns trigger
language plpgsql
security definer
as $$
begin
    if new.tx_type = 'contribution' then
        update public.capital_partners set capital_balance = capital_balance + new.amount where id = new.partner_id;
    elsif new.tx_type = 'withdrawal' then
        update public.capital_partners set capital_balance = capital_balance - new.amount where id = new.partner_id;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_capital_partner_tx_apply on public.capital_partner_transactions;
create trigger trg_capital_partner_tx_apply
    after insert on public.capital_partner_transactions
    for each row execute function public.fn_capital_partner_tx_apply();

-- 4. علامة استبعاد المصروفات الشخصية من حساب المستثمرين --------------------
alter table public.expense_categories
    add column if not exists excluded_from_investor_split boolean not null default false;

-- 5. تقفيل شهري متعدد الأطراف (بديل investor_profit_snapshots القديم) -------
create table if not exists public.investor_profit_snapshots_v2 (
    id                   uuid primary key default gen_random_uuid(),
    period_month         date not null unique,
    monthly_sales        numeric(14,2) not null,
    cogs                 numeric(14,2) not null,
    operating_expenses   numeric(14,2) not null, -- مستبعد منه بنود excluded_from_investor_split
    net_profit           numeric(14,2) not null,
    is_loss              boolean not null,
    effort_amount        numeric(14,2) not null,
    capital_pool_amount  numeric(14,2) not null,
    total_capital_base   numeric(14,2) not null,
    notes                text,
    created_at           timestamptz not null default now(),
    created_by           uuid references public.profiles(id)
);

create table if not exists public.investor_profit_snapshot_lines (
    id              uuid primary key default gen_random_uuid(),
    snapshot_id     uuid not null references public.investor_profit_snapshots_v2(id) on delete cascade,
    partner_id      uuid not null references public.capital_partners(id),
    capital_at_period numeric(14,2) not null,
    days_in_period    integer not null,
    capital_ratio     numeric(9,6) not null,
    gross_share       numeric(14,2) not null,
    deficit_before    numeric(14,2) not null default 0,
    deficit_applied   numeric(14,2) not null default 0,
    net_payable       numeric(14,2) not null,
    payout_mode       text not null
);

-- 6. RLS — نفس نمط الصلاحيات المستخدم في migrations زي crm_leads
-- (authenticated USING(true))، مع التقييد لأدمن بس بيتم على مستوى الواجهة
-- حاليًا زي investors.js الأصلي. تم التحقق: role_permissions فعليًا بس
-- (role, page_key) — مفيش تحكم أدق على مستوى الجدول في القاعدة، فالتقييد
-- على مستوى الواجهة (زي كل موديول تاني) هو النمط الصحيح فعلاً، مش placeholder.
alter table public.capital_partners enable row level security;
alter table public.capital_partner_transactions enable row level security;
alter table public.investor_profit_snapshots_v2 enable row level security;
alter table public.investor_profit_snapshot_lines enable row level security;

drop policy if exists "auth_all_capital_partners" on public.capital_partners;
create policy "auth_all_capital_partners" on public.capital_partners for all to authenticated using (true) with check (true);

drop policy if exists "auth_all_capital_partner_tx" on public.capital_partner_transactions;
create policy "auth_all_capital_partner_tx" on public.capital_partner_transactions for all to authenticated using (true) with check (true);

drop policy if exists "auth_all_investor_snapshots_v2" on public.investor_profit_snapshots_v2;
create policy "auth_all_investor_snapshots_v2" on public.investor_profit_snapshots_v2 for all to authenticated using (true) with check (true);

drop policy if exists "auth_all_investor_snapshot_lines" on public.investor_profit_snapshot_lines;
create policy "auth_all_investor_snapshot_lines" on public.investor_profit_snapshot_lines for all to authenticated using (true) with check (true);
