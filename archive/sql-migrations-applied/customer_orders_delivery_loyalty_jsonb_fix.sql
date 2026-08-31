-- Applied to the production Supabase project.
-- Fixes delivery-status updates when app_settings.value is JSONB text.
CREATE OR REPLACE FUNCTION public.fn_customer_orders_award_loyalty_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_enabled       boolean := false;
    v_points_per_egp numeric := 0.1;
    v_points        numeric(14,2);
    v_setting       jsonb;
    v_raw           text;
BEGIN
    IF NEW.status IS DISTINCT FROM 'delivered' OR OLD.status IS NOT DISTINCT FROM 'delivered' THEN
        RETURN NEW;
    END IF;

    IF EXISTS (SELECT 1 FROM public.loyalty_points_ledger WHERE order_id = NEW.id) THEN
        RETURN NEW;
    END IF;

    SELECT value INTO v_setting FROM public.app_settings
    WHERE key = 'sultanoo_loyalty_enabled' LIMIT 1;
    v_raw := NULLIF(trim(v_setting #>> '{}'), '');
    IF v_setting IS NOT NULL THEN
        IF jsonb_typeof(v_setting) = 'boolean' THEN
            v_enabled := v_raw::boolean;
        ELSIF jsonb_typeof(v_setting) IN ('string', 'number') THEN
            v_enabled := lower(v_raw) IN ('true', '1', 'yes', 'on');
        END IF;
    END IF;
    IF NOT v_enabled THEN
        RETURN NEW;
    END IF;

    SELECT value INTO v_setting FROM public.app_settings
    WHERE key = 'sultanoo_loyalty_points_per_egp' LIMIT 1;
    v_raw := NULLIF(trim(v_setting #>> '{}'), '');
    IF v_raw IS NOT NULL AND v_raw ~ '^[0-9]+([.][0-9]+)?$' THEN
        v_points_per_egp := v_raw::numeric;
    END IF;

    v_points := floor(COALESCE(NEW.total, 0) * v_points_per_egp);
    IF v_points > 0 THEN
        INSERT INTO public.loyalty_points_ledger (customer_id, order_id, points_delta, reason)
        VALUES (
            NEW.customer_id,
            NEW.id,
            v_points,
            'طلب رقم ' || COALESCE(NEW.order_no, NEW.id::text) || ' — تم التسليم'
        );

        UPDATE public.customers
        SET loyalty_points_balance = loyalty_points_balance + v_points
        WHERE id = NEW.customer_id;
    END IF;

    RETURN NEW;
END;
$function$;
