-- ════════════════════════════════════════════════════════════
-- تطويرات CRM: ربط التفاعل بمندوب + إرفاق مستند من الأرشيف
-- ════════════════════════════════════════════════════════════

ALTER TABLE public.customer_interactions
    ADD COLUMN IF NOT EXISTS rep_id uuid REFERENCES public.sales_reps(id);

ALTER TABLE public.customer_interactions
    ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.archive_documents(id);
