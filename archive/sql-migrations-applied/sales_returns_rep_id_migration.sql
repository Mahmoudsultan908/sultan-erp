-- ════════════════════════════════════════════════════════════
-- sales_returns_rep_id_migration.sql
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor — بعد ما
-- returns_migration.sql (جدول sales_returns) و sales_reps_migration.sql
-- (جدول sales_reps) يكونوا موجودين فعلاً.
-- آمن للتشغيل أكثر من مرة (idempotent).
--
-- السبب: مرتجع فاتورة مبيعات مرتبطة بمندوب لازم يتخصم من إجمالي
-- مبيعات نفس المندوب (وإلا العمولة المحسوبة في تقرير الأداء —
-- performance-reports.js → "مبيعات حسب المندوب" — بتفضل أعلى من
-- الحقيقي بعد أي مرتجع). العمود ده مطلوب عشان JS في returns.js
-- يقدر يبعت rep_id عند حفظ مرتجع مبيعات (retSave)، وperformance-
-- reports.js يقدر يجمّع مرتجعات كل مندوب ويخصمها من إجمالي مبيعاته.
-- ════════════════════════════════════════════════════════════

-- ── 1) عمود rep_id على sales_returns (مرتبط بـ sales_reps، زي sales.rep_id بالظبط) ──
ALTER TABLE sales_returns ADD COLUMN IF NOT EXISTS rep_id uuid REFERENCES sales_reps(id);

-- ── 2) تعبئة تلقائية لمرتجعات قديمة مرتبطة بفاتورة أصلية (sale_id) —
--    نجيب rep_id من فاتورة البيع الأصلية لو المرتجع كان "مرتبط بفاتورة"
--    ولسه من غير مندوب (مرتجعات "مستقلة" هتفضل من غير مندوب، عادي، لحد
--    ما يتحدد يدوياً وقت التعديل لو احتاج الأمر).
UPDATE sales_returns sr
SET rep_id = s.rep_id
FROM sales s
WHERE sr.sale_id = s.id
  AND sr.rep_id IS NULL
  AND s.rep_id IS NOT NULL;

-- ── 3) فهرس بسيط لتسريع تجميع تقرير الأداء حسب المندوب ──
CREATE INDEX IF NOT EXISTS idx_sales_returns_rep_id ON sales_returns(rep_id);

-- ملاحظة: زي sales_rep_fk_fix_migration.sql بالظبط — لو ظهر خطأ foreign
-- key violation (23503) عند تشغيل الخطوة 2، يبقى فيه rep_id قديم في
-- جدول sales نفسه بيشاور على صف محذوف من sales_reps؛ راجع الملف ده
-- (موجود في archive/sql-migrations-applied/) قبل ما تكمّل.
