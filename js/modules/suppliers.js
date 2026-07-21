/* ════════════════════════════════════════════════════════════
   الموردين + كشف الحساب — suppliers
   يعرض قائمة الموردين + كشف حساب لكل مورد
   مصادر الحركة: purchases (آجل/نقدي) + supplier_payments (دفعات)
   ════════════════════════════════════════════════════════════ */

let _supList = [];
let _supStmtMoves = []; // الحركات الكاملة لكشف الحساب المفتوح — عشان خانة البحث تفلتر منها من غير ما تعيد الحساب من القاعدة

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

        // ★ جاي من بحث Ctrl+K (app.js) — افتح كشف حساب نفس المورد تلقائياً
        if (window._pendingSupplierStatement) {
            const pendId = window._pendingSupplierStatement;
            window._pendingSupplierStatement = null;
            supShowStatement(pendId);
        }
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
            { data: transfersOut },
            { data: transfersIn },
            { data: cashRefunds },
            { data: openingBalances },
            docsResult,
        ] = await Promise.all([
            sb.from('purchases').select('invoice_no, total, payment_type, status, created_at')
                .eq('supplier_id', supplierId).order('created_at', { ascending: true }),
            sb.from('supplier_payments').select('ref, amount, status, created_at')
                .eq('supplier_id', supplierId).order('created_at', { ascending: true }),
            sb.from('purchase_returns').select('return_no, total, status, created_at, purchases(payment_type)')
                .eq('supplier_id', supplierId).order('created_at', { ascending: true }).limit(100),
            // تحويلات رصيد بين موردين + استرداد نقدي من رصيد مورد لخزنة — كانوا
            // ناقصين تمامًا من الكشف (راجع fn_balance_transfer_apply للاتجاهات)
            sb.from('balance_transfers').select('id, to_s:to_supplier_id(name), amount, notes, created_at')
                .eq('from_supplier_id', supplierId).eq('transfer_type', 'supplier_to_supplier')
                .order('created_at', { ascending: true }),
            sb.from('balance_transfers').select('id, from_s:from_supplier_id(name), amount, notes, created_at')
                .eq('to_supplier_id', supplierId).eq('transfer_type', 'supplier_to_supplier')
                .order('created_at', { ascending: true }),
            sb.from('balance_transfers').select('id, amount, notes, created_at')
                .eq('from_supplier_id', supplierId).eq('transfer_type', 'supplier_to_treasury')
                .order('created_at', { ascending: true }),
            sb.from('opening_balances').select('id, amount, as_of_date, notes')
                .eq('supplier_id', supplierId).eq('balance_type', 'supplier').eq('status', 'confirmed'),
            // اختياري — لو جدول archive_documents لسه ما اتعملش، نتجاهل الخطأ بهدوء
            sb.from('archive_documents').select('id,title,file_url,category,created_at')
                .eq('linked_type', 'supplier').eq('linked_id', supplierId)
                .order('created_at', { ascending: false }).then(r => r, () => ({ data: [] })),
        ]);
        const docs = docsResult?.data || [];

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
        // تحويل رصيد "من" المورد ده لمورد تاني: بيقلل رصيده — راجع
        // fn_balance_transfer_apply (balance = balance - amount للمصدر)
        (transfersOut||[]).forEach(t => {
            moves.push({ date: t.created_at, desc: `تحويل رصيد إلى ${t.to_s?.name || '—'}${t.notes ? ' — '+t.notes : ''}`, debit: Number(t.amount)||0, credit: 0, type: 'transfer-out' });
        });
        // تحويل رصيد "إلى" المورد ده من مورد تاني: بيزود رصيده
        (transfersIn||[]).forEach(t => {
            moves.push({ date: t.created_at, desc: `تحويل رصيد من ${t.from_s?.name || '—'}${t.notes ? ' — '+t.notes : ''}`, debit: 0, credit: Number(t.amount)||0, type: 'transfer-in' });
        });
        // استرداد نقدي من رصيد مورد للخزنة — راجع fn_balance_transfer_apply
        // (balance = balance + amount للمورد، supplier_to_treasury)
        (cashRefunds||[]).forEach(t => {
            moves.push({ date: t.created_at, desc: `استرداد نقدي لخزنة${t.notes ? ' — '+t.notes : ''}`, debit: 0, credit: Number(t.amount)||0, type: 'cash-refund' });
        });
        // رصيد افتتاحي — راجع fn_opening_balance_status_change (balance += amount)
        (openingBalances||[]).forEach(o => {
            const amt = Number(o.amount) || 0;
            moves.push({ date: o.as_of_date, desc: `رصيد افتتاحي${o.notes ? ' — '+o.notes : ''}`, debit: Math.max(-amt,0), credit: Math.max(amt,0), type: 'opening' });
        });
        moves.sort((a,b) => new Date(a.date) - new Date(b.date));

        const balNow = Number(sup.balance)||0;
        const totalDebit = moves.reduce((s,m)=>s+m.debit,0);   // المدفوع للمورد
        const totalCredit = moves.reduce((s,m)=>s+m.credit,0); // المشتريات الآجلة

        // ★ نفس الحل الجذري المستخدم فى كشف حساب العميل (customers.js) —
        //   موردين منقولين من نظام قديم برصيد مباشر من غير تاريخ عمليات
        //   وراه. سطر صناعي واحد يصالح الرصيد المتحرك مع suppliers.balance
        //   الحقيقي، من غير أي لمس لقاعدة البيانات.
        const displayMoves = [...moves];
        const rawTotal = moves.reduce((s,m)=>s+(m.credit-m.debit),0);
        const legacyDiff = balNow - rawTotal;
        if (Math.abs(legacyDiff) > 0.01) {
            // لازم يتحط قبل أول حركة حقيقية زمنيًا — مش وقت إنشاء سجل المورد
            // نفسه فى سلطان (وقت الهجرة)، راجع نفس الملاحظة فى customers.js
            const earliestDate = moves.length ? new Date(new Date(moves[0].date).getTime() - 1000).toISOString() : (sup.created_at || new Date(0).toISOString());
            displayMoves.push({
                date: earliestDate,
                desc: 'رصيد مرحّل من النظام القديم (قبل سلطان)',
                debit: Math.max(-legacyDiff, 0), credit: Math.max(legacyDiff, 0),
                type: 'legacy-carry',
            });
        }
        displayMoves.sort((a,b) => new Date(a.date) - new Date(b.date));

        let running = 0;
        displayMoves.forEach(m => { running += (m.credit - m.debit); m.balance = running; });
        const tableDebit = displayMoves.reduce((s,m)=>s+m.debit,0);
        const tableCredit = displayMoves.reduce((s,m)=>s+m.credit,0);

        _supStmtMoves = displayMoves;

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

            <input type="text" id="supStmtSearch" class="mod-form-input" style="margin-bottom:10px" placeholder="🔍 بحث في الحركات (اسم الفاتورة/المرتجع/البيان)..." oninput="supStmtFilterRows(this.value)">
            <div class="mod-table-wrap">
                <table class="mod-table"><thead><tr>
                    <th>التاريخ</th><th>البيان</th>
                    <th style="text-align:left">مدين (مدفوع)</th>
                    <th style="text-align:left">دائن (شراء)</th>
                    <th style="text-align:left">الرصيد</th>
                </tr></thead>
                <tbody id="supStmtTbody">${supStmtRowsHtml(displayMoves)}</tbody>
                ${displayMoves.length ? `<tfoot><tr style="background:#F8FAFC;font-weight:800">
                    <td colspan="2">الإجمالي</td>
                    <td style="text-align:left;color:#059669">${supFmt(tableDebit)}</td>
                    <td style="text-align:left;color:#D97706">${supFmt(tableCredit)}</td>
                    <td style="text-align:left">${supFmt(Math.abs(balNow))}</td>
                </tr></tfoot>` : ''}
                </table>
            </div>
            ${Math.abs(legacyDiff) > 0.01 ? `
            <div style="background:#F1F5F9;border:1px solid #E2E8F0;color:#475569;padding:10px 14px;border-radius:10px;margin-top:10px;font-size:12px">
                🗄️ سطر "رصيد مرحّل من النظام القديم" (${supFmt(Math.abs(legacyDiff))}) هو الفرق بين رصيد المورد الحقيقي وحركاته المسجّلة فعليًا فى سلطان —
                غالبًا مورد منقول من نظام قديم برصيد بداية من غير تفاصيل مستندات. رصيد المورد نفسه صحيح، السطر ده للعرض بس ومفيهوش أي تعديل على البيانات.
            </div>` : ''}

            <div style="margin-top:16px">
                <div style="font-size:13px;font-weight:800;color:#1E293B;margin-bottom:8px">📁 المستندات المرتبطة (${docs.length})</div>
                ${docs.length === 0 ? `<div style="font-size:12.5px;color:#94A3B8">لا توجد مستندات مرتبطة بهذا المورد في الأرشيف.</div>` :
                `<div style="display:flex;flex-wrap:wrap;gap:8px">
                    ${docs.map(d => `<a href="${d.file_url}" target="_blank" rel="noopener" class="cc-edit" style="background:#FFFBEB;color:#D97706;text-decoration:none">📄 ${d.title}${d.category?' ('+d.category+')':''}</a>`).join('')}
                </div>`}
            </div>`;
    } catch (err) {
        document.getElementById('supStmtBody').innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
};

window.supCloseModal = function(id) { const m = document.getElementById(id); if (m) m.remove(); };

// بناء صفوف جدول كشف الحساب — دالة منفصلة عشان تتنادى من العرض الأول
// ومن supStmtFilterRows (البحث) من غير تكرار كود
function supStmtRowsHtml(moves) {
    if (!moves.length) return `<tr><td colspan="5" class="empty-state"><span>📭</span>لا توجد حركات.</td></tr>`;
    return moves.map(m => {
        const isCash = m.type.endsWith('-cash');
        const bg = m.type==='purchase-credit' ? '#FEF3C7' : m.type==='payment' ? '#ECFDF5'
            : m.type.startsWith('return') ? '#FFFBEB'
            : m.type==='transfer-out' || m.type==='transfer-in' || m.type==='cash-refund' ? '#EFF6FF'
            : m.type==='opening' ? '#F5F3FF'
            : m.type==='legacy-carry' ? '#F1F5F9' : '#F8FAFC';
        const icon = m.type==='purchase-credit' ? '<span style="color:#D97706">📥</span>'
            : m.type==='purchase-cash' ? '<span style="color:#94A3B8">💰</span>'
            : m.type.startsWith('return') ? '<span style="color:#DC2626">↩️</span>'
            : m.type==='transfer-out' || m.type==='transfer-in' ? '<span style="color:#2563EB">🔀</span>'
            : m.type==='cash-refund' ? '<span style="color:#2563EB">💰</span>'
            : m.type==='opening' ? '<span style="color:#7C3AED">📋</span>'
            : m.type==='legacy-carry' ? '<span style="color:#64748B">🗄️</span>'
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
    }).join('');
}

window.supStmtFilterRows = function(query) {
    const q = (query || '').trim().toLowerCase();
    const filtered = q ? _supStmtMoves.filter(m => (m.desc || '').toLowerCase().includes(q)) : _supStmtMoves;
    const tbody = document.getElementById('supStmtTbody');
    if (tbody) tbody.innerHTML = supStmtRowsHtml(filtered);
};

// ينقل لصفحة "إدارة الموردين" (master-data.js) ويفتح نافذة تعديل بيانات
// نفس المورد تلقائياً — نفس فكرة custGoEditProfile في customers.js.
window.supGoEditProfile = function(supplierId) {
    window._pendingSupplierEdit = supplierId;
    window._pendingSuppHubTab = 'manage';
    supCloseModal('supStmtModal');
    document.querySelector('[data-mod="suppliers-hub"]')?.click();
};

// ════════════════════════════════════════════════════════════
// 3) أدوات مساعدة
// ════════════════════════════════════════════════════════════
function supFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
