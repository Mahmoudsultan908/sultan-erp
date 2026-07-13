/* ════════════════════════════════════════════════════════════
   تحصيل العملاء (سندات قبض) — customer_payments
   INSERT فقط — الـ Trigger (سيُنشأ لاحقاً) بيتولّى: الخزنة + رصيد العميل + القيد

   ⚠️ تنبيه مهم: جدول customer_payments جديد كلياً وليس له Trigger بعد.
   عند الـ INSERT بنجاح من الواجهة، لازم يتعمل Trigger في قاعدة البيانات
   يخصم من رصيد العميل ويضيف في الخزنة. (شغل منفصل على Supabase)
   ════════════════════════════════════════════════════════════ */

let _colCustomers = [];
let _colSelectedId = null;
let _colList = [];

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي
// ════════════════════════════════════════════════════════════
async function renderCollections(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات تحصيل العملاء...</div>';
    let customers = [], payments = [], isOfflineData = false, offlineDataAge = null;
    try {
        const { data: custData, error: custErr } = await sb.from('customers').select('*').eq('is_active', true).order('name');
        if (custErr || !custData) throw custErr || new Error('no customers');
        customers = custData;
        try {
            const r = await sb.from('customer_payments')
                .select('*, customers(name, phone, balance)').order('created_at', { ascending: false }).limit(50);
            payments = r.data || [];
        } catch (e) {
            // الجدول ممكن ما يكنش اتخلق لسه → نعرض تحذير للمستخدم
        }
        // كاش للمراجعة الأوفلاين (offline.js) — قراءة فقط، بيتحدّث تلقائياً كل ما الصفحة تفتح أونلاين
        if (typeof dbSetCache === 'function') dbSetCache('customers', customers);
    } catch (err) {
        // فشل التحميل الحي (أوفلاين أو خطأ شبكة) → ارجع لآخر نسخة محفوظة في الكاش
        if (typeof dbGetCache === 'function') {
            const cached = await dbGetCache('customers');
            if (cached?.data?.length) {
                customers = cached.data;
                isOfflineData = true;
                offlineDataAge = cached.updatedAt;
            }
        }
    }

    _colCustomers = typeof colApplyPendingEstimates === 'function' ? await colApplyPendingEstimates(customers) : customers;
    _colList = payments;

    // عمليات تحصيل اتسجّلت محلياً ولسه ماتزامنتش
    const pendingEntries = typeof getQueue === 'function'
        ? await getQueue(e => e.module === 'collections' && (e.status === 'pending' || e.status === 'failed' || e.status === 'syncing'))
        : [];
    const pendingRows = pendingEntries.map(e => ({
        _queue: true, id: 'q' + e.id, _queueId: e.id,
        ref: e.payload.ref, amount: e.payload.amount, created_at: new Date(e.createdAt).toISOString(), status: e.status,
        customers: { name: _colCustomers.find(x => x.id === e.payload.customer_id)?.name || '—' },
    }));
    const displayRows = [...pendingRows, ...payments];

    const totalCollected = payments.reduce((s,p)=>s+(Number(p.amount)||0),0);
    const debtCustomers = _colCustomers.filter(c => (Number(c.balance)||0) > 0);
    const totalDebt = debtCustomers.reduce((s,c)=>s+(Number(c.balance)||0),0);

    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
            <div><h2 style="font-size:22px;font-weight:800">💵 تحصيل العملاء (سندات قبض)</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">تسجيل المبالغ المحصّلة من العملاء — مرتبطة بالخزنة ورصيد العميل</p></div>
            <button class="mod-btn mod-btn-primary" onclick="colOpenAdd()">+ تحصيل دفعة جديدة</button>
        </div>

        ${isOfflineData ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:9px 16px;border-radius:9px;margin-bottom:16px;font-size:12.5px">
            📴 <strong>غير متصل بالإنترنت</strong> — بيانات العملاء المعروضة من آخر نسخة محفوظة (${offlineDataAge ? new Date(offlineDataAge).toLocaleString('ar-EG') : '—'}). التحصيل هيتسجّل محلياً ويتزامن تلقائياً لما الاتصال يرجع.
        </div>` : ''}

        ${(!isOfflineData && payments.length === 0) ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:12px">
            ⚠️ <strong>تنبيه:</strong> جدول التحصيل (<code>customer_payments</code>) لم يتم إنشاؤه بعد في قاعدة البيانات، أو لا يحتوي على Trigger.
            شغّل الـ Migration أولاً، وأنشئ الـ Trigger لكي تتحرّك الخزنة وأرصدة العملاء تلقائياً عند كل تحصيل.
        </div>` : ''}

        <div class="mod-grid">
            <div class="mod-card"><div class="mod-card-icon" style="background:#D1FAE5;color:#059669">💵</div><div class="mod-card-val">${colFmt(totalCollected)}</div><div class="mod-card-lbl">إجمالي المحصّل</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#E0E7FF;color:#4F46E5">📊</div><div class="mod-card-val">${payments.length}</div><div class="mod-card-lbl">سند قبض</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FEF3C7;color:#D97706">📋</div><div class="mod-card-val">${colFmt(totalDebt)}</div><div class="mod-card-lbl">مستحق من العملاء (${debtCustomers.length})</div></div>
        </div>

        ${colDebtListHTML(debtCustomers)}

        <div class="mod-table-wrap" style="margin-top:16px">
            <table class="mod-table"><thead><tr>
                <th>الرقم</th><th>العميل</th><th>التاريخ</th><th style="text-align:left">المبلغ</th><th>الحالة</th><th></th>
            </tr></thead>
            <tbody>
                ${displayRows.length === 0 ? `<tr><td colspan="6" class="empty-state"><span>💵</span>لا توجد تحصيلات.</td></tr>` :
                displayRows.map(p => `<tr>
                    <td><span style="background:#F1F5F9;padding:3px 8px;border-radius:5px;font-size:11px;font-family:monospace">${p.ref||'—'}</span></td>
                    <td><strong>${p.customers?.name || '—'}</strong></td>
                    <td>${new Date(p.created_at).toLocaleDateString('ar-EG')}</td>
                    <td style="text-align:left;font-weight:700;color:#059669">${colFmt(p.amount)}</td>
                    <td>${p._queue
                        ? (p.status === 'failed' ? '<span style="color:#DC2626;font-weight:600">❌ فشلت المزامنة</span>' : '<span style="color:#D97706;font-weight:600">⏳ غير مُزامن</span>')
                        : (p.status==='confirmed'?'<span style="color:#059669;font-weight:600">✅ مؤكد</span>':`<span style="color:#D97706">${p.status}</span>`)}</td>
                    <td>${p._queue ? '' : `<button class="cc-edit" onclick="colPrintVoucher('${p.id}')">🖨️</button>`}</td>
                </tr>`).join('')}
            </tbody></table>
        </div>
    `;
}

// تقدير محلي تراكمي لرصيد العملاء: يطرح كل عمليات التحصيل المعلّقة في
// الطابور (لسه ماتزامنتش) من الرصيد المعروض، عشان لو فتحت "تحصيل" تاني
// لنفس العميل وإنت أوفلاين تشوف أثر العملية السابقة في التقدير.
async function colApplyPendingEstimates(customers) {
    if (typeof getQueue !== 'function') return customers;
    try {
        const pending = await getQueue(e => e.module === 'collections' && (e.status === 'pending' || e.status === 'failed' || e.status === 'syncing'));
        if (!pending.length) return customers;
        const byCust = {};
        for (const e of pending) {
            byCust[e.payload.customer_id] = (byCust[e.payload.customer_id] || 0) + (Number(e.payload.amount) || 0);
        }
        return customers.map(c => byCust[c.id] ? { ...c, balance: (Number(c.balance) || 0) - byCust[c.id] } : c);
    } catch { return customers; }
}

function colDebtListHTML(debtCustomers) {
    if (!debtCustomers.length) return '';
    return `
    <div class="mod-card" style="margin-top:16px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <div class="mod-card-icon" style="background:#FEF3C7;color:#D97706;width:40px;height:40px;font-size:18px">📋</div>
            <div><div style="font-size:14px;font-weight:800">عملاء لهم مستحقات (مديونيات)</div><div style="font-size:11px;color:#64748B">اضغط "تحصيل" بجوار أي عميل لتحصيل المبلغ فوراً</div></div>
        </div>
        ${debtCustomers.slice(0,8).map(c => `<div class="cat-card">
            <div class="cc-ic">👤</div>
            <div class="cc-info">
                <div class="cc-name">${c.name}</div>
                <div class="cc-sub">${c.phone||''} ${c.code?'· '+c.code:''}</div>
            </div>
            <div class="cc-amt">
                <div class="used" style="color:#DC2626">${colFmt(c.balance)}</div>
                <div class="lim">مستحق</div>
            </div>
            <button class="cc-edit" style="background:#D1FAE5;color:#059669" onclick="colQuickCollect('${c.id}')">💵 تحصيل</button>
        </div>`).join('')}
    </div>`;
}

// ════════════════════════════════════════════════════════════
// 2) نافذة تحصيل دفعة
// ════════════════════════════════════════════════════════════
window.colOpenAdd = function(presetCustomerId = null) {
    _colSelectedId = presetCustomerId;
    const preset = presetCustomerId ? _colCustomers.find(x=>x.id===presetCustomerId) : null;

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'colModal';
    modal.innerHTML = `
        <div class="mod-modal">
            <div class="mod-modal-header"><h3>💵 تحصيل دفعة من عميل</h3>
                <button class="mod-modal-close" onclick="colCloseModal('colModal')">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>العميل *</label>
                    <select id="colCustId" class="mod-form-input" onchange="colOnCustChange()">
                        <option value="">-- اختر العميل --</option>
                        ${_colCustomers.map(c => `<option value="${c.id}" ${c.id===presetCustomerId?'selected':''}>${c.name} ${c.balance>0?'(مستحق '+colFmt(c.balance)+')':''}</option>`).join('')}
                    </select>
                </div>
                <div class="mod-form-group"><label>المبلغ المحصّل (ج.م) *</label>
                    <input type="number" id="colAmount" class="mod-form-input" placeholder="0.00" step="0.01" dir="ltr" value="${preset?colFmt(preset.balance):''}" oninput="colPreview()">
                </div>
                <div class="mod-form-group"><label>المرجع / البيان</label>
                    <input type="text" id="colRef" class="mod-form-input" placeholder="مثال: تحصيل على حساب فاتورة INV-0005">
                </div>
                <div id="colBalancePreview"></div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="colCloseModal('colModal')">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="colSave()">💾 تحصيل الدفعة</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    if (presetCustomerId) colPreview();
};

