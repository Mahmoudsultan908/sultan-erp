-- Applied to the production Supabase project.
-- Recording a deferred rebate receipt now reduces the supplier balance,
-- updates received_amount, and posts a balanced journal entry.

CREATE OR REPLACE FUNCTION public.fn_receive_deferred_rebate_manual(
    p_id uuid,
    p_amount numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_remaining numeric;
    v_supplier_id uuid;
    v_ref text;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'مبلغ الاستلام يجب أن يكون أكبر من صفر';
    END IF;

    SELECT supplier_id, amount - received_amount
    INTO v_supplier_id, v_remaining
    FROM public.deferred_rebates_manual
    WHERE id = p_id AND status <> 'cancelled'
    FOR UPDATE;

    IF v_remaining IS NULL OR v_supplier_id IS NULL THEN
        RAISE EXCEPTION 'المؤجل غير موجود أو ملغي';
    END IF;
    IF p_amount > v_remaining + 0.001 THEN
        RAISE EXCEPTION 'المبلغ المدخل (%) أكبر من المتبقي (%)', p_amount, v_remaining;
    END IF;

    UPDATE public.deferred_rebates_manual
    SET received_amount = received_amount + p_amount,
        status = CASE WHEN received_amount + p_amount >= amount THEN 'received' ELSE status END,
        updated_at = now()
    WHERE id = p_id;

    UPDATE public.suppliers
    SET balance = balance - p_amount, updated_at = now()
    WHERE id = v_supplier_id;

    v_ref := 'DEFER-' || substr(gen_random_uuid()::text, 1, 12);
    PERFORM public.post_journal(
        v_ref, 'استلام مؤجل من مورد', 'deferred_rebate', p_id, auth.uid(),
        jsonb_build_array(
            jsonb_build_object('account_code', '2001', 'debit', p_amount, 'credit', 0),
            jsonb_build_object('account_code', '1005', 'debit', 0, 'credit', p_amount)
        )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_mark_deferred_rebate_received(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_count integer;
    v_supplier_count integer;
    v_supplier_id uuid;
    v_total numeric;
    v_ref text;
BEGIN
    IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'لازم تحدد بند واحد على الأقل';
    END IF;

    WITH locked AS (
        SELECT supplier_id, remaining_amount
        FROM public.deferred_rebates
        WHERE id = ANY(p_ids) AND status = 'pending'
        FOR UPDATE
    )
    SELECT count(*), count(DISTINCT supplier_id), min(supplier_id),
           coalesce(sum(greatest(remaining_amount, 0)), 0)
    INTO v_count, v_supplier_count, v_supplier_id, v_total
    FROM locked;

    IF v_count = 0 OR v_supplier_id IS NULL THEN
        RETURN 0;
    END IF;
    IF v_supplier_count > 1 THEN
        RAISE EXCEPTION 'لا يمكن استلام مؤجلات لأكثر من مورد في عملية واحدة';
    END IF;

    UPDATE public.deferred_rebates
    SET received_amount = expected_amount, status = 'received', updated_at = now()
    WHERE id = ANY(p_ids) AND status = 'pending';

    IF v_total > 0 THEN
        UPDATE public.suppliers
        SET balance = balance - v_total, updated_at = now()
        WHERE id = v_supplier_id;

        v_ref := 'DEFER-' || substr(gen_random_uuid()::text, 1, 12);
        PERFORM public.post_journal(
            v_ref, 'استلام مؤجلات من مورد', 'deferred_rebate', NULL, auth.uid(),
            jsonb_build_array(
                jsonb_build_object('account_code', '2001', 'debit', v_total, 'credit', 0),
                -- المؤجل التلقائي لم يكن مثبتاً كأصل 1005 وقت الشراء؛
                -- لذلك يُخفض تكلفة المخزون مباشرة عند استلامه.
                jsonb_build_object('account_code', '1004', 'debit', 0, 'credit', v_total)
            )
        );
    END IF;

    RETURN v_count;
END;
$function$;
