-- ════════════════════════════════════════════════════════════
-- sales_rep_fk_fix_migration.sql
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor — بعد
-- sales_reps_migration.sql (لازم جدول sales_reps يكون موجود فعلاً).
-- آمن للتشغيل أكثر من مرة (idempotent).
--
-- السبب: عمود sales.rep_id كان موجوداً من قبل ميزة المندوبين، وكان
-- عليه قيد foreign key قديم باسم sales_rep_id_fkey بيشاور غلط على
-- جدول profiles (المستخدمين) بدل sales_reps. النتيجة: أي id مندوب
-- حقيقي من sales_reps كان بيرفضه القيد برسالة foreign key violation
-- (23503) حتى لو الـ id سليم 100%، لأن القيد أصلاً بيدوّر في الجدول
-- الغلط. اتأكدنا من السبب ده من تفاصيل الخطأ الكاملة من Postgres:
--   code: 23503, message: violates foreign key constraint
--   "sales_rep_id_fkey", details: Key is not present in table "profiles"
-- ════════════════════════════════════════════════════════════

-- ── 1) تنظيف دفاعي: أي rep_id حالي مش موجود فعلاً كصف في sales_reps
--    (لو فيه أي بيانات اختبار اتسجّلت وهي شايفة على القيد القديم)
--    يترجع NULL، عشان إضافة القيد الجديد ما تفشلش في خطوة التحقق
--    من البيانات الموجودة أصلاً.
UPDATE sales SET rep_id = NULL
WHERE rep_id IS NOT NULL AND rep_id NOT IN (SELECT id FROM sales_reps);

-- ── 2) شيل القيد القديم الغلط، وأضف القيد الصح المشاور على sales_reps ──
ALTER TABLE sales DROP CONSTRAINT IF EXISTS sales_rep_id_fkey;
ALTER TABLE sales ADD CONSTRAINT sales_rep_id_fkey
    FOREIGN KEY (rep_id) REFERENCES sales_reps(id);

-- ════════════════════════════════════════════════════════════
-- 3) تشخيصي فقط (SELECT — مفيش أي تعديل) — يسرد كل أعمدة foreign key
-- في السكيمة public اللي بتشاور على profiles، عشان تتأكد بعينك مفيش
-- عمود تاني (زي purchases أو أي جدول تاني له عمود مشابه لـ rep_id)
-- واقع في نفس المشكلة. شغّل الاستعلام ده لوحده وشوف النتيجة:
-- الأعمدة المتوقعة (طبيعية وصح إنها تشاور على profiles): created_by
-- في أي جدول (sales/purchases/expenses/...)، وid في profiles نفسها.
-- أي عمود تاني غريب (خصوصاً لو اسمه فيه "rep" أو مرتبط بمندوب/مستخدم
-- في جدول عمليات) يستاهل مراجعة يدوية زي اللي عملناها هنا بالظبط.
-- ════════════════════════════════════════════════════════════
SELECT
    tc.table_name        AS "الجدول",
    kcu.column_name       AS "العمود",
    tc.constraint_name    AS "اسم القيد"
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND ccu.table_name = 'profiles'
ORDER BY tc.table_name, kcu.column_name;
