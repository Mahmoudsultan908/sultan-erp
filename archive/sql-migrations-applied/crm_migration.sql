-- ════════════════════════════════════════════════════════════
-- موديول CRM — متابعة تفاعلات العملاء (مكالمات، زيارات، شكاوى)
-- + تذكيرات متابعة دورية. بيانات وصفية بحتة، بدون أي تريجر مالي.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.customer_interactions (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id        uuid NOT NULL REFERENCES public.customers(id),
    type               text NOT NULL DEFAULT 'call' CHECK (type IN ('call','visit','complaint','note')),
    notes              text,
    interaction_date   date NOT NULL DEFAULT CURRENT_DATE,
    next_follow_up_date date,
    is_done            boolean NOT NULL DEFAULT false,
    created_by         uuid,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_interactions_customer ON public.customer_interactions(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_interactions_followup ON public.customer_interactions(next_follow_up_date) WHERE is_done = false;

ALTER TABLE public.customer_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_customer_interactions" ON public.customer_interactions;
CREATE POLICY "auth_all_customer_interactions" ON public.customer_interactions FOR ALL TO authenticated USING (true) WITH CHECK (true);
