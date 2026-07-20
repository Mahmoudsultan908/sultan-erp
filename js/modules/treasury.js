/* ════════════════════════════════════════════════════════════
   الخزن (treasuries) — إدارة الخزن + تحويل بينها
   INSERT فقط في treasury_transfers — الـ trigger فى Postgres بيتولى
   إنشاء حركتي cash_transactions (خروج من المصدر + دخول للهدف). التحويل
   بين الخزن حركة نقدية داخلية بحتة من غير قيد محاسبي (حساب "النقدية"
   في شجرة الحسابات واحد بس — الخزن تقسيم تشغيلي مش حسابات GL منفصلة).
   يصدّر: renderTreasury(container)
   ════════════════════════════════════════════════════════════ */

let _tsyList = [];
let _tsyTransfers = [];
let _tsyRepByTreasury = {}; // treasury_id => اسم المندوب صاحب الخزنة دي

function tsyFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function renderTreasury(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الخزن...</div>';
    try {
        const [{ data: balances, error: balErr }, { data: transfers }, { data: reps }] = await Promise.all([
            sb.rpc('get_treasury_balances'),
            sb.from('treasury_transfers').select('*, from_t:from_treasury_id(name), to_t:to_treasury_id(name)')
                .order('created_at', { ascending: false }).limit(30),
            sb.from('sales_reps').select('id,name,treasury_id').eq('is_active', true),
        ]);
        if (balErr) throw balErr;

        _tsyList = balances || [];
        _tsyTransfers = transfers || [];
        // خزنة المصدر بتاعة تحويل = خزنة المندوب نفسه فى حالة "توريد" من
        // تطبيق سلطانو (راجع deposit handler هناك) — نستخدمها لمعرفة مين
        // المندوب اللي ورّد الكاش ده من غير ما نعتمد على created_by
        _tsyRepByTreasury = {};
        (reps || []).forEach(r => { if (r.treasury_id) _tsyRepByTreasury[r.treasury_id] = r.name; });

        c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
            <div><h2 style="font-size:22px;font-weight:800">🏦 الخزن</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">إدارة الخزن وأرصدتها والتحويل بينها</p></div>
            <button class="mod-btn mod-btn-primary" onclick="tsyOpenAddModal()">+ إضافة خزنة</button>
        </div>

        <div class="mod-grid">
            ${_tsyList.map(t => `<div class="mod-card">
                <div class="mod-card-icon" style="background:${t.is_default?'#FFFBEB':'#F1F5F9'};color:${t.is_default?'#D97706':'#475569'}">🏦</div>
                <div class="mod-card-val">${tsyFmt(t.balance)}</div>
                <div class="mod-card-lbl">${t.treasury_name} ${t.is_default ? '<span style="background:#FFFBEB;color:#D97706;font-size:10px;padding:2px 6px;border-radius:5px;margin-right:4px">افتراضية</span>' : ''}</div>
                <div style="display:flex;gap:6px;margin-top:8px">
                    <button class="cc-edit" style="background:#FFFBEB;color:#D97706" onclick="tsyShowStatement('${t.treasury_id}')">📄 كشف حساب</button>
                    ${!t.is_default ? `<button class="cc-edit" style="background:#FEE2E2;color:#DC2626" onclick="tsyToggleActive('${t.treasury_id}', true)">تعطيل الخزنة</button>` : ''}
                </div>
            </div>`).join('')}
        </div>

        <div class="mod-card" style="margin-top:16px;max-width:600px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
                <div class="mod-card-icon" style="background:#F0FDF4;color:#059669;width:40px;height:40px;font-size:18px">🔀</div>
                <div style="font-size:15px;font-weight:800">تحويل بين الخزن</div>
            </div>
            <div class="mod-form-group"><label>من خزنة *</label>
                <select id="tsyFrom" class="mod-form-input">
                    <option value="">-- اختر --</option>
                    ${_tsyList.map(t => `<option value="${t.treasury_id}">${t.treasury_name} (${tsyFmt(t.balance)})</option>`).join('')}
                </select>
            </div>
            <div class="mod-form-group"><label>إلى خزنة *</label>
                <select id="tsyTo" class="mod-form-input">
                    <option value="">-- اختر --</option>
                    ${_tsyList.map(t => `<option value="${t.treasury_id}">${t.treasury_name} (${tsyFmt(t.balance)})</option>`).join('')}
                </select>
            </div>
            <div class="mod-form-group"><label>المبلغ (ج.م) *</label>
                <input type="number" id="tsyAmount" class="mod-form-input" placeholder="0.00" step="0.01" dir="ltr">
            </div>
            <div class="mod-form-group"><label>ملاحظات</label>
                <input type="text" id="tsyNotes" class="mod-form-input" placeholder="اختياري">
            </div>
            <button class="mod-btn mod-btn-primary" style="width:100%" onclick="tsyExecuteTransfer()">🔀 تنفيذ التحويل</button>
        </div>

        <div class="mod-table-wrap" style="margin-top:16px">
            <table class="mod-table"><thead><tr>
                <th>التاريخ</th><th>من</th><th>إلى</th><th style="text-align:left">المبلغ</th><th>ملاحظات</th>
            </tr></thead>
            <tbody>
                ${_tsyTransfers.length === 0 ? `<tr><td colspan="5" class="empty-state"><span>🔀</span>لا توجد تحويلات بعد.</td></tr>` :
                _tsyTransfers.map(t => {
                    const repName = _tsyRepByTreasury[t.from_treasury_id];
                    return `<tr>
                    <td>${new Date(t.created_at).toLocaleString('ar-EG', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</td>
                    <td>${t.from_t?.name || '—'}${repName ? ` <span style="font-size:11px;color:#2563EB">🚗 ${repName}</span>` : ''}</td>
                    <td>${t.to_t?.name || '—'}</td>
                    <td style="text-align:left;font-weight:700">${tsyFmt(t.amount)}</td>
                    <td>${t.notes || '—'}</td>
                </tr>`;
                }).join('')}
            </tbody></table>
        </div>`;
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

window.tsyOpenAddModal = function() {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'tsyAddModal';
    modal.innerHTML = `
        <div class="mod-modal">
            <div class="mod-modal-header"><h3>+ إضافة خزنة</h3>
                <button class="mod-modal-close" onclick="tsyCloseModal()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>اسم الخزنة *</label>
                    <input type="text" id="tsyNewName" class="mod-form-input" placeholder="مثال: خزنة الفرع الثاني">
                </div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="tsyCloseModal()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="tsySaveNew()">💾 حفظ</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.tsyCloseModal = function() { const m = document.getElementById('tsyAddModal'); if (m) m.remove(); };

window.tsySaveNew = async function() {
    const name = document.getElementById('tsyNewName').value.trim();
    if (!name) return alert('أدخل اسم الخزنة');

    const btn = document.querySelector('#tsyAddModal .mod-btn-primary');
    btn.innerText = 'جاري الحفظ...'; btn.disabled = true;
    try {
        const { error } = await sb.from('treasuries').insert({ name, is_active: true, is_default: false });
        if (error) throw error;
        tsyCloseModal();
        renderTreasury(document.getElementById('app-content'));
    } catch (err) { alert('خطأ أثناء الحفظ: ' + err.message); }
    finally { btn.innerText = '💾 حفظ'; btn.disabled = false; }
};

// كشف حساب خزنة — بيفتح شاشة "حركة الخزينة التفصيلية" (cash-movement.js)
// مفلترة على الخزنة دي بس، بنفس فكرة custGoToDoc فى customers.js (pending
// flag + كليك على عنصر القائمة الجانبية)
window.tsyShowStatement = function(treasuryId) {
    window._pendingTreasuryFilter = treasuryId;
    document.querySelector('[data-mod="cash-movement"]')?.click();
};

window.tsyToggleActive = async function(treasuryId, currentlyActive) {
    if (!confirm(currentlyActive ? 'تعطيل هذه الخزنة؟ لن تظهر كخيار في العمليات الجديدة.' : 'إعادة تفعيل هذه الخزنة؟')) return;
    try {
        const { error } = await sb.from('treasuries').update({ is_active: !currentlyActive }).eq('id', treasuryId);
        if (error) throw error;
        renderTreasury(document.getElementById('app-content'));
    } catch (err) { alert('خطأ: ' + err.message); }
};

window.tsyExecuteTransfer = async function() {
    const fromId = document.getElementById('tsyFrom').value;
    const toId = document.getElementById('tsyTo').value;
    const amount = parseFloat(document.getElementById('tsyAmount').value);
    const notes = document.getElementById('tsyNotes').value.trim();

    if (!fromId || !toId) return alert('اختر الخزنتين');
    if (fromId === toId) return alert('لازم تختار خزنتين مختلفتين');
    if (!amount || amount <= 0) return alert('أدخل مبلغاً صحيحاً');

    const btn = [...document.querySelectorAll('.mod-btn-primary')].find(b => b.textContent.includes('تنفيذ التحويل'));
    if (btn) { btn.textContent = 'جاري التحويل...'; btn.disabled = true; }

    try {
        const { error } = await sb.from('treasury_transfers').insert({
            from_treasury_id: fromId, to_treasury_id: toId, amount,
            notes: notes || null, created_by: currentUser?.id || null,
        });
        if (error) throw error;
        renderTreasury(document.getElementById('app-content'));
    } catch (err) { alert('خطأ أثناء التحويل: ' + err.message); }
    finally { if (btn) { btn.textContent = '🔀 تنفيذ التحويل'; btn.disabled = false; } }
};

Object.assign(window, { renderTreasury });
