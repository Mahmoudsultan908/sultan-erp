// Service Worker بسيط — شرط تقني أساسي لتفعيل "تثبيت على سطح المكتب" (PWA)
// لا يقوم بأي تخزين مؤقت (cache) للبيانات عمداً، لأن هذا تطبيق بيانات حية
// (Supabase) ولازم يفضل يجيب أحدث نسخة كل مرة، مش نسخة قديمة مخزّنة.

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// مرّر كل الطلبات عادي بدون أي اعتراض أو تخزين مؤقت
self.addEventListener('fetch', (event) => {
    event.respondWith(fetch(event.request));
});
