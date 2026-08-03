-- ════════════════════════════════════════════════════════════
-- fn_block_amount_edit_after_confirm بيمنع تعديل أي عمود في عملية
-- "confirmed" غير status/updated_at/due_date — وده كان بيمنع زرار
-- "استبعاد من حساب المستثمر" (excluded_from_investor_split) في شاشة
-- المصروفات (expToggleLineInvestorExclude فى expenses.js) من الشغل
-- على أي مصروف اتأكد بالفعل، رغم إنه علم تصنيفي بحت مالوش أي أثر
-- مالي (مبلغ/قيد/رصيد). نفس استثناء due_date بالظبط. الدالة دي مشتركة
-- بين 9 جداول (sales/purchases/returns/payments/collections/opening_
-- balances/expenses)، فالاستثناء آمن للكل — أي جدول مالوش العمود ده
-- الطرح بتاعه no-op.
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_block_amount_edit_after_confirm()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if old.status = 'confirmed' and tg_op = 'UPDATE' then
    if to_jsonb(new) - 'status' - 'updated_at' - 'due_date' - 'excluded_from_investor_split'
       <> to_jsonb(old) - 'status' - 'updated_at' - 'due_date' - 'excluded_from_investor_split' then
      raise exception 'لا يمكن تعديل بيانات عملية مؤكدة — الإلغاء فقط مسموح (status = cancelled)';
    end if;
  end if;
  return new;
end;
$function$;