window.colQuickCollect = function(customerId) { colOpenAdd(customerId); };
window.colCloseModal = function(id) { const m = document.getElementById(id); if (m) m.remove(); };

window.colOnCustChange = function() {
    _colSelectedId = document.getElementById('colCustId').value;
    colPreview();
};

window.colPreview = function() {
    const cid = document.getElementById('colCustId').value;
    const amount = parseFloat(document.getElementById('colAmount').value) || 0;
    const area = document.getElementById('colBalancePreview');
    if (!cid || amount <= 0) { area.innerHTML = ''; return; }
    const c = _colCustomers.find(x=>x.id===cid);
    if (!c) return;
    const bal = Number(c.balance) || 0;
    const after = bal - amount;
    area.innerHTML = `
        <div class="limit-box" style="border-color:#D1FAE5;background:#ECFDF5">
            <div class="limit-row"><span class="lr-label">المستحق على العميل:</span><span class="lr-val" style="color:#DC2626">${colFmt(bal)} ج.م</span></div>
            <div class="limit-row"><span class="lr-label">هذا التحصيل:</span><span class="lr-val" style="color:#059669">${colFmt(amount)} ج.م</span></div>
            <div class="limit-row"><span class="lr-label">المستحق بعد التحصيل:</span><span class="lr-val" style="color:${after>0?'#D97706':'#059669'}">${colFmt(after)} ج.م</span></div>
        </div>`;
};

