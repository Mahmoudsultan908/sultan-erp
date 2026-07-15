-- ════════════════════════════════════════════════════════════
-- المؤجل الافتراضي على كارت الصنف (بند 10)
-- بيتسحب تلقائي أول ما الصنف يتضاف لفاتورة شراء جديدة (products.js
-- مودال الصنف يحفظه، purchases.js يقرأه عند إضافة الصنف لفاتورة).
-- deferred_rate هنا نفس منطق purchase_items.deferred_rate تماماً —
-- مبلغ فعلي للوحدة، مش نسبة % (راجع purchase_items_deferred_type_
-- migration.sql للتفصيل الكامل). لو النوع 'percent' فالرقم المحفوظ هنا
-- هو النسبة الخام (0-100) والتحويل لمبلغ فعلي بيحصل في purchases.js
-- وقت إضافة الصنف فعلياً للفاتورة (لأن السعر وقتها معروف)، مش هنا.
-- ════════════════════════════════════════════════════════════

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS default_deferred_rate numeric NOT NULL DEFAULT 0;
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS default_deferred_type text NOT NULL DEFAULT 'percent'
    CHECK (default_deferred_type IN ('percent', 'fixed'));
