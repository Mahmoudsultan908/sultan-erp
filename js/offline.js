/* ════════════════════════════════════════════════════════════
   محرك العمل بدون إنترنت — offline.js
   لازم يتحمّل بعد supabase.js مباشرة، وقبل كل موديولات js/modules —
   عشان أي موديول يقدر يستخدم دواله من أول سطر بيتنفّذ فيه.

   بيوفر:
   - isOnline() / refreshOnlineState() — فحص اتصال حقيقي (مش
     navigator.onLine بس، لأنها مش موثوقة — بتفضل true حتى لو النت
     موجود بس Supabase نفسه مش قادر يوصله).
   - dbGetCache(table) / dbSetCache(table, data) — كاش بيانات مرجعية
     (أصناف/عملاء/موردين/مخزون) — قابل للاستبدال بحرية، موسوم بالوقت.
   - queueWrite/getQueue/updateQueueEntry/removeQueueEntry — طابور
     عمليات معلّقة (بيانات ثمينة، منفصلة تماماً عن الكاش).
   - registerSyncHandler(kind, handler) + trySync() — محرك مزامنة
     عام: كل موديول (collections/payments/expenses/sales/returns)
     بيسجّل الدالة اللي بتعرف تبعت العملية فعلياً لـ Supabase.
   - تنسيق بين تابات المتصفح (BroadcastChannel + Web Locks) عشان
     تابين ما يزامنوش في نفس الوقت أو يتصادموا على نفس العداد المحلي.

   ★ فلسفة أساسية: أي قيمة (رصيد/مخزون) محسوبة هنا وقت الأوفلاين هي
   تقدير للعرض بس (best-effort)، مش مصدر حقيقة — الحقيقة دايماً من
   السيرفر (الـ Triggers). أي تعارض بعد المزامنة بيتسجّل في تقرير
   مطابقة (reconciliation) بدل ما يتخفى.
   ════════════════════════════════════════════════════════════ */

const OFFLINE_DB_NAME = 'sultan_erp_offline';
const OFFLINE_DB_VERSION = 1;
const OFFLINE_CHANNEL_NAME = 'sultan_erp_offline_sync';
const OFFLINE_PING_INTERVAL_MS = 20000;
const OFFLINE_PING_TIMEOUT_MS = 5000;

// ════════════════════════════════════════════════════════════
// 0) معرّف الجهاز (لأرقام المستندات المؤقتة وقت الأوفلاين)
// ════════════════════════════════════════════════════════════
function offlineGetDeviceId() {
    let id = localStorage.getItem('sultan_device_id');
    if (!id) {
        id = 'D' + Math.random().toString(36).slice(2, 8).toUpperCase();
        localStorage.setItem('sultan_device_id', id);
    }
    return id;
}

// ════════════════════════════════════════════════════════════
// 1) IndexedDB — 3 مخازن: cache (بيانات مرجعية) / queue (عمليات
//    معلّقة) / reconciliation (تقرير تعارضات بعد المزامنة)
// ════════════════════════════════════════════════════════════
let _offlineDbPromise = null;
function openOfflineDB() {
    if (_offlineDbPromise) return _offlineDbPromise;
    _offlineDbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('cache')) {
                db.createObjectStore('cache', { keyPath: 'table' });
            }
            if (!db.objectStoreNames.contains('queue')) {
                const qs = db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
                qs.createIndex('status', 'status');
                qs.createIndex('kind', 'kind');
            }
            if (!db.objectStoreNames.contains('reconciliation')) {
                db.createObjectStore('reconciliation', { keyPath: 'id', autoIncrement: true });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return _offlineDbPromise;
}

