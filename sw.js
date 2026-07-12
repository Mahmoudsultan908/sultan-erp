// Service Worker — يدعم فتح قشرة التطبيق (HTML/CSS/JS) أوفلاين، بدون
// ما يلمس بيانات Supabase الحية أبداً (تفضل تتجاب من الشبكة كل مرة).
//
// ★ التمييز الأساسي:
//   - أي طلب لـ Supabase (fanaozxqlodzfdgstwaz.supabase.co) → من الشبكة
//     دايماً، بدون أي تخزين مؤقت — بيانات حية لازم تفضل حية.
//   - أي حاجة تانية (index.html, css/js المحلية, مكتبات CDN زي
//     supabase-js/xlsx, الأيقونات) → cache-first مع تحديث في الخلفية،
//     عشان التطبيق نفسه (مش بياناته) يفتح حتى بدون إنترنت.

const SHELL_CACHE = 'sultan-erp-shell-v1';
const SUPABASE_HOST = 'fanaozxqlodzfdgstwaz.supabase.co';

const SHELL_URLS = [
    './',
    './index.html',
    './manifest.json',
    './icon-192.png',
    './icon-512.png',
    './css/claude-modules.css',
    './js/supabase.js',
    './js/offline.js',
    './js/app.js',
    './js/modules/accounting.js',
    './js/modules/advanced-permissions.js',
    './js/modules/audit-log.js',
    './js/modules/cash-movement.js',
    './js/modules/collections.js',
    './js/modules/coming-soon.js',
    './js/modules/customer-supplier-import.js',
    './js/modules/customers.js',
    './js/modules/dashboard.js',
    './js/modules/expense-categories-add.js',
    './js/modules/expenses.js',
    './js/modules/general-import-export.js',
    './js/modules/general-ledger.js',
    './js/modules/inventory.js',
    './js/modules/invoice-review.js',
    './js/modules/master-data.js',
    './js/modules/offline-panel.js',
    './js/modules/opening-balances.js',
    './js/modules/payments.js',
    './js/modules/performance-reports.js',
    './js/modules/print-center.js',
    './js/modules/product-import.js',
    './js/modules/products.js',
    './js/modules/purchase-orders.js',
    './js/modules/purchases.js',
    './js/modules/quotations.js',
    './js/modules/reports.js',
    './js/modules/returns.js',
    './js/modules/sales-reps.js',
    './js/modules/sales.js',
    './js/modules/settings.js',
    './js/modules/stock-transfer.js',
    './js/modules/suppliers.js',
    './js/modules/thermal-print.js',
    './js/modules/users-management.js',
    './js/modules/warehouse-reports.js',
    './js/modules/warehouses.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(SHELL_CACHE).then((cache) =>
            // Promise.allSettled عشان فشل ملف واحد (مثلاً مكتبة CDN بطيئة)
            // ميوقفش تخزين باقي القشرة كلها
            Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)))
        )
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then((keys) =>
                Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
            ),
        ])
    );
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // بيانات Supabase الحية: شبكة فقط، صفر تخزين مؤقت — عمداً.
    // لو النت مقطوع، fetch() هيرفض بشكل طبيعي ومتوقّع — بنرجّع Response
    // صريح (503) بدل ما نسيب الـ promise من غير catch (كان بيطلع
    // "Uncaught (in promise)" في الـ console لكل طلب وإحنا أوفلاين،
    // وده كان بيبان وكأنه خطأ حقيقي رغم إنه سلوك متوقّع 100%).
    if (url.hostname === SUPABASE_HOST) {
        event.respondWith(
            fetch(event.request).catch(() => new Response(
                JSON.stringify({ error: 'offline', message: 'لا يوجد اتصال بالإنترنت حالياً' }),
                { status: 503, headers: { 'Content-Type': 'application/json' } }
            ))
        );
        return;
    }

    // قشرة التطبيق + مكتبات CDN: cache-first + تحديث في الخلفية.
    // لو المصدر ده مش متخزّن أصلاً (أول زيارة أوفلاين قبل ما install
    // يخلّص) والشبكة فشلت كمان، نرجّع Response حقيقي بدل undefined
    // (تسبيب "Failed to convert value to Response" لو سابناها للـ catch بس).
    event.respondWith(
        caches.match(event.request).then((cached) => {
            const network = fetch(event.request)
                .then((resp) => {
                    if (resp && (resp.ok || resp.type === 'opaque')) {
                        const clone = resp.clone();
                        caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone));
                    }
                    return resp;
                })
                .catch(() => cached || new Response('غير متاح أوفلاين', { status: 503 }));
            return cached || network;
        })
    );
});
