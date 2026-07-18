-- ════════════════════════════════════════════════════════════
-- موديول تقييم الموظفين — تقييم دوري على 5 معايير ثابتة (1-10).
-- بيانات وصفية بحتة، بدون أي تريجر مالي أو تأثير على expenses/الخزنة.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.employee_evaluations (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id        uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    evaluation_date    date NOT NULL DEFAULT CURRENT_DATE,
    attendance_score   numeric NOT NULL CHECK (attendance_score BETWEEN 1 AND 10),
    quality_score      numeric NOT NULL CHECK (quality_score BETWEEN 1 AND 10),
    teamwork_score     numeric NOT NULL CHECK (teamwork_score BETWEEN 1 AND 10),
    initiative_score   numeric NOT NULL CHECK (initiative_score BETWEEN 1 AND 10),
    compliance_score   numeric NOT NULL CHECK (compliance_score BETWEEN 1 AND 10),
    notes              text,
    created_by         uuid,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_evaluations_employee ON public.employee_evaluations(employee_id);

ALTER TABLE public.employee_evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_employee_evaluations" ON public.employee_evaluations;
CREATE POLICY "auth_all_employee_evaluations" ON public.employee_evaluations FOR ALL TO authenticated USING (true) WITH CHECK (true);
