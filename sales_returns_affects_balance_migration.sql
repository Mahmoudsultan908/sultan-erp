-- ════════════════════════════════════════════════════════════
-- إضافة خيار "خصم من رصيد العميل؟" لمرتجع المبيعات
-- بعض مرتجعات المبيعات (مثلاً بضاعة راجعة للمخزون بس من غير أي تسوية
-- على حساب العميل) المفروض ما تأثرش على customers.balance خالص، على
-- عكس المرتجع العادي (بيع آجل) اللي بينقص رصيد العميل تلقائياً.
--
-- ⚠️ الدالة دي CREATE OR REPLACE لدالة موجودة بالفعل من
-- archive/sql-migrations-applied/returns_migration.sql (fn_sales_return_balance) —
-- الجسم الجديد مطابق للأصلي بالحرف + شرط إضافي واحد بس
-- (COALESCE(NEW.affects_customer_balance, true)). راجعها قبل التشغيل.
-- ════════════════════════════════════════════════════════════

ALTER TABLE sales_returns
    ADD COLUMN IF NOT EXISTS affects_customer_balance boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION fn_sales_return_balance() RETURNS trigger
SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NEW.status = 'confirmed' AND NEW.customer_id IS NOT NULL AND NEW.payment_type = 'credit'
       AND COALESCE(NEW.affects_customer_balance, true) = true THEN
        UPDATE customers SET balance = balance - NEW.total WHERE id = NEW.customer_id;
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- الـ trigger نفسه (trg_sales_return_balance) مش محتاج تغيير — لسه AFTER INSERT
-- بينادي نفس الدالة، وده بيغطي أي مرتجع مسجّل بعد تشغيل الملف ده. المرتجعات
-- القديمة (قبل تشغيل الملف) هتاخد القيمة الافتراضية true تلقائياً (زي ما كانت
-- بتتحاسب قبل كده بالظبط، من غير أي تغيير في سلوكها).
