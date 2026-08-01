-- ════════════════════════════════════════════════════════════
-- fn_block_amount_edit_after_confirm بيمنع تعديل أي عمود في فاتورة
-- "confirmed" غير status — وده كان هيمنع تحديث due_date بعد الحفظ
-- (اللي sales.js بيعمله كخطوة منفصلة بعد fn_create_sale) بنفس الاستثناء
-- المعمول بيه بالفعل مع status/updated_at.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_block_amount_edit_after_confirm()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.status = 'confirmed' and tg_op = 'UPDATE' then
    if to_jsonb(new) - 'status' - 'updated_at' - 'due_date' <> to_jsonb(old) - 'status' - 'updated_at' - 'due_date' then
      raise exception 'لا يمكن تعديل بيانات عملية مؤكدة — الإلغاء فقط مسموح (status = cancelled)';
    end if;
  end if;
  return new;
end;
$function$;
