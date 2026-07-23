-- نفس حماية تكرار المزامنة اللي اتعملت لـ customer_payments وsales —
-- المصروفات بتتزامن من تطبيق المندوب بنفس نمط الـ ref (REP-EXP-...)
-- بدون أي حماية لحد دلوقتي.
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_ref_confirmed_unique
    ON public.expenses (ref)
    WHERE status = 'confirmed' AND ref IS NOT NULL;
