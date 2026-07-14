-- ════════════════════════════════════════════════════════════
-- full_data_reset.sql
-- ⚠️ تحذير: عملية مسح بيانات كاملة — لا رجعة فيها بعد التنفيذ.
-- شغّله في Supabase SQL Editor بس لو متأكد 100%.
--
-- الأفضلية: صدّر نسخة احتياطية أول من صفحة "🔄 استيراد/تصدير عام"
-- في التطبيق (تبويب "تصدير") لكل جدول مهم قبل ما تشغّل الملف ده،
-- في حالة احتجت ترجع لأي بيانات قديمة.
--
-- بيمسح: كل بيانات الأعمال (فواتير، مرتجعات، مصروفات، قيود، حركة
-- خزينة، سجل تدقيق) + كل البيانات الأساسية (أصناف، عملاء، موردين،
-- مخازن، شجرة حسابات، مندوبين، مستويات أسعار، تصنيفات) + يصفّر كل
-- عدادات أرقام الفواتير/المرتجعات/عروض الأسعار/أوامر الشراء.
--
-- بيحافظ عمداً على (مش بيتمسح): profiles (حسابات الدخول وصلاحياتها)
-- و role_permissions (إعدادات الصلاحيات المتقدمة) — دول إعدادات نظام
-- مش "بيانات تجربة"، ومسحهم ممكن يأثر على تسجيل دخولك إنت نفسك.
-- لو فعلاً عايز تمسحهم كمان، فيه بلوك منفصل ومُعلَّق (commented) في
-- آخر الملف — شيل التعليق عنه يدوياً لو متأكد.
--
-- آمن التنفيذ حتى لو بعض الجداول مش موجودة عندك (بيتخطاها ويكمل).
-- ════════════════════════════════════════════════════════════

DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        -- بنود المستندات (لازم قبل المستندات نفسها منطقياً، لكن CASCADE
        -- بيتكفّل بالترتيب الصحيح فعلياً بغض النظر عن ترتيب المصفوفة)
        'sale_items', 'sale_return_items',
        'purchase_items', 'purchase_order_items', 'purchase_return_items',
        'quotation_items',
        -- المستندات نفسها
        'sales', 'sales_returns',
        'purchases', 'purchase_returns', 'purchase_orders',
        'quotations',
        'customer_payments', 'supplier_payments', 'customer_collections',
        'expenses', 'expense_violations',
        -- المحاسبة والتدقيق
        'journal_entry_lines', 'journal_entries',
        'cash_transactions', 'financial_events',
        'opening_balances',
        -- المخزون
        'inventory_stock',
        -- البيانات الأساسية
        'product_prices', 'products', 'product_categories', 'product_companies',
        'customers', 'customer_regions', 'customer_classifications', 'customer_groups',
        'suppliers',
        'warehouses',
        'accounts',
        'price_levels',
        'sales_reps',
        'expense_categories'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = t) THEN
            EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', t);
            RAISE NOTICE 'تم المسح: %', t;
        ELSE
            RAISE NOTICE 'اتخطّى (مش موجود): %', t;
        END IF;
    END LOOP;
END $$;

-- ── تصفير العدادات بس (رقم الفاتورة/المرتجع/عرض السعر/أمر الشراء) —
--    مع الحفاظ على باقي إعدادات app_settings (اسم/هاتف/عنوان الشركة إلخ) ──
DELETE FROM app_settings WHERE key IN (
    'invoice_counter', 'purchase_counter', 'quotation_counter', 'purchase_order_counter',
    'sales_return_counter', 'purchase_return_counter'
);

-- ════════════════════════════════════════════════════════════
-- اختياري ومُعلَّق عمداً — شغّله يدوياً بس لو متأكد إنك عايز تمسح
-- حسابات الدخول والصلاحيات المتقدمة كمان (نادراً ما يكون ده مقصود):
--
-- TRUNCATE TABLE role_permissions RESTART IDENTITY CASCADE;
-- TRUNCATE TABLE profiles RESTART IDENTITY CASCADE;
-- ★ تنبيه: مسح profiles ميقفلكش برا حساب Supabase Auth نفسه (لسه
-- تقدر تسجّل دخول)، بس هتفقد اسمك/دورك المسجّل — والكود بيتعامل مع
-- غياب الـ profile كـ "مدير افتراضياً" (فشل آمن)، فمش هيقفلك برا.
-- ════════════════════════════════════════════════════════════
