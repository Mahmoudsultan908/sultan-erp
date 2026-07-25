-- بند 8+9: هدف مبيعات شهري + خصم غياب + حوافز، مبني فوق نظام payroll.js الموجود.
-- قرار: employees/employee_incentives بيانات أساسية بس (زي payroll.js الأصلي) — بدون trigger مالي.

-- 1) أيام العمل بالشهر لكل موظف (لحساب سعر يوم الغياب) — افتراضي 30
ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_days_per_month integer NOT NULL DEFAULT 30;

-- 2) وقف استخدام بنود المصروفات القديمة باسم الأشخاص (عبد الرحمن/عمى السيد/محمود) في اختيار مصروف جديد
--    بدون لمس البيانات التاريخية المسجلة عليها
ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
UPDATE expense_categories SET is_active = false WHERE name IN ('عبد الرحمن', 'عمى السيد', 'محمود');

-- 3) حوافز/بونص — إدخال يدوي من الأدمن، سطر إيجابي في كشف حساب الموظف
CREATE TABLE IF NOT EXISTS employee_incentives (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    amount numeric NOT NULL CHECK (amount > 0),
    reason text,
    incentive_date date NOT NULL DEFAULT current_date,
    created_by uuid,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employee_incentives ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_all_employee_incentives ON employee_incentives FOR ALL USING (true) WITH CHECK (true);
