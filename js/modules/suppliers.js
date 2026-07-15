/* ════════════════════════════════════════════════════════════
   الموردين + كشف الحساب — suppliers
   يعرض قائمة الموردين + كشف حساب لكل مورد
   مصادر الحركة: purchases (آجل/نقدي) + supplier_payments (دفعات)
   ════════════════════════════════════════════════════════════ */

let _supList = [];

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي — قائمة الموردين
// ════════════════════════════════════════════════════════════
async function renderSuppliers(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الموردين...</div>';
    try {
        const { data: suppliers } = await sb.from('suppliers').select('*').order('name');
        _supList = suppliers || [];

        const totalDebt = _supList.reduce((s,s2)=>s+(Number(s2.balance)>0?Number(s2.balance):0),0);
        const debtors = _supList.filter(s => Number(s.balance) > 0);

        c.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                <div><h2 style="font-size:22px;font-weight:800">🏭 الموردين</h2>
                <p style="font-size:13px;color:#64748B;margin-top:4px">إدارة الموردين وكشوف الحسابات</p></div>
            </div>

            <div class="mod-grid">
                <div class="mod-card"><div class="mod-card-icon" style="background:#FEF3C7;color:#D97706">🏭</div><div class="mod-card-val">${_supList.length}</div><div class="mod-card-lbl">إجمالي الموردين</div></div>
                <div class="mod-card"><div class="mod-card-icon" style="background:#FEE2E2;color:#DC2626">⚠️</div><div class="mod-card-val">${supFmt(totalDebt)}</div><div class="mod-card-lbl">مستحق للموردين (${debtors.length})</div></div>
                <div class="mod-card"><div class="mod-card-icon" style="background:#D1FAE5;color:#059669">✅</div><div class="mod-card-val">${_supList.filter(s=>Number(s.balance)<=0).length}</div><div class="mod-card-lbl">موردين بلا مستحقات</div></div>
            </div>

            <div class="mod-table-wrap" style="margin-top:16px">
                <table class="mod-table"><thead><tr>
                    <th>المورد</th><th>الهاتف</th>
                    <th style="text-align:left">المستحق</th>
                    <th style="text-align:center">إجراءات</th>
                </tr></thead>
                <tbody>
                    ${_supList.length === 0 ? `<tr><td colspan="4" class="empty-state"><span>🏭</span>لا يوجد موردين.</td></tr>` :
                    _supList.map(s => {
                        const bal = Number(s.balance)||0;
                        const balColor = bal > 0 ? '#DC2626' : '#059669';
                        return `<tr>
                            <td>
                                <div style="display:flex;align-items:center;gap:8px">
                                    <div style="width:32px;height:32px;border-radius:8px;background:#FEF3C7;display:flex;align-items:center;justify-content:center;font-size:14px">🏭</div>
                                    <div><div style="font-weight:600">${s.name}</div>${s.code?`<div style="font-size:11px;color:#94A3B8">${s.code}</div>`:''}</div>
                                </div>
                            </td>
                            <td dir="ltr" style="text-align:right;color:#64748B">${s.phone||'—'}</td>
                            <td style="text-align:left;font-weight:700;color:${balColor}">${supFmt(Math.abs(bal))}</td>
                            <td style="text-align:center">
                                <button class="cc-edit" onclick="supShowStatement('${s.id}')" style="background:#FFFBEB;color:#D97706">📄 كشف حساب</button>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody></table>
            </div>
        `;
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

// ════════════════════════════════════════════════════════════
// 2) كشف حساب مورد (مودال)
// ════════════════════════════════════════════════════════════
window.supShowStatement = async function(supplierId) {
    const sup = _supList.find(s=>s.id===supplierId);
    if (!sup) return;

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'supStmtModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:820px">
            <div class="mod-modal-header"><h3>📄 كشف حساب — ${sup.name}</h3>
                <div style="display:flex;align-items:center;gap:10px">
                    <button class="cc-edit" style="background:#FFFBEB;color:#D97706" onclick="supGoEditProfile('${sup.id}')">✏️ تعديل بيانات المورد</button>
                    <button class="mod-modal-close" onclick="supCloseModal('supStmtModal')">&times;</button>
                </div></div>
            <div class="mod-modal-body" id="supStmtBody">
                <div class="empty-state"><span>⏳</span>جاري تجميع الحركات...</div>
            </div>
        </div>`;
    document.body.appendChild(modal);

    try {
        // جلب حركات المورد بالتوازي — ★ دلوقتي بتشمل فواتير الشراء النقدية
        // والمرتجعات كمان (كانوا ناقصين). purchase_returns معندهاش عمود
        // payment_type بتاعها، فبنجيبه من الفاتورة الأصلية المرتبطة
        // (purchase_id) لو موجودة — لو المرتجع مش مرتبط بفاتورة، بيتعامل
        // معه كمعلومة بس من غير أثر على الرصيد (أأمن اختيار من غير تخمين).
        const [
            { data: purchases },
            { data: payments },
            { data: returns },
        ] = await Promise.all([
            sb.from('purchases').select('invoice_no, total, payment_type, status, created_at')
                .eq('supplier_id', supplierId).order('created_at', { ascending: true }),
            sb.from('supplier_payments').select('ref, amount, status, created_at')
                .eq('supplier_id', supplierId).order('created_at', { ascending: true }),
            sb.from('purchase_returns').select('return_no, total, status, created_at, purchases(payment_type)')
                .eq('supplier_id', supplierId).order('created_at', { ascending: true }).limit(100),
        ]);

        // دمج الحركات + رصيد متحرك
        // منطق المورد: الشراء الآجل = دائن (لنا عليه)، الدفع = مدين (نسدده)،
        // مرتجع شراء آجل = مدين (بيقلل اللي علينا)
        const moves = [];
        (purchases||[]).forEach(p => {
            if (p.status !== 'confirmed') return;
            if (p.payment_type === 'credit') {
                moves.push({ date: p.created_at, desc: `فاتورة شراء ${p.invoice_no}`, debit: 0, credit: Number(p.total)||0, type: 'purchase-credit' });
            } else {
                moves.push({ date: p.created_at, desc: `فاتورة شراء نقدي ${p.invoice_no}`, debit: 0, credit: 0, type: 'purchase-cash' });
            }
        });
        (returns||[]).forEach(r => {
            if (r.status !== 'confirmed') return;
            if (r.purchases?.payment_type === 'credit') {
                moves.push({ date: r.created_at, desc: `مرتجع شراء ${r.return_no}`, debit: Number(r.total)||0, credit: 0, type: 'return-credit' });
            } else {
                moves.push({ date: r.created_at, desc: `مرتجع شراء ${r.return_no}`, debit: 0, credit: 0, type: 'return-cash' });
            }
        });
        (payments||[]).forEach(p => {
            if (p.status === 'confirmed') {
                moves.push({ date: p.created_at, desc: `سداد ${p.ref||''}`, debit: Number(p.amount)||0, credit: 0, type: 'payment' });
            }
        });
        moves.sort((a,b) => new Date(a.date) - new Date(b.date));

        let running = 0;
        moves.forEach(m => { running += (m.credit - m.debit); m.balance = running; });

        const balNow = Number(sup.balance)||0;
        const totalDebit = moves.reduce((s,m)=>s+m.debit,0);   // المدفوع للمورد
        const totalCredit = moves.reduce((s,m)=>s+m.credit,0); // المشتريات الآجلة

        document.getElementById('supStmtBody').innerHTML = `
            <div class="mod-grid" style="margin-bottom:16px">
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:#64748B;margin-bottom:4px">المستحق حالياً</div>
                    <div style="font-size:22px;font-weight:800;color:${balNow>0?'#DC2626':'#059669'}">${supFmt(Math.abs(balNow))} ج.م</div>
                    <div style="font-size:11.5px;color:#94A3B8">${balNow>0?'مستحق عليه لنا':balNow<0?'لنا عنده (مقدم)':'مسدد'}</div>
                </div>
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:#64748B;margin-bottom:4px">إجمالي المشتريات (آجل)</div>
                    <div style="font-size:22px;font-weight:800;color:#0F172A">${supFmt(totalCredit)}</div>
                </div>
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:#64748B;margin-bottom:4px">إجمالي المدفوع</div>
                    <div style="font-size:22px;font-weight:800;color:#059669">${supFmt(totalDebit)}</div>
                </div>
            </div>

            <div class="mod-table-wrap">
                <table class="mod-table"><thead><tr>
                    <th>التاريخ</th><th>البيان</th>
                    <th style="text-align:left">مدين (مدفوع)</th>
                    <th style="text-align:left">دائن (شراء)</th>
                    <th style="text-align:left">الرصيد</th>
                </tr></thead>
                <tbody>
                    ${moves.length === 0 ? `<tr><td colspan="5" class="empty-state"><span>📭</span>لا توجد حركات.</td></tr>` :
                    moves.map(m => {
                        const isCash = m.type.endsWith('-cash');
                        const bg = m.type==='purchase-credit' ? '#FEF3C7' : m.type==='payment' ? '#ECFDF5'
                            : m.type.startsWith('return') ? '#FFFBEB' : '#F8FAFC';
                        const icon = m.type==='purchase-credit' ? '<span style="color:#D97706">📥</span>'
                            : m.type==='purchase-cash' ? '<span style="color:#94A3B8">💰</span>'
                            : m.type.startsWith('return') ? '<span style="color:#DC2626">↩️</span>'
                            : '<span style="color:#059669">💸</span>';
                        return `<tr style="background:${bg}">
                        <td style="font-size:12px">${new Date(m.date).toLocaleDateString('ar-EG')}</td>
                        <td>
                            ${icon} ${m.desc}
                            ${isCash ? '<span style="font-size:11.5px;color:#94A3B8"> (نقدي — بدون أثر على الرصيد)</span>' : ''}
                        </td>
                        <td style="text-align:left;font-weight:600;color:#059669">${m.debit?supFmt(m.debit):'—'}</td>
                        <td style="text-align:left;font-weight:600;color:#D97706">${m.credit?supFmt(m.credit):'—'}</td>
                        <td style="text-align:left;font-weight:700">${supFmt(m.balance)}</td>
                    </tr>`;
                    }).join('')}
                </tbody>
                ${moves.length ? `<tfoot><tr style="background:#F8FAFC;font-weight:800">
                    <td colspan="2">الإجمالي</td>
                    <td style="text-align:left;color:#059669">${supFmt(totalDebit)}</td>
                    <td style="text-align:left;color:#D97706">${supFmt(totalCredit)}</td>
                    <td style="text-align:left">${supFmt(Math.abs(balNow))}</td>
                </tr></tfoot>` : ''}
                </table>
            </div>`;
    } catch (err) {
        document.getElementById('supStmtBody').innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
};

window.supCloseModal = function(id) { const m = document.getElementById(id); if (m) m.remove(); };

// ينقل لصفحة "إدارة الموردين" (master-data.js) ويفتح نافذة تعديل بيانات
// نفس المورد تلقائياً — نفس فكرة custGoEditProfile في customers.js.
window.supGoEditProfile = function(supplierId) {
    window._pendingSupplierEdit = supplierId;
    supCloseModal('supStmtModal');
    document.querySelector('[data-mod="suppliers-manage"]')?.click();
};

// ════════════════════════════════════════════════════════════
// 3) أدوات مساعدة
// ════════════════════════════════════════════════════════════
function supFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
