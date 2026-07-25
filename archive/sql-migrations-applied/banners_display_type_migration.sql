-- بند 13: بانر منفصل بحجم الشاشة يظهر مرة عند فتح تطبيق سلطانو، بجانب الشريط الدوّار الحالي.
ALTER TABLE banners ADD COLUMN IF NOT EXISTS display_type text NOT NULL DEFAULT 'carousel';
ALTER TABLE banners ADD CONSTRAINT banners_display_type_check CHECK (display_type IN ('carousel','popup'));

DROP FUNCTION IF EXISTS public.fn_sultano_get_banners();

CREATE FUNCTION public.fn_sultano_get_banners()
 RETURNS TABLE(id uuid, title text, subtitle text, image_url text, bg_color text, link_to uuid, sort_order integer, display_type text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select id, title, ''::text as subtitle, image_url, '#1a4731'::text as bg_color,
    case when link_type = 'category' then link_value::uuid else null end as link_to,
    display_order, display_type
  from public.banners
  where is_active = true
  order by display_order, created_at;
$function$;
