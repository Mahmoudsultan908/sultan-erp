-- ════════════════════════════════════════════════════════════
-- موديول الرواتب — قرار العميل الصريح: المرتبات مربوطة بالمصروفات،
-- مش نظام مالي منفصل. يعني:
--   • employees جدول بيانات أساسية بس (زي sales_reps) — بدون أي
--     trigger مالي، مفيهوش تأثير على الخزنة لوحده.
--   • أي صرف فعلي لموظف (سلفة أو راتب) بيتسجّل كـ INSERT عادي في
--     جدول expenses الموجود بالفعل (نفس مساره المالي، نفس الـ
--     trigger fn_expense_status_change) — بس بعمود employee_id
--     الجديد اللي بيربط المصروف بموظف معيّن، عشان نقدر نحسب
--     "الباقي من الراتب" = base_salary - مجموع مصروفات الموظف
--     في الشهر. صفر منطق مالي جديد، صفر خطر تكرار.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.employees (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text NOT NULL,
    job_title    text,
    phone        text,
    base_salary  numeric NOT NULL DEFAULT 0,
    hire_date    date,
    is_active    boolean NOT NULL DEFAULT true,
    notes        text,
    created_by   uuid,
    created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses
    ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.employees(id);

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_employees" ON public.employees;
CREATE POLICY "auth_all_employees" ON public.employees FOR ALL TO authenticated USING (true) WITH CHECK (true);