// ════════════════════════════════════════════════════════════
// 3) الحفظ — INSERT في customer_payments فقط
// ════════════════════════════════════════════════════════════
window.colSave = async function() {
    const custId = document.getElementById('colCustId').value;
    const amount = parseFloat(document.getElementById('colAmount').value);
    const ref = document.getElementById('colRef').value.trim();
    if (!custId) return alert('اختر العميل');
    if (!amount || amount <= 0) return alert('أدخل مبلغاً صحيحاً');

    const btn = document.querySelector('#colModal .mod-btn-primary');
    btn.innerText = 'جاري الحفظ...'; btn.disabled = true;

    if (typeof isOnline === 'function' && !isOnline()) {
        try {
            const cust = _colCustomers.find(x => x.id === custId);
            const estBalanceAfter = (Number(cust?.balance) || 0) - amount;
            await queueWrite({
                module: 'collections', kind: 'collection',
                payload: {
                    ref: ref || 'COL-' + Date.now(),
                    customer_id: custId, amount, status: 'confirmed',
                    created_by: currentUser?.id || null,
                    _estBalanceAfter: estBalanceAfter,
                },
            });
            colCloseModal('colModal');
            if (typeof offlineToast === 'function') offlineToast('⏳ اتسجّل محلياً — هيتزامن تلقائياً لما الاتصال يرجع', 'info');
            renderCollections(document.getElementById('app-content'));
        } catch (err) {
            alert('خطأ أثناء الحفظ المحلي: ' + err.message);
        } finally {
            btn.innerText = '💾 تحصيل الدفعة'; btn.disabled = false;
        }
        return;
    }

    try {
        // INSERT فقط — الـ Trigger (سيُنشأ لاحقاً) بيتكفّل بـ: زيادة الخزنة + تقليل رصيد العميل + القيد المحاسبي
        const { error } = await sb.from('customer_payments').insert({
            ref: ref || 'COL-' + Date.now(),
            customer_id: custId,
            amount,
            status: 'confirmed',
            created_by: currentUser?.id || null,
        });
        if (error) throw error;

        colCloseModal('colModal');
        try {
            const { data: cash } = await sb.rpc('get_cash_balance');
            const tb = document.getElementById('topbarCash');
            if (tb) tb.textContent = '💰 ' + (cash || 0).toFixed(2) + ' ج.م';
        } catch {}
        renderCollections(document.getElementById('app-content'));
    } catch (err) { alert('خطأ أثناء التحصيل: ' + err.message); }
    finally { btn.innerText = '💾 تحصيل الدفعة'; btn.disabled = false; }
};

