-- إضافة "المسؤول عن المتابعة" لتفاعلات العملاء الحاليين — أي مستخدم
-- حقيقي (مندوب أو موظف كول سنتر)، مش بس مندوبين sales_reps، عشان
-- المدير يقدر يوزّع مهام متابعة يومية على أي حد، وتظهر له في تطبيق
-- الموبايل ضمن "مهام اليوم".
ALTER TABLE public.customer_interactions
    ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id);

CREATE INDEX IF NOT EXISTS idx_customer_interactions_assigned
    ON public.customer_interactions(assigned_to) WHERE is_done = false;
