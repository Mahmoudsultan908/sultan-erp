-- ════════════════════════════════════════════════════════════
-- products_supplier_migration.sql
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor
-- آمن للتشغيل أكثر من مرة (كل أمر بيتحقق قبل ما يعمل حاجة)
--
-- الغرض: إضافة عمود supplier_id لجدول products، عشان يتحفظ فيه
-- المورّد الافتراضي لكل صنف (يتم اختياره من فورم إضافة/تعديل الصنف
-- في js/modules/products.js). الاسم supplier_id مهم يفضل زي ما هو
-- بالظبط لأن js/modules/purchases.js (شغل فريق تاني بالتوازي) هيقرأ
-- نفس العمود ده عشان يسحب المورد تلقائياً في فاتورة المشتريات.
-- ════════════════════════════════════════════════════════════

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES suppliers(id);

-- فهرس بسيط يفيد أي استعلام مستقبلي بيفلتر/يجمّع أصناف حسب المورد
-- (مثلاً في purchases.js لاقتراح أصناف المورد المختار)
CREATE INDEX IF NOT EXISTS idx_products_supplier_id ON products(supplier_id);
