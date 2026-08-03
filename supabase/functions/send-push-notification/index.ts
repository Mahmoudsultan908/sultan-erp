// send-push-notification — يبعت إشعار Web Push حقيقي لعميل/عملاء
// سلطانو (مش واتساب، مش رسالة SMS — إشعار زي إشعارات فيسبوك على
// الموبايل، عبر بروتوكول Web Push القياسي مجاناً بالكامل).
//
// الاستدعاء بيحصل من سلطان ERP بس (شاشة "طلبات العملاء") — لازم
// المستخدم يكون أدمن أو محاسب، بيتأكد منه هنا صراحة (مش بس إنه
// مسجّل دخول عادي).
//
// Body: { customer_ids: string[] | 'all', title: string, body: string,
//         image?: string, url?: string }
//
// Secrets مطلوبة (تتضبط من Supabase Dashboard → Edge Functions →
// Secrets، مش موجودة هنا): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(supabaseUrl, serviceRoleKey)

    // ── تحقق: المستدعي أدمن أو محاسب فعلاً (مش بس عنده جلسة صالحة) ──
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'غير مصرّح' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    const { data: profile } = await admin.from('profiles').select('role').eq('id', userData.user.id).maybeSingle()
    if (!profile || !['admin', 'accountant'].includes(profile.role)) {
      return new Response(JSON.stringify({ error: 'مسموح بس للأدمن أو المحاسب' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { customer_ids, title, body, image, url } = await req.json()
    if (!title || !body) {
      return new Response(JSON.stringify({ error: 'العنوان والنص مطلوبين' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    let query = admin.from('push_subscriptions').select('id, endpoint, p256dh, auth')
    if (customer_ids !== 'all') {
      if (!Array.isArray(customer_ids) || !customer_ids.length) {
        return new Response(JSON.stringify({ error: 'لازم تحدد عميل واحد على الأقل أو all' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      query = query.in('customer_id', customer_ids)
    }
    const { data: subs, error: subsErr } = await query
    if (subsErr) throw subsErr
    if (!subs?.length) {
      return new Response(JSON.stringify({ sent: 0, failed: 0, total: 0, note: 'مفيش عملاء مفعّلين الإشعارات ضمن المستهدفين' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')!
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')!
    const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@sultan-foods.example'
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)

    const payload = JSON.stringify({ title, body, image: image || null, url: url || '/' })

    let sent = 0, failed = 0
    const deadIds: string[] = []
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        )
        sent++
      } catch (err) {
        failed++
        const status = err?.statusCode
        if (status === 404 || status === 410) deadIds.push(s.id) // اشتراك منتهي/محذوف من المتصفح
      }
    }))

    if (deadIds.length) {
      await admin.from('push_subscriptions').delete().in('id', deadIds)
    }

    return new Response(JSON.stringify({ sent, failed, total: subs.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: err?.message || String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
