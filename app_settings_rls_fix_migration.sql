-- ════════════════════════════════════════════════════════════
-- app_settings_rls_fix_migration.sql
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor.
-- آمن للتشغيل أكثر من مرة (idempotent).
--
-- السبب: retSave() في returns.js بيعمل INSERT في sales_returns
-- (بينجح) ثم INSERT في sale_return_items (بينجح) ثم UPSERT في
-- app_settings لزيادة عداد رقم المرتجع — الخطوة الأخيرة دي كانت
-- بترجع 403 Forbidden (سياسة RLS على app_settings مش سامحة بالكتابة
-- لمفاتيح جديدة زي sales_return_counter/purchase_return_counter، رغم
-- إنها سامحة بتحديث invoice_counter الموجود من الأول). المكالمة دي
-- في الكود مش بتتحقق من الخطأ (نفس نمط استدعاء invoice_counter في
-- sales.js أصلاً)، فالمرتجع الأول اتسجّل بنجاح فعلياً في قاعدة
-- البيانات، بس العداد فضل عالق على نفس الرقم (مثلاً RS-0001) — فأي
-- محاولة حفظ تانية بعد كده كانت بتعيد نفس الرقم وتترفض بـ 409
-- (unique violation) على return_no المكرر.
-- ════════════════════════════════════════════════════════════

-- ── 1) سياسة صلاحيات دائمة على app_settings (نفس نمط باقي جداولنا) ──
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_app_settings" ON app_settings;
CREATE POLICY "auth_all_app_settings" ON app_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 2) تصحيح ذاتي للعدادين: نحسب القيمة الصح من البيانات الفعلية
--    الموجودة فعلاً في الجداول (أعلى رقم مُستخدم + 1)، مش قيمة ثابتة —
--    عشان لو فيه مرتجع (أو أكتر) اتسجّل بنجاح فعلاً قبل ما تشغّل
--    الملف ده، العداد يتظبط على الرقم الصح ومايكررش نفس return_no.
--    ★ عمود value من نوع jsonb مش text (زي ما ظهر من رسالة الخطأ) —
--    to_jsonb(...::text) بيحوّل الرقم لسترينج JSON ("5" مثلاً)، بنفس
--    الصيغة اللي بيكتبها الكود نفسه (upsert({value: String(x)})) وبيقرأها
--    برضه (JSON.parse(r.value) في thermal-print.js). ──
INSERT INTO app_settings (key, value)
VALUES (
    'sales_return_counter',
    to_jsonb((COALESCE((SELECT MAX((regexp_match(return_no, '\d+'))[1]::int) FROM sales_returns), 0) + 1)::text)
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO app_settings (key, value)
VALUES (
    'purchase_return_counter',
    to_jsonb((COALESCE((SELECT MAX((regexp_match(return_no, '\d+'))[1]::int) FROM purchase_returns), 0) + 1)::text)
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
