-- ════════════════════════════════════════════════════════════
-- قمع مبيعات العملاء المحتملين (Leads) — CRM
-- بيانات وصفية بحتة، بدون أي تريجر مالي. لما الـ Lead يتحول لعميل
-- حقيقي، بينشئ صف في customers ويتربط بيه عبر converted_customer_id،
-- وبعدها المتابعة بتكمل في customer_interactions العادي.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.crm_leads (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                   text NOT NULL,
    shop                   text,
    phone                  text NOT NULL,
    area                   text,
    activity_type          text,
    source                 text,
    status                 text NOT NULL DEFAULT 'جديد'
                           CHECK (status IN ('جديد','تم التواصل','مهتم','طلب أسعار','اشترى','خسرناه')),
    notes                  text,
    assigned_to            uuid REFERENCES public.profiles(id),
    last_contact_date      date,
    next_follow_up_date    date,
    last_order_amount      numeric DEFAULT 0,
    converted_customer_id  uuid REFERENCES public.customers(id),
    created_by             uuid REFERENCES public.profiles(id),
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_leads_status ON public.crm_leads(status);
CREATE INDEX IF NOT EXISTS idx_crm_leads_phone ON public.crm_leads(phone);
CREATE INDEX IF NOT EXISTS idx_crm_leads_assigned ON public.crm_leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_leads_followup ON public.crm_leads(next_follow_up_date) WHERE converted_customer_id IS NULL AND status != 'خسرناه';

ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_crm_leads" ON public.crm_leads;
CREATE POLICY "auth_all_crm_leads" ON public.crm_leads FOR ALL TO authenticated USING (true) WITH CHECK (true);
