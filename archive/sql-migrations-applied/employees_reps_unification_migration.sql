-- توحيد الموظفين والمناديب في شاشة واحدة: حضور + مرتب + عمولة + هدف بحساب تلقائي.
-- قرار: sales_reps.id هو نفسه profiles.id (auth uid) — الجدول ده مينفعش يتلغي
-- أو يندمج مع employees من غير ما يكسر تسجيل دخول تطبيق سلطانو الحي والـ RLS.
-- الحل: نضيف لـ sales_reps نفس أعمدة المرتب/الدوام الموجودة في employees،
-- ونضيف rep_id (nullable) على الجداول اللي كانت مربوطة بـ employees بس،
-- عشان نفس منطق الحضور/الغياب/الحوافز/الصرف يشتغل على الاتنين. صفر حذف،
-- صفر تعديل على بيانات موجودة، كل الأعمدة الجديدة nullable أو بـ default آمن.

-- 1) أعمدة المرتب والدوام على sales_reps — مطابقة لـ employees بالظبط
ALTER TABLE public.sales_reps
    ADD COLUMN IF NOT EXISTS base_salary numeric NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS hire_date date,
    ADD COLUMN IF NOT EXISTS work_days_per_month integer NOT NULL DEFAULT 30,
    ADD COLUMN IF NOT EXISTS shift_start_time time,
    ADD COLUMN IF NOT EXISTS grace_minutes integer;

-- 2) attendance_records: مندوب أو موظف، مش الاتنين مع بعض
ALTER TABLE public.attendance_records
    ADD COLUMN IF NOT EXISTS rep_id uuid REFERENCES public.sales_reps(id);

ALTER TABLE public.attendance_records
    ALTER COLUMN employee_id DROP NOT NULL;

ALTER TABLE public.attendance_records
    DROP CONSTRAINT IF EXISTS attendance_records_person_chk;
ALTER TABLE public.attendance_records
    ADD CONSTRAINT attendance_records_person_chk
    CHECK ((employee_id IS NOT NULL) <> (rep_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_attendance_records_rep_id ON public.attendance_records(rep_id);

-- 3) employee_incentives: نفس الفكرة
ALTER TABLE public.employee_incentives
    ADD COLUMN IF NOT EXISTS rep_id uuid REFERENCES public.sales_reps(id);

ALTER TABLE public.employee_incentives
    ALTER COLUMN employee_id DROP NOT NULL;

ALTER TABLE public.employee_incentives
    DROP CONSTRAINT IF EXISTS employee_incentives_person_chk;
ALTER TABLE public.employee_incentives
    ADD CONSTRAINT employee_incentives_person_chk
    CHECK ((employee_id IS NOT NULL) <> (rep_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_employee_incentives_rep_id ON public.employee_incentives(rep_id);

-- 4) expenses: صرف مرتب/سلفة لمندوب — مختلف عن expenses.created_by
--    الموجود أصلاً (مصروفات المندوب الميدانية من تطبيقه هو نفسه)
ALTER TABLE public.expenses
    ADD COLUMN IF NOT EXISTS rep_id uuid REFERENCES public.sales_reps(id);

CREATE INDEX IF NOT EXISTS idx_expenses_rep_id ON public.expenses(rep_id);
-- ملحوظة: مفيش CHECK هنا زي الجداول اللي فوق — expenses.employee_id/rep_id
-- الاتنين ممكن يفضلوا NULL (مصروف عادي مالوش علاقة بموظف ولا مندوب خالص).