function idbReq(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbStore(name, mode) {
    const db = await openOfflineDB();
    return db.transaction(name, mode).objectStore(name);
}

// ── كاش البيانات المرجعية ──
async function dbSetCache(table, data) {
    try {
        const store = await idbStore('cache', 'readwrite');
        await idbReq(store.put({ table, data: data || [], updatedAt: Date.now() }));
        console.log(`[offline] كاش "${table}" اتحدّث (${(data || []).length} صف)`);
    } catch (err) {
        console.error(`[offline] فشل حفظ كاش "${table}":`, err);
    }
}
async function dbGetCache(table) {
    try {
        const store = await idbStore('cache', 'readonly');
        const row = await idbReq(store.get(table));
        return row || null; // { table, data, updatedAt } أو null
    } catch (err) {
        console.error(`[offline] فشل قراءة كاش "${table}":`, err);
        return null;
    }
}

// ── تسخين الكاش تلقائياً بعد تسجيل الدخول مباشرة (بدل الاعتماد على
//    إن المستخدم يفتح صفحة مبيعات/تحصيل/دفع بالتحديد الأول) ──
async function offlineWarmCache() {
    if (typeof sb === 'undefined') return;
    try {
        const [{ data: products, error: e1 }, { data: customers, error: e2 }, { data: suppliers, error: e3 }] = await Promise.all([
            sb.from('products').select('*').eq('is_active', true).order('name'),
            sb.from('customers').select('*').eq('is_active', true).order('name'),
            sb.from('suppliers').select('*').eq('is_active', true).order('name'),
        ]);
        console.log('[offline] نتيجة تسخين الكاش الأولي:', {
            products: products?.length, productsErr: e1?.message,
            customers: customers?.length, customersErr: e2?.message,
            suppliers: suppliers?.length, suppliersErr: e3?.message,
        });
        await Promise.all([
            dbSetCache('products', products || []),
            dbSetCache('customers', customers || []),
            dbSetCache('suppliers', suppliers || []),
        ]);
    } catch (err) {
        console.error('[offline] فشل تسخين الكاش الأولي:', err);
    }
}

// ── طابور العمليات المعلّقة ──
// entry: { module, kind, payload, tempRef }
async function queueWrite(entry) {
    const store = await idbStore('queue', 'readwrite');
    const full = { ...entry, status: 'pending', createdAt: Date.now(), error: null };
    const id = await idbReq(store.add(full));
    offlineBroadcast({ type: 'queue-changed' });
    offlineUpdateBadge();
    return id;
}
async function getQueue(filterFn) {
    const store = await idbStore('queue', 'readonly');
    const all = await idbReq(store.getAll());
    return filterFn ? all.filter(filterFn) : all;
}
async function updateQueueEntry(id, changes) {
    const store = await idbStore('queue', 'readwrite');
    const existing = await idbReq(store.get(id));
    if (!existing) return;
    await idbReq(store.put({ ...existing, ...changes }));
    offlineBroadcast({ type: 'queue-changed' });
    offlineUpdateBadge();
}
async function removeQueueEntry(id) {
    const store = await idbStore('queue', 'readwrite');
    await idbReq(store.delete(id));
    offlineBroadcast({ type: 'queue-changed' });
    offlineUpdateBadge();
}

// ── تقرير المطابقة (تعارضات بعد المزامنة) ──
async function appendReconciliation(items) {
    const store = await idbStore('reconciliation', 'readwrite');
    for (const it of items) {
        await idbReq(store.add({ ...it, resolved: false }));
    }
    offlineBroadcast({ type: 'reconciliation-changed' });
    offlineUpdateBadge();
}
async function getReconciliation(onlyUnresolved) {
    const store = await idbStore('reconciliation', 'readonly');
    const all = await idbReq(store.getAll());
    return onlyUnresolved ? all.filter(r => !r.resolved) : all;
}
async function resolveReconciliation(id) {
    const store = await idbStore('reconciliation', 'readwrite');
    const existing = await idbReq(store.get(id));
    if (!existing) return;
    await idbReq(store.put({ ...existing, resolved: true }));
    offlineBroadcast({ type: 'reconciliation-changed' });
    offlineUpdateBadge();
}

// ════════════════════════════════════════════════════════════
// 2) فحص الاتصال الحقيقي (مش navigator.onLine بس)
// ════════════════════════════════════════════════════════════
let _offlineState = { online: navigator.onLine, lastCheck: 0 };

async function pingSupabase() {
    if (typeof sb === 'undefined') return false;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), OFFLINE_PING_TIMEOUT_MS);
        const { error } = await sb.from('app_settings').select('key').limit(1).abortSignal(controller.signal);
        clearTimeout(timer);
        return !error;
    } catch { return false; }
}

async function refreshOnlineState() {
    const reachable = navigator.onLine ? await pingSupabase() : false;
    const changed = reachable !== _offlineState.online;
    _offlineState = { online: reachable, lastCheck: Date.now() };
    offlineUpdateBadge();
    if (changed) {
        offlineBroadcast({ type: 'connectivity', online: reachable });
        if (reachable) trySync(); // رجع النت؟ حاول تزامن فوراً
    }
    return reachable;
}

function isOnline() { return _offlineState.online; }

window.addEventListener('online', refreshOnlineState);
window.addEventListener('offline', refreshOnlineState);
setInterval(refreshOnlineState, OFFLINE_PING_INTERVAL_MS);

// ════════════════════════════════════════════════════════════
// 3) تنسيق بين التابات (BroadcastChannel + Web Locks)
// ════════════════════════════════════════════════════════════
let _offlineBC = null;
function offlineBroadcast(msg) {
    try {
        if (!_offlineBC) _offlineBC = new BroadcastChannel(OFFLINE_CHANNEL_NAME);
        _offlineBC.postMessage(msg);
    } catch {}
}
try {
    _offlineBC = new BroadcastChannel(OFFLINE_CHANNEL_NAME);
    _offlineBC.addEventListener('message', (e) => {
        if (e?.data?.type === 'connectivity') { _offlineState.online = e.data.online; }
        offlineUpdateBadge();
        if (window._offlinePanelRefresh) window._offlinePanelRefresh();
    });
} catch {}

