/* ════════════════════════════════════════════════════════════
   لوحة المراجعة الأوفلاين — offline-panel.js
   يصدّر: offlineOpenPanel()
   بتتفتح من شارة الاتصال في الشريط العلوي — 3 تابات:
   1) الطابور المعلّق (عمليات لسه ما اتزامنتش)
   2) تقرير المطابقة (تعارضات ظهرت بعد المزامنة، تحتاج مراجعة بشرية)
   3) بحث سريع في آخر نسخة محفوظة من الأصناف/العملاء/الموردين
      (offline.js's dbGetCache) — للمراجعة وقت الأوفلاين بس، مفيش تعديل
   ════════════════════════════════════════════════════════════ */

let _opTab = 'queue'; // 'queue' | 'reconciliation' | 'lookup'

function opFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function opTimeAgo(ts) {
    if (!ts) return '—';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return 'الآن';
    if (s < 3600) return Math.floor(s / 60) + ' دقيقة';
    if (s < 86400) return Math.floor(s / 3600) + ' ساعة';
    return Math.floor(s / 86400) + ' يوم';
}

window.offlineOpenPanel = function () {
    let modal = document.getElementById('offlinePanelModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.className = 'mod-modal-bg';
        modal.id = 'offlinePanelModal';
        document.body.appendChild(modal);
    }
    modal.classList.add('active');
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:640px">
            <div class="mod-modal-header"><h3>📶 حالة الاتصال والمزامنة</h3>
                <button class="mod-modal-close" onclick="document.getElementById('offlinePanelModal').classList.remove('active')">&times;</button></div>
            <div style="padding:16px 24px 0">
                <div class="exp-tabs">
                    <button class="exp-tab ${_opTab === 'queue' ? 'active' : ''}" onclick="opSwitchTab('queue')">⏳ الطابور المعلّق</button>
                    <button class="exp-tab ${_opTab === 'reconciliation' ? 'active' : ''}" onclick="opSwitchTab('reconciliation')">⚠️ تعارضات</button>
                    <button class="exp-tab ${_opTab === 'lookup' ? 'active' : ''}" onclick="opSwitchTab('lookup')">🔍 بحث محفوظ</button>
                </div>
            </div>
            <div class="mod-modal-body" id="opBody" style="max-height:55vh;overflow-y:auto"></div>
        </div>`;
    window._offlinePanelRefresh = () => { if (document.getElementById('offlinePanelModal')?.classList.contains('active')) opRenderTab(); };
    opRenderTab();
};

window.opSwitchTab = function (tab) { _opTab = tab; opRenderTab(); };

async function opRenderTab() {
    const body = document.getElementById('opBody');
    if (!body) return;
    document.querySelectorAll('#offlinePanelModal .exp-tab').forEach((b, i) => {
        b.classList.toggle('active', ['queue', 'reconciliation', 'lookup'][i] === _opTab);
    });
    if (_opTab === 'queue') return opRenderQueue(body);
    if (_opTab === 'reconciliation') return opRenderReconciliation(body);
    return opRenderLookup(body);
}

async function opRenderQueue(body) {
    body.innerHTML = '<div style="text-align:center;padding:20px;color:#64748B">⏳ جاري التحميل...</div>';
    const items = (await getQueue()).sort((a, b) => b.createdAt - a.createdAt);
    const statusLabel = { pending: '⏳ بانتظار الاتصال', syncing: '🔄 جاري المزامنة...', failed: '❌ فشلت آخر محاولة' };
    const kindLabel = { collection: 'تحصيل عميل', payment: 'دفع مورد', expense: 'مصروف', sale: 'فاتورة مبيعات', sale_return: 'مرتجع مبيعات' };
    body.innerHTML = `
        <div style="margin-bottom:10px;font-size:12px;color:#64748B">${items.length ? `${items.length} عملية في الطابور` : 'مفيش عمليات معلّقة'}</div>
        ${items.length ? items.map(it => `
            <div style="display:flex;justify-content:space-between;align-items:center;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:10px 14px;margin-bottom:8px">
                <div>
                    <div style="font-weight:700;font-size:13px">${kindLabel[it.kind] || it.kind} ${it.tempRef ? `<span style="direction:ltr;color:#94A3B8;font-size:11px">(${it.tempRef})</span>` : ''}</div>
                    <div style="font-size:11px;color:#64748B">${opTimeAgo(it.createdAt)}${it.error ? ' — ' + it.error : ''}</div>
                </div>
                <span style="font-size:12px;font-weight:700">${statusLabel[it.status] || it.status}</span>
            </div>`).join('') : `<div class="empty-state"><span>✅</span>مفيش عمليات معلّقة حالياً</div>`}
        <button class="mod-btn mod-btn-primary" style="width:100%;margin-top:8px" onclick="trySync().then(()=>opRenderTab())">🔄 حاول المزامنة الآن</button>`;
}

async function opRenderReconciliation(body) {
    body.innerHTML = '<div style="text-align:center;padding:20px;color:#64748B">⏳ جاري التحميل...</div>';
    const items = (await getReconciliation()).sort((a, b) => b.at - a.at);
    body.innerHTML = `
        ${items.length ? items.map(it => `
            <div style="background:${it.resolved ? '#F8FAFC' : '#FFFBEB'};border:1px solid ${it.resolved ? '#E2E8F0' : '#FED7AA'};border-radius:10px;padding:10px 14px;margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
                    <div>
                        <div style="font-weight:700;font-size:13px">${it.summary}</div>
                        <div style="font-size:11px;color:#92400E;margin-top:4px">${(it.flags || []).join(' — ')}</div>
                        <div style="font-size:11.5px;color:#94A3B8;margin-top:2px">${opTimeAgo(it.at)}</div>
                    </div>
                    ${!it.resolved ? `<button class="cc-edit" onclick="resolveReconciliation(${it.id}).then(()=>opRenderTab())">✅ تمت المراجعة</button>` : ''}
                </div>
            </div>`).join('') : `<div class="empty-state"><span>✅</span>مفيش تعارضات مسجّلة</div>`}`;
}

async function opRenderLookup(body) {
    body.innerHTML = `
        <input type="text" id="opLookupSearch" class="mod-form-input" placeholder="🔍 بحث بالاسم/الكود..." oninput="opRunLookup(this.value)">
        <div id="opLookupResults" style="margin-top:12px"></div>`;
    opRunLookup('');
}

window.opRunLookup = async function (q) {
    const resultsEl = document.getElementById('opLookupResults');
    if (!resultsEl) return;
    const [products, customers, suppliers] = await Promise.all([
        dbGetCache('products'), dbGetCache('customers'), dbGetCache('suppliers'),
    ]);
    const query = (q || '').trim().toLowerCase();
    const rows = [];
    (products?.data || []).forEach(p => { if (!query || (p.name || '').toLowerCase().includes(query) || (p.code || '').toLowerCase().includes(query)) rows.push({ type: '📦 صنف', name: p.name, sub: p.code || '', val: opFmt(p.wholesale_price || p.retail_price || 0) }); });
    (customers?.data || []).forEach(c => { if (!query || (c.name || '').toLowerCase().includes(query)) rows.push({ type: '👤 عميل', name: c.name, sub: c.phone || '', val: opFmt(c.balance || 0) }); });
    (suppliers?.data || []).forEach(s => { if (!query || (s.name || '').toLowerCase().includes(query)) rows.push({ type: '🏭 مورد', name: s.name, sub: s.phone || '', val: opFmt(s.balance || 0) }); });

    const oldestCache = [products, customers, suppliers].filter(Boolean).map(c => c.updatedAt).sort((a, b) => a - b)[0];
    resultsEl.innerHTML = `
        ${oldestCache ? `<div style="font-size:11px;color:#94A3B8;margin-bottom:8px">📴 آخر تحديث للبيانات المحفوظة: ${new Date(oldestCache).toLocaleString('ar-EG')}</div>` : `<div class="empty-state"><span>📭</span>لسه مفيش بيانات محفوظة — افتح صفحات المبيعات/التحصيل/الدفع/المصروفات وانت أونلاين مرة الأول عشان تتخزن</div>`}
        ${rows.slice(0, 50).map(r => `
            <div style="display:flex;justify-content:space-between;padding:8px 10px;border-bottom:1px solid #F1F5F9;font-size:13px">
                <div><span style="color:#94A3B8;font-size:11px">${r.type}</span> <strong>${r.name}</strong> ${r.sub ? `<span style="color:#94A3B8;font-size:11px">(${r.sub})</span>` : ''}</div>
                <div style="font-weight:700">${r.val}</div>
            </div>`).join('')}
        ${query && !rows.length ? `<div class="empty-state"><span>🔍</span>مفيش نتائج</div>` : ''}
    `;
};

Object.assign(window, { offlineOpenPanel, opSwitchTab, opRunLookup });