// ════════════════════════════════════════════════════════════
// 5) مزامنة عمليات التحصيل المعلّقة (Phase 1 — دعم الأوفلاين)
// ════════════════════════════════════════════════════════════
if (typeof registerSyncHandler === 'function') {
    registerSyncHandler('collection', async (entry) => {
        const { _estBalanceAfter, ...payload } = entry.payload;
        try {
            const { error } = await sb.from('customer_payments').insert(payload);
            if (error) return { ok: false, error: error.message, summary: `تحصيل ${payload.ref}` };

            const flags = [];
            try {
                const { data: freshCust } = await sb.from('customers').select('balance').eq('id', payload.customer_id).maybeSingle();
                if (freshCust && _estBalanceAfter != null) {
                    const diff = Math.abs((Number(freshCust.balance) || 0) - Number(_estBalanceAfter));
                    if (diff > 0.01) flags.push(`الرصيد الفعلي بعد المزامنة (${colFmt(freshCust.balance)}) يختلف عن التقدير وقت الأوفلاين (${colFmt(_estBalanceAfter)})`);
                }
            } catch {}

            return { ok: true, summary: `تحصيل ${payload.ref} — ${colFmt(payload.amount)} ج.م`, flags };
        } catch (err) {
            return { ok: false, error: err.message || String(err), summary: `تحصيل ${payload.ref}` };
        }
    });
}

// ════════════════════════════════════════════════════════════
// 4) أدوات مساعدة
// ════════════════════════════════════════════════════════════
window.colPrintVoucher = async function(id) {
    const p = _colList.find(x=>x.id===id);
    if (!p) return;
    const balanceAfter = (Number(p.customers?.balance)||0);
    const balanceBefore = balanceAfter + Number(p.amount);
    await printThermalReceipt('collection', {
        ref: p.ref, entityName: p.customers?.name || '—', amount: p.amount,
        entityBalanceBefore: balanceBefore, entityBalanceAfter: balanceAfter,
    });
};

function colFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
