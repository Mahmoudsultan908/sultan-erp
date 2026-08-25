-- إصلاح احترام تاريخ القيد المرسل إلى post_journal.
-- النسخة السابقة كانت تضع التاريخ في created_at فقط وتترك entry_date = now().

create or replace function public.post_journal(
    p_ref text,
    p_description text,
    p_ref_type text,
    p_ref_id uuid,
    p_created_by uuid,
    p_lines jsonb,
    p_entry_date timestamp with time zone
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_entry_id uuid;
    v_line jsonb;
begin
    insert into public.journal_entries
        (ref, description, ref_type, ref_id, created_by, created_at, entry_date)
    values
        (p_ref, p_description, p_ref_type, p_ref_id, p_created_by,
         coalesce(p_entry_date, now()), coalesce(p_entry_date::date, current_date))
    returning id into v_entry_id;

    for v_line in select * from jsonb_array_elements(p_lines)
    loop
        insert into public.journal_entry_lines (entry_id, account_code, debit, credit)
        values (
            v_entry_id,
            v_line->>'account_code',
            coalesce((v_line->>'debit')::numeric, 0),
            coalesce((v_line->>'credit')::numeric, 0)
        );
    end loop;
    return v_entry_id;
end;
$$;

-- القيد الذي نتج قبل إصلاح الدالة: تصحيح التاريخ فقط بعد مطابقة المرجع والمبلغ.
update public.journal_entries
set entry_date = date '2026-08-16'
where ref = 'RECLASS-OWNER-CAPITAL-35000-2026-08-16'
  and entry_date = current_date
  and description = 'إعادة تصنيف إيداع باقى الدهب من مورد مؤقت إلى رأس مال المالك - النقدية موجودة بالفعل في خزنة تقفيل';
