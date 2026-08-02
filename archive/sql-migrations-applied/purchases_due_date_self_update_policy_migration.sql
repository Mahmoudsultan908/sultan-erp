-- ════════════════════════════════════════════════════════════
-- نفس فكرة sales_due_date_self_update_policy_migration.sql بالظبط،
-- مرآة على المشتريات — يسمح لأي مستخدم متصل يحدّث due_date بس على
-- فاتورة شراء، وباقي الأعمدة يفضل مقفول على أدمن/محاسب
-- (purchases_update_status). fn_block_amount_edit_after_confirm
-- دالة مشتركة مع sales وكانت اتعدّلت بالفعل لتستثني due_date، فمحتاجتش
-- تعديل تاني هنا.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_guard_purchases_limited_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','accountant')) THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'due_date') IS DISTINCT FROM (to_jsonb(OLD) - 'due_date') THEN
    RAISE EXCEPTION 'غير مسموح تعديل أي بيانات في فاتورة الشراء غير تاريخ الاستحقاق';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_purchases_limited_self_update ON purchases;
CREATE TRIGGER trg_guard_purchases_limited_self_update
BEFORE UPDATE ON purchases
FOR EACH ROW EXECUTE FUNCTION fn_guard_purchases_limited_self_update();

DROP POLICY IF EXISTS purchases_update_due_date ON purchases;
CREATE POLICY purchases_update_due_date ON purchases FOR UPDATE TO authenticated
USING (true) WITH CHECK (true);
