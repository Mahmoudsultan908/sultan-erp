-- ════════════════════════════════════════════════════════════
-- بنية تحتية لإشعارات Push حقيقية (Web Push) للعملاء المسجّلين في
-- سلطانو — إشعار زي إشعارات فيسبوك، مش رسالة واتساب. مجاني بالكامل
-- (بروتوكول Web Push المدعوم من كل المتصفحات)، الإرسال الفعلي بيحصل
-- من Edge Function مستقلة (send-push-notification) باستخدام مفتاحي
-- VAPID، مش من الفرونت إند مباشرة.
--
-- Edge Function send-push-notification منشورة عن طريق mcp__supabase__
-- deploy_edge_function (مش في الريبو ده — كودها موجود في مجلد
-- supabase/functions/send-push-notification/index.ts لو حبينا نضيفها
-- للريبو لاحقاً). محتاجة 3 secrets مضبوطة يدوياً من Dashboard:
-- VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id uuid primary key default gen_random_uuid(),
    customer_id uuid not null references customers(id) on delete cascade,
    endpoint text not null unique,
    p256dh text not null,
    auth text not null,
    user_agent text,
    created_at timestamptz not null default now()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_customer ON push_subscriptions(customer_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY push_subscriptions_staff_select ON push_subscriptions FOR SELECT TO public
    USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','accountant')));

CREATE OR REPLACE FUNCTION fn_sultano_save_push_subscription(
    p_customer_id uuid, p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO push_subscriptions (customer_id, endpoint, p256dh, auth, user_agent)
    VALUES (p_customer_id, p_endpoint, p_p256dh, p_auth, p_user_agent)
    ON CONFLICT (endpoint) DO UPDATE
        SET customer_id = excluded.customer_id, p256dh = excluded.p256dh,
            auth = excluded.auth, user_agent = excluded.user_agent;
END;
$$;

CREATE OR REPLACE FUNCTION fn_sultano_remove_push_subscription(p_endpoint text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM push_subscriptions WHERE endpoint = p_endpoint;
END;
$$;
