-- بند 15: تقرير إغلاق اليوم المندوب بيسجّله على تليفونه محلي فقط (localStorage)
-- ومش بيوصل لسلطان ERP خالص. الجدول ده بيخزن نسخة من التقرير ده لما
-- المندوب يقفل يومه، عشان الأدمن يقدر يشوفه من شاشة "تقرير الإغلاق اليومي".
CREATE TABLE IF NOT EXISTS rep_day_closings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rep_id uuid NOT NULL REFERENCES sales_reps(id) ON DELETE CASCADE,
    close_date date NOT NULL,
    expected_cash numeric NOT NULL DEFAULT 0,
    actual_cash numeric NOT NULL DEFAULT 0,
    diff numeric NOT NULL DEFAULT 0,
    total_sales numeric NOT NULL DEFAULT 0,
    total_cash numeric NOT NULL DEFAULT 0,
    total_debt numeric NOT NULL DEFAULT 0,
    total_collect numeric NOT NULL DEFAULT 0,
    total_returns numeric NOT NULL DEFAULT 0,
    total_expenses numeric NOT NULL DEFAULT 0,
    total_deposits numeric NOT NULL DEFAULT 0,
    visits integer NOT NULL DEFAULT 0,
    sold_visits integer NOT NULL DEFAULT 0,
    closed_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (rep_id, close_date)
);

ALTER TABLE rep_day_closings ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_all_rep_day_closings ON rep_day_closings FOR ALL USING (true) WITH CHECK (true);
