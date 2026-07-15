/* ════════════════════════════════════════════════════════════
   المندوبون — sales-reps.js
   إدارة مندوبي المبيعات + ربطهم بفواتير المبيعات (sales.rep_id)
   يصدّر: renderSalesReps(container)

   الجدول: sales_reps (راجع ملف sales_reps_migration.sql المرفق)
   ربط الفاتورة بالمندوب بيتم من داخل شاشة فاتورة المبيعات (sales.js)
   عبر قائمة اختيار المندوب في الرأس — هنا بس إدارة بيانات المندوبين
   ومتابعة أداء كل واحد منهم (عدد الفواتير / إجمالي المبيعات / العمولة).
   ════════════════════════════════════════════════════════════ */

let _repList = [];
let _repSales = [];      // كل فواتير sales اللي ليها rep_id (للتقارير هنا فقط)
let _repReturns = [];    // مرتجعات مبيعات ليها نفس rep_id — بتتطرح من مبيعات/عمولة المندوب
let _repSearch = '';
let _repEditingId = null;
let _repTableMissing = false;

function repFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي
// ════════════════════════════════════════════════════════════
async function renderSalesReps(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل بيانات المندوبين...</div>';
    _repTableMissing = false;
    try {
        try {
            const { data, error } = await sb.from('sales_reps').select('*').order('name');
            if (error) throw error;
            _repList = data || [];
        } catch (e) {
            _repTableMissing = true;
            _repList = [];
        }

        const { data: sales } = await sb.from('sales')
            .select('id, total, rep_id, payment_type, status, created_at')
            .not('rep_id', 'is', null);
        _repSales = (sales || []).filter(s => s.status === 'confirmed');

        // مرتجعات مبيعات مربوطة بمندوب — لازم تتطرح من إجمالي مبيعاته وعمولته
        // (راجع sales_returns_rep_id_migration.sql)، وإلا مرتجع باسم المندوب
        // مايأثرش على أرقامه هنا خالص.
        try {
            const { data: returns } = await sb.from('sales_returns')
                .select('id, total, rep_id, status, created_at')
                .not('rep_id', 'is', null);
            _repReturns = (returns || []).filter(r => r.status === 'confirmed');
        } catch { _repReturns = []; }

        repRenderPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function repStatsFor(repId) {
    const rows = _repSales.filter(s => s.rep_id === repId);
    const returns = _repReturns.filter(r => r.rep_id === repId);
    const total = rows.reduce((s, r) => s + (Number(r.total) || 0), 0) - returns.reduce((s, r) => s + (Number(r.total) || 0), 0);
    return { count: rows.length, total };
}

function repTopThisMonth() {
    const now = new Date();
    const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const byRep = {};
    _repSales.forEach(s => {
        if (!String(s.created_at || '').startsWith(ym)) return;
        byRep[s.rep_id] = (byRep[s.rep_id] || 0) + (Number(s.total) || 0);
    });
    _repReturns.forEach(r => {
        if (!String(r.created_at || '').startsWith(ym)) return;
        byRep[r.rep_id] = (byRep[r.rep_id] || 0) - (Number(r.total) || 0);
    });
    let bestId = null, bestVal = 0;
    Object.entries(byRep).forEach(([id, v]) => { if (v > bestVal) { bestVal = v; bestId = id; } });
    const rep = bestId ? _repList.find(r => r.id === bestId) : null;
    return { rep, total: bestVal };
}

function repRenderPage(c) {
    const activeReps = _repList.filter(r => r.is_active !== false);
    const totalSalesAll = _repSales.reduce((s, r) => s + (Number(r.total) || 0), 0) - _repReturns.reduce((s, r) => s + (Number(r.total) || 0), 0);
    const top = repTopThisMonth();

    c.innerHTML = `
    ${_repTableMissing ? `<div style="background:#FEF3C7;border:1px solid #FCD34D;color:#92400E;padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:12px">
        ⚠️ <strong>تنبيه:</strong> جدول <code>sales_reps</code> غير موجود في قاعدة البيانات بعد.
        شغّل ملف <code>sales_reps_migration.sql</code> في Supabase أولاً حتى تقدر تضيف مندوبين وتربطهم بالفواتير.
    </div>` : ''}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
        <div><h2 style="font-size:22px;font-weight:800">🚗 المندوبون</h2>
        <p style="font-size:13px;color:#64748B;margin-top:4px">إدارة مندوبي المبيعات ومتابعة أداء وعمولة كل مندوب</p></div>
        <button class="mod-btn mod-btn-primary" onclick="repOpenAdd()">+ مندوب جديد</button>
    </div>

    <div class="mod-grid">
        <div class="mod-card"><div class="mod-card-icon" style="background:#E0E7FF;color:#4F46E5">🚗</div><div class="mod-card-val">${activeReps.length}</div><div class="mod-card-lbl">مندوبون نشطون</div></div>
        <div class="mod-card"><div class="mod-card-icon" style="background:#FFFBEB;color:#D97706">🏆</div><div class="mod-card-val" style="font-size:16px">${top.rep ? top.rep.name : '—'}</div><div class="mod-card-lbl">مندوب الشهر (${repFmt(top.total)} ج.م)</div></div>
        <div class="mod-card"><div class="mod-card-icon" style="background:#D1FAE5;color:#059669">💰</div><div class="mod-card-val">${repFmt(totalSalesAll)}</div><div class="mod-card-lbl">إجمالي مبيعات المندوبين (كل الوقت)</div></div>
    </div>

    <div class="mod-card" style="margin:16px 0">
        <input type="text" id="repSearchInput" class="mod-form-input" style="margin:0" placeholder="🔍 بحث بالاسم أو الهاتف..." oninput="repOnSearch(this.value)">
    </div>

    <div class="mod-table-wrap">
        <table class="mod-table"><thead><tr>
            <th>المندوب</th><th>الهاتف</th><th style="text-align:center">العمولة%</th>
            <th style="text-align:center">عدد الفواتير</th><th style="text-align:left">إجمالي المبيعات</th>
            <th style="text-align:left">العمولة المستحقة</th><th>الحالة</th><th></th>
        </tr></thead>
        <tbody id="repTbody"></tbody></table>
    </div>`;
    repRenderRows();
}

function repRenderRows() {
    const tbody = document.getElementById('repTbody');
    if (!tbody) return;
    let rows = _repList;
    if (_repSearch) {
        const q = _repSearch.toLowerCase();
        rows = rows.filter(r => (r.name || '').toLowerCase().includes(q) || (r.phone || '').includes(q));
    }
    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="8" class="empty-state"><span>🚗</span>لا يوجد مندوبون بعد — ابدأ بإضافة أول مندوب</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(r => {
        const { count, total } = repStatsFor(r.id);
        const commission = total * (Number(r.commission_pct) || 0) / 100;
        const active = r.is_active !== false;
        return `<tr>
            <td><strong>${r.name}</strong></td>
            <td dir="ltr" style="text-align:right;color:#64748B">${r.phone || '—'}</td>
            <td style="text-align:center">${Number(r.commission_pct) || 0}%</td>
            <td style="text-align:center">${count}</td>
            <td style="text-align:left;font-weight:700">${repFmt(total)}</td>
            <td style="text-align:left;font-weight:700;color:#059669">${repFmt(commission)}</td>
            <td><span style="font-size:11px;padding:3px 10px;border-radius:50px;background:${active ? '#D1FAE5' : '#FEE2E2'};color:${active ? '#065F46' : '#991B1B'}">${active ? 'نشط' : 'معطّل'}</span></td>
            <td style="text-align:center;white-space:nowrap">
                <button class="cc-edit" onclick="repShowStatement('${r.id}')" title="كشف مبيعات">📄</button>
                <button class="cc-edit" onclick="repOpenEdit('${r.id}')" title="تعديل">✏️</button>
                <button class="cc-edit" style="background:${active ? '#FEE2E2' : '#D1FAE5'};color:${active ? '#DC2626' : '#059669'}" onclick="repToggleActive('${r.id}', ${!active})" title="${active ? 'تعطيل' : 'تفعيل'}">${active ? '🚫' : '✅'}</button>
            </td>
        </tr>`;
    }).join('');
}

window.repOnSearch = function (v) { _repSearch = v; repRenderRows(); };

// ════════════════════════════════════════════════════════════
// 2) إضافة / تعديل مندوب
// ════════════════════════════════════════════════════════════
window.repOpenAdd = function () { _repEditingId = null; repOpenModal(null); };
window.repOpenEdit = function (id) { const r = _repList.find(x => x.id === id); if (r) { _repEditingId = id; repOpenModal(r); } };

function repOpenModal(x) {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'repModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:440px">
            <div class="mod-modal-header"><h3>${x ? '✏️ تعديل مندوب' : '🚗 إضافة مندوب جديد'}</h3>
                <button class="mod-modal-close" onclick="document.getElementById('repModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>اسم المندوب *</label>
                    <input type="text" id="repName" class="mod-form-input" value="${x?.name || ''}" placeholder="اسم المندوب"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>الهاتف</label>
                        <input type="text" id="repPhone" class="mod-form-input" value="${x?.phone || ''}" dir="ltr"></div>
                    <div class="mod-form-group"><label>نسبة العمولة %</label>
                        <input type="number" id="repCommission" class="mod-form-input" value="${x?.commission_pct || 0}" min="0" max="100" step="0.1"></div>
                </div>
                <div class="mod-form-group"><label>ملاحظات</label>
                    <input type="text" id="repNotes" class="mod-form-input" value="${x?.notes || ''}" placeholder="اختياري"></div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('repModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="repSave()">💾 ${x ? 'حفظ التعديلات' : 'إضافة المندوب'}</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    setTimeout(() => document.getElementById('repName')?.focus(), 50);
}

window.repSave = async function () {
    const name = document.getElementById('repName').value.trim();
    if (!name) return alert('اسم المندوب مطلوب');

    const payload = {
        name,
        phone: document.getElementById('repPhone').value.trim() || null,
        commission_pct: parseFloat(document.getElementById('repCommission').value) || 0,
        notes: document.getElementById('repNotes').value.trim() || null,
    };

    const btn = document.querySelector('#repModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        if (_repEditingId) {
            const { error } = await sb.from('sales_reps').update(payload).eq('id', _repEditingId);
            if (error) throw error;
        } else {
            const { error } = await sb.from('sales_reps').insert({ ...payload, is_active: true, created_by: currentUser?.id || null });
            if (error) throw error;
        }
        document.getElementById('repModal').remove();
        renderSalesReps(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ: ' + err.message + (_repTableMissing ? '\n\nتأكد من تشغيل ملف sales_reps_migration.sql في Supabase.' : ''));
        btn.innerText = '💾 حفظ'; btn.disabled = false;
    }
};

window.repToggleActive = async function (id, newState) {
    try {
        const { error } = await sb.from('sales_reps').update({ is_active: newState }).eq('id', id);
        if (error) throw error;
        renderSalesReps(document.getElementById('app-content'));
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

// ════════════════════════════════════════════════════════════
// 3) كشف مبيعات مندوب (مودال)
// ════════════════════════════════════════════════════════════
window.repShowStatement = async function (repId) {
    const rep = _repList.find(r => r.id === repId);
    if (!rep) return;

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'repStmtModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:760px">
            <div class="mod-modal-header"><h3>📄 كشف مبيعات — ${rep.name}</h3>
                <button class="mod-modal-close" onclick="document.getElementById('repStmtModal').remove()">&times;</button></div>
            <div class="mod-modal-body" id="repStmtBody">
                <div class="empty-state"><span>⏳</span>جاري تجميع الفواتير...</div>
            </div>
        </div>`;
    document.body.appendChild(modal);

    try {
        const [{ data: sales }, { data: returns }] = await Promise.all([
            sb.from('sales')
                .select('invoice_no, total, payment_type, status, created_at, customers(name)')
                .eq('rep_id', repId).order('created_at', { ascending: false }).limit(200),
            sb.from('sales_returns')
                .select('return_no, total, status, created_at, customers(name)')
                .eq('rep_id', repId).order('created_at', { ascending: false }).limit(200),
        ]);

        const rows = (sales || []).filter(s => s.status === 'confirmed');
        const retRows = (returns || []).filter(r => r.status === 'confirmed');
        const salesTotal = rows.reduce((s, r) => s + (Number(r.total) || 0), 0);
        const returnsTotal = retRows.reduce((s, r) => s + (Number(r.total) || 0), 0);
        const total = salesTotal - returnsTotal;
        const commission = total * (Number(rep.commission_pct) || 0) / 100;

        document.getElementById('repStmtBody').innerHTML = `
            <div class="mod-grid" style="margin-bottom:16px">
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:#64748B;margin-bottom:4px">عدد الفواتير</div>
                    <div style="font-size:22px;font-weight:800">${rows.length}</div>
                </div>
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:#64748B;margin-bottom:4px">صافي المبيعات (بعد ${repFmt(returnsTotal)} مرتجعات)</div>
                    <div style="font-size:22px;font-weight:800;color:#0F172A">${repFmt(total)}</div>
                </div>
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:#64748B;margin-bottom:4px">العمولة المستحقة (${Number(rep.commission_pct) || 0}%)</div>
                    <div style="font-size:22px;font-weight:800;color:#059669">${repFmt(commission)}</div>
                </div>
            </div>
            <div class="mod-table-wrap">
                <table class="mod-table"><thead><tr>
                    <th>رقم الفاتورة</th><th>العميل</th><th>نوع الدفع</th><th>التاريخ</th><th style="text-align:left">الإجمالي</th>
                </tr></thead>
                <tbody>
                    ${rows.length === 0 && retRows.length === 0 ? `<tr><td colspan="5" class="empty-state"><span>📭</span>لا توجد فواتير مرتبطة بهذا المندوب.</td></tr>` : ''}
                    ${rows.map(s => `<tr>
                        <td><span style="background:#F1F5F9;padding:2px 8px;border-radius:5px;font-size:11px;font-family:monospace">${s.invoice_no}</span></td>
                        <td>${s.customers?.name || 'نقدي'}</td>
                        <td>${s.payment_type === 'cash' ? '💵 نقدي' : '📋 آجل'}</td>
                        <td style="font-size:12px">${new Date(s.created_at).toLocaleDateString('ar-EG')}</td>
                        <td style="text-align:left;font-weight:700">${repFmt(s.total)}</td>
                    </tr>`).join('')}
                    ${retRows.map(r => `<tr>
                        <td><span style="background:#FEF2F2;padding:2px 8px;border-radius:5px;font-size:11px;font-family:monospace">${r.return_no}</span></td>
                        <td>${r.customers?.name || 'نقدي'}</td>
                        <td>↩️ مرتجع</td>
                        <td style="font-size:12px">${new Date(r.created_at).toLocaleDateString('ar-EG')}</td>
                        <td style="text-align:left;font-weight:700;color:#DC2626">-${repFmt(r.total)}</td>
                    </tr>`).join('')}
                </tbody></table>
            </div>`;
    } catch (err) {
        document.getElementById('repStmtBody').innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
};

Object.assign(window, {
    renderSalesReps, repOnSearch, repOpenAdd, repOpenEdit, repSave, repToggleActive, repShowStatement,
});
