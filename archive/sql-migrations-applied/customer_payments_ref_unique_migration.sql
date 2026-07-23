-- منع تكرار المزامنة: لو تطبيق المندوب أعاد إرسال نفس العملية (نفس ref)
-- بسبب مشكلة شبكة، الإدخال التاني يترفض بدل ما ينشئ صف مكرر مؤكد.
-- الفهرس جزئي (status='confirmed' بس) عشان السجلات الملغاة القديمة
-- (اللي فيها ref مكرر من حادثة التكرار اللي اتصلحت يدويًا) تفضل موجودة
-- في الأرشيف من غير ما تمنع تطبيق الفهرس.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_payments_ref_confirmed_unique
    ON public.customer_payments (ref)
    WHERE status = 'confirmed' AND ref IS NOT NULL;