// ════════════════════════════════════════════════════════════
// 4) محرك المزامنة العام
// ════════════════════════════════════════════════════════════
const _syncHandlers = {}; // kind -> async (entry) => { ok, error?, needsReauth?, flags? }
// تدفقات مرتبطة بمخزون: لازم تتزامن بالترتيب، وتوقف عند أول فشل
// (لأن التقدير المحلي بعد كده مبني على افتراض إن اللي قبله نجح)
const OFFLINE_STRICT_ORDER_KINDS = ['sale', 'sale_return'];

function registerSyncHandler(kind, handler) {
    _syncHandlers[kind] = handler;
}

let _syncing = false;
async function trySync() {
    if (_syncing) return;
    if (!(await refreshOnlineState())) return;

    if (!('locks' in navigator)) { await _offlineDoSync(); return; }
    await navigator.locks.request('sultan_erp_sync_lock', { ifAvailable: true }, async (lock) => {
        if (!lock) return; // تاب تاني ماسك المزامنة بالفعل
        await _offlineDoSync();
    });
}

async function _offlineDoSync() {
    _syncing = true;
    try {
        const pending = await getQueue(e => e.status === 'pending' || e.status === 'failed');
        pending.sort((a, b) => a.createdAt - b.createdAt);

        const reconciliation = [];
        for (const entry of pending) {
            const handler = _syncHandlers[entry.kind];
            if (!handler) continue;
            await updateQueueEntry(entry.id, { status: 'syncing' });

            let outcome;
            try {
                outcome = await handler(entry);
            } catch (err) {
                outcome = { ok: false, error: err.message || String(err) };
            }

            if (outcome.ok) {
                await removeQueueEntry(entry.id);
                if (outcome.flags && outcome.flags.length) {
                    reconciliation.push({ summary: outcome.summary || entry.kind, flags: outcome.flags, at: Date.now() });
                }
            } else {
                const needsReauth = /jwt|token|401|403/i.test(outcome.error || '');
                await updateQueueEntry(entry.id, { status: 'failed', error: outcome.error });
                reconciliation.push({
                    summary: outcome.summary || entry.kind,
                    flags: [needsReauth ? 'محتاج تسجيل دخول تاني' : ('فشل: ' + outcome.error)],
                    at: Date.now(),
                });
                if (needsReauth) break; // وقف كل حاجة، المشكلة مش في البيانات
                if (OFFLINE_STRICT_ORDER_KINDS.includes(entry.kind)) break; // ترتيب صارم لتدفقات المخزون
                // غير كده (تحصيل/دفع/مصروفات): كمّل للي بعده، مفيش ترابط
            }
        }
        if (reconciliation.length) await appendReconciliation(reconciliation);
    } finally {
        _syncing = false;
        offlineUpdateBadge();
    }
}

// ════════════════════════════════════════════════════════════
// 5) إشعار خفيف عام (يستخدمه أي موديول بدل alert() لعمليات الأوفلاين)
// ════════════════════════════════════════════════════════════
function offlineToast(msg, type = 'info') {
    let t = document.getElementById('offlineToastEl');
    if (!t) {
        t = document.createElement('div');
        t.id = 'offlineToastEl'; t.className = 'offline-toast';
        document.body.appendChild(t);
    }
    t.className = 'offline-toast ' + type;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._offlineToastT);
    window._offlineToastT = setTimeout(() => t.classList.remove('show'), 3200);
}

// ════════════════════════════════════════════════════════════
// 6) شارة الاتصال في الشريط العلوي (يستدعيها app.js عند بناء الواجهة)
// ════════════════════════════════════════════════════════════
async function offlineUpdateBadge() {
    const el = document.getElementById('topbarOffline');
    if (!el) return;
    try {
        const [pending, unresolved] = await Promise.all([
            getQueue(e => e.status === 'pending' || e.status === 'failed' || e.status === 'syncing'),
            getReconciliation(true),
        ]);
        const parts = [];
        parts.push(isOnline() ? '🟢 متصل' : '🔴 غير متصل');
        if (pending.length) parts.push(`⏳ ${pending.length} معلّقة`);
        if (unresolved.length) parts.push(`⚠️ ${unresolved.length} تعارض`);
        el.textContent = parts.join(' — ');
        el.classList.toggle('has-issues', !isOnline() || pending.length > 0 || unresolved.length > 0);
    } catch {}
}

Object.assign(window, {
    isOnline, refreshOnlineState, offlineGetDeviceId,
    dbGetCache, dbSetCache, offlineWarmCache,
    queueWrite, getQueue, updateQueueEntry, removeQueueEntry,
    appendReconciliation, getReconciliation, resolveReconciliation,
    registerSyncHandler, trySync,
    offlineUpdateBadge, offlineBroadcast, offlineToast,
});
