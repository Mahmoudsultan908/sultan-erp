-- ════════════════════════════════════════════════════════════
-- يسمح لأي مستخدم متصل (مش بس أدمن/محاسب) يحدّث due_date بس على
-- فواتير المبيعات، من غير ما يفتح باب تعديل أي عمود تاني (الحالة/
-- الإجمالي/العميل...) اللي المفروض يفضل مقفول على sales_update_status
-- (أدمن/محاسب بس). التريجر بيرفض أي تحديث بيغيّر عمود غير due_date
-- لمستخدم مش أدمن/محاسب.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION fn_guard_sales_limited_self_update()
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
    RAISE EXCEPTION 'غير مسموح تعديل أي بيانات في الفاتورة غير تاريخ الاستحقاق';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_sales_limited_self_update ON sales;
CREATE TRIGGER trg_guard_sales_limited_self_update
BEFORE UPDATE ON sales
FOR EACH ROW EXECUTE FUNCTION fn_guard_sales_limited_self_update();

DROP POLICY IF EXISTS sales_update_due_date ON sales;
CREATE POLICY sales_update_due_date ON sales FOR UPDATE TO authenticated
USING (true) WITH CHECK (true);
