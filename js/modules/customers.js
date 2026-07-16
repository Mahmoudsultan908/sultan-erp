/* ════════════════════════════════════════════════════════════
   العملاء + كشف الحساب — customers
   يعرض قائمة العملاء + تفاصيل/كشف حساب لكل عميل
   مصادر الحركة: sales (آجل/نقدي) + customer_payments (تحصيلات)
   ════════════════════════════════════════════════════════════ */

let _custList = [];

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي — قائمة العملاء
// ════════════════════════════════════════════════════════════
async function renderCustomers(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل العملاء...</div>';
    try {
        const [{ data: customers }, { data: regions }, interactionsResult] = await Promise.all([
            sb.from('customers').select('*').order('name'),
            sb.from('customer_regions').select('id,name'),
            // اختياري — لو جدول customer_interactions لسه ما اتعملش، نتجاهل الخطأ بهدوء
            sb.from('customer_interactions').select('customer_id, interaction_date').then(r => r, () => ({ data: [] })),
        ]);
        _custList = customers || [];
        const regionMap = {};
        (regions || []).forEach(r => { regionMap[r.id] = r.name; });
        // آخر تفاعل لكل عميل — أحدث interaction_date من customer_interactions
        const lastInteractionMap = {};
        (interactionsResult?.data || []).forEach(x => {
            if (!lastInteractionMap[x.customer_id] || x.interaction_date > lastInteractionMap[x.customer_id]) {
                lastInteractionMap[x.customer_id] = x.interaction_date;
            }
        });

        const totalDebt = _custList.reduce((s,c)=>s+(Number(c.balance)>0?Number(c.balance):0),0);
        const totalCredit = _custList.reduce((s,c)=>s+(Number(c.balance)<0?Math.abs(Number(c.balance)):0),0);
        const debtors = _custList.filter(c => Number(c.balance) > 0);

        c.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                <div><h2 style="font-size:22px;font-weight:800">👥 العملاء</h2>
                <p style="font-size:13px;color:#64748B;margin-top:4px">إدارة العملاء وكشوف الحسابات</p></div>
            </div>

            <div class="mod-grid">
                <div class="mod-card"><div class="mod-card-icon" style="background:#E0E7FF;color:#4F46E5">👥</div><div class="mod-card-val">${_custList.length}</div><div class="mod-card-lbl">إجمالي العملاء</div></div>
                <div class="mod-card"><div class="mod-card-icon" style="background:#FEE2E2;color:#DC2626">⚠️</div><div class="mod-card-val">${custFmt(totalDebt)}</div><div class="mod-card-lbl">مديونيات العملاء (${debtors.length})</div></div>
                <div class="mod-card"><div class="mod-card-icon" style="background:#D1FAE5;color:#059669">💵</div><div class="mod-card-val">${custFmt(totalCredit)}</div><div class="mod-card-lbl">أرصدة دائنة (دفعات مقدمة)</div></div>
            </div>

            <div class="mod-table-wrap" style="margin-top:16px">
                <table class="mod-table"><thead><tr>
                    <th>العميل</th><th>الهاتف</th><th>المنطقة</th><th>آخر تفاعل</th>
                    <th style="text-align:left">الرصيد</th>
                    <th style="text-align:center">إجراءات</th>
                </tr></thead>
                <tbody>
                    ${_custList.length === 0 ? `<tr><td colspan="6" class="empty-state"><span>👥</span>لا يوجد عملاء.</td></tr>` :
                    _custList.map(c => {
                        const bal = Number(c.balance)||0;
                        const balColor = bal > 0 ? '#DC2626' : bal < 0 ? '#059669' : '#64748B';
                        const lastInt = lastInteractionMap[c.id];
                        return `<tr>
                            <td>
                                <div style="display:flex;align-items:center;gap:8px">
                                    <div style="width:32px;height:32px;border-radius:50%;background:#F1F5F9;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#475569">${(c.name||'?').charAt(0)}</div>
                                    <div><div style="font-weight:600">${c.name}</div>${c.code?`<div style="font-size:11px;color:#94A3B8">${c.code}</div>`:''}</div>
                                </div>
                            </td>
                            <td dir="ltr" style="text-align:right;color:#64748B">${c.phone||'—'}</td>
                            <td style="color:#64748B">${regionMap[c.region_id] || '—'}</td>
                            <td style="font-size:12px;color:#94A3B8">${lastInt ? new Date(lastInt).toLocaleDateString('ar-EG') : '—'}</td>
                            <td style="text-align:left;font-weight:700;color:${balColor}">${custFmt(bal)}</td>
                            <td style="text-align:center;white-space:nowrap">
                                <button class="cc-edit" onclick="custShowStatement('${c.id}')" style="background:#FFFBEB;color:#D97706">📄 كشف حساب</button>
                                ${typeof crmOpenAdd === 'function' ? `<button class="cc-edit" style="background:#EFF6FF;color:#2563EB" onclick="crmOpenAdd('${c.id}','${(c.name||'').replace(/'/g,"\\'")}')" title="تسجيل تفاعل سريع">📞</button>` : ''}
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
// 2) كشف حساب عميل (مودال)
// ════════════════════════════════════════════════════════════
window.custShowStatement = async function(customerId) {
    const cust = _custList.find(c=>c.id===customerId);
    if (!cust) return;

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'custStmtModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:820px">
            <div class="mod-modal-header"><h3>📄 كشف حساب — ${cust.name}</h3>
                <div style="display:flex;align-items:center;gap:10px">
                    <button class="cc-edit" style="background:#FFFBEB;color:#D97706" onclick="custGoEditProfile('${cust.id}')">✏️ تعديل بيانات العميل</button>
                    <button class="mod-modal-close" onclick="custCloseModal('custStmtModal')">&times;</button>
                </div></div>
            <div class="mod-modal-body" id="custStmtBody">
                <div class="empty-state"><span>⏳</span>جاري تجميع الحركات...</div>
            </div>
        </div>`;
    document.body.appendChild(modal);

    try {
        // جلب كل حركات العميل بالتوازي — ★ دلوقتي بتشمل الفواتير النقدية
        // والمرتجعات كمان (كانوا ناقصين، فالمستخدم كان لازم يدوّر عليهم
        // في شاشة تانية) — النقدي بيظهر للمراجعة بس من غير أثر على
        // الرصيد المتحرك (لأنه اتقبض وقتها فعلاً).
        const [
            { data: sales },
            { data: payments },
            { data: returns },
            docsResult,
            interactionsResult,
        ] = await Promise.all([
            sb.from('sales').select('invoice_no, total, payment_type, status, created_at')
                .eq('customer_id', customerId).order('created_at', { ascending: true }),
            sb.from('customer_payments').select('ref, amount, status, created_at')
                .eq('customer_id', customerId).order('created_at', { ascending: true }).limit(100),
            sb.from('sales_returns').select('return_no, total, payment_type, status, created_at')
                .eq('customer_id', customerId).order('created_at', { ascending: true }).limit(100),
            // اختياري — لو جدول archive_documents لسه ما اتعملش، نتجاهل الخطأ بهدوء
            sb.from('archive_documents').select('id,title,file_url,category,created_at')
                .eq('linked_type', 'customer').eq('linked_id', customerId)
                .order('created_at', { ascending: false }).then(r => r, () => ({ data: [] })),
            // اختياري — لو جدول customer_interactions لسه ما اتعملش، نتجاهل الخطأ بهدوء
            sb.from('customer_interactions').select('id,type,notes,interaction_date,next_follow_up_date,is_done,sales_reps(name),archive_documents(title,file_url)')
                .eq('customer_id', customerId)
                .order('interaction_date', { ascending: false }).then(r => r, () => ({ data: [] })),
        ]);
        const docs = docsResult?.data || [];
        const interactions = interactionsResult?.data || [];

        // دمج الحركات في timeline واحد + حساب الرصيد المتحرك
        const moves = [];
        (sales||[]).forEach(s => {
            if (s.status !== 'confirmed') return;
            if (s.payment_type === 'credit') {
                moves.push({ date: s.created_at, desc: `فاتورة بيع ${s.invoice_no}`, debit: Number(s.total)||0, credit: 0, type: 'sale-credit' });
            } else {
                // نقدي: بيتقيّد للمراجعة بس مالوش أثر على الرصيد (اتقبض وقتها)
                moves.push({ date: s.created_at, desc: `فاتورة بيع نقدي ${s.invoice_no}`, debit: 0, credit: 0, type: 'sale-cash' });
            }
        });
        (returns||[]).forEach(r => {
            if (r.status !== 'confirmed') return;
            if (r.payment_type === 'credit') {
                moves.push({ date: r.created_at, desc: `مرتجع بيع ${r.return_no}`, debit: 0, credit: Number(r.total)||0, type: 'return-credit' });
            } else {
                moves.push({ date: r.created_at, desc: `مرتجع بيع نقدي ${r.return_no}`, debit: 0, credit: 0, type: 'return-cash' });
            }
        });
        (payments||[]).forEach(p => {
            if (p.status === 'confirmed') {
                moves.push({ date: p.created_at, desc: `تحصيل ${p.ref||''}`, debit: 0, credit: Number(p.amount)||0, type: 'payment' });
            }
        });
        moves.sort((a,b) => new Date(a.date) - new Date(b.date));

        // حساب الرصيد المتحرك
        let running = 0;
        moves.forEach(m => { running += (m.debit - m.credit); m.balance = running; });

        const balNow = Number(cust.balance)||0;
        const totalDebit = moves.reduce((s,m)=>s+m.debit,0);
        const totalCredit = moves.reduce((s,m)=>s+m.credit,0);

        document.getElementById('custStmtBody').innerHTML = `
            <div class="mod-grid" style="margin-bottom:16px">
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:#64748B;margin-bottom:4px">الرصيد الحالي</div>
                    <div style="font-size:22px;font-weight:800;color:${balNow>0?'#DC2626':balNow<0?'#059669':'#64748B'}">${custFmt(balNow)} ج.م</div>
                    <div style="font-size:11.5px;color:#94A3B8">${balNow>0?'مدين (لنا عليه)':balNow<0?'دائن (لنا عنده)':'مسدد'}</div>
                </div>
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:#64748B;margin-bottom:4px">إجمالي المبيعات (آجل)</div>
                    <div style="font-size:22px;font-weight:800;color:#0F172A">${custFmt(totalDebit)}</div>
                </div>
                <div class="mod-card" style="padding:14px">
                    <div style="font-size:11px;color:#64748B;margin-bottom:4px">إجمالي التحصيلات</div>
                    <div style="font-size:22px;font-weight:800;color:#059669">${custFmt(totalCredit)}</div>
                </div>
            </div>

            <div class="mod-table-wrap">
                <table class="mod-table"><thead><tr>
                    <th>التاريخ</th><th>البيان</th>
                    <th style="text-align:left">مدين</th>
                    <th style="text-align:left">دائن</th>
                    <th style="text-align:left">الرصيد</th>
                </tr></thead>
                <tbody>
                    ${moves.length === 0 ? `<tr><td colspan="5" class="empty-state"><span>📭</span>لا توجد حركات.</td></tr>` :
                    moves.map(m => {
                        const isCash = m.type.endsWith('-cash');
                        const bg = m.type==='sale-credit' ? '#FEF2F2' : m.type==='payment' ? '#ECFDF5'
                            : m.type==='return-credit' || m.type==='return-cash' ? '#FFFBEB' : '#F8FAFC';
                        const icon = m.type==='sale-credit' ? '<span style="color:#DC2626">🛒</span>'
                            : m.type==='sale-cash' ? '<span style="color:#94A3B8">💰</span>'
                            : m.type.startsWith('return') ? '<span style="color:#D97706">↩️</span>'
                            : '<span style="color:#059669">💵</span>';
                        return `<tr style="background:${bg}">
                        <td style="font-size:12px">${new Date(m.date).toLocaleDateString('ar-EG')}</td>
                        <td>
                            ${icon} ${m.desc}
                            ${isCash ? '<span style="font-size:11.5px;color:#94A3B8"> (نقدي — بدون أثر على الرصيد)</span>' : ''}
                        </td>
                        <td style="text-align:left;font-weight:600;color:#DC2626">${m.debit?custFmt(m.debit):'—'}</td>
                        <td style="text-align:left;font-weight:600;color:#059669">${m.credit?custFmt(m.credit):'—'}</td>
                        <td style="text-align:left;font-weight:700">${custFmt(m.balance)}</td>
                    </tr>`;
                    }).join('')}
                </tbody>
                ${moves.length ? `<tfoot><tr style="background:#F8FAFC;font-weight:800">
                    <td colspan="2">الإجمالي</td>
                    <td style="text-align:left;color:#DC2626">${custFmt(totalDebit)}</td>
                    <td style="text-align:left;color:#059669">${custFmt(totalCredit)}</td>
                    <td style="text-align:left">${custFmt(balNow)}</td>
                </tr></tfoot>` : ''}
                </table>
            </div>

            <div style="margin-top:16px">
                <div style="font-size:13px;font-weight:800;color:#1E293B;margin-bottom:8px">📁 المستندات المرتبطة (${docs.length})</div>
                ${docs.length === 0 ? `<div style="font-size:12.5px;color:#94A3B8">لا توجد مستندات مرتبطة بهذا العميل في الأرشيف.</div>` :
                `<div style="display:flex;flex-wrap:wrap;gap:8px">
                    ${docs.map(d => `<a href="${d.file_url}" target="_blank" rel="noopener" class="cc-edit" style="background:#FFFBEB;color:#D97706;text-decoration:none">📄 ${d.title}${d.category?' ('+d.category+')':''}</a>`).join('')}
                </div>`}
            </div>

            <div style="margin-top:16px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                    <div style="font-size:13px;font-weight:800;color:#1E293B">🤝 سجل التفاعلات (${interactions.length})</div>
                    ${typeof crmOpenAdd === 'function' ? `<button class="cc-edit" style="background:#FFFBEB;color:#D97706" onclick="crmOpenAdd('${customerId}','${(cust.name||'').replace(/'/g,"\\'")}')">+ تسجيل تفاعل</button>` : ''}
                </div>
                <div id="custInteractionsWrap">${custInteractionsHTML(interactions)}</div>
            </div>`;
    } catch (err) {
        document.getElementById('custStmtBody').innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
};

window.custCloseModal = function(id) { const m = document.getElementById(id); if (m) m.remove(); };

// ينقل لصفحة "إدارة العملاء" (master-data.js) ويفتح نافذة تعديل بيانات
// نفس العميل تلقائياً — قبل كده كانت الصفحتين منفصلتين تماماً من غير أي
// رابط بينهم، فالمستخدم كان لازم يقفل كشف الحساب ويدوّر على العميل تاني
// في شاشة تانية عشان يعدّل رقم تليفون أو حد ائتماني مثلاً.
window.custGoEditProfile = function(customerId) {
    window._pendingCustomerEdit = customerId;
    custCloseModal('custStmtModal');
    document.querySelector('[data-mod="customers-manage"]')?.click();
};

// ════════════════════════════════════════════════════════════
// 3) سجل التفاعلات (CRM) داخل كشف الحساب — تحديث جزئي بدون
//    إعادة تحميل الكشف كله بعد ما تسجّل تفاعل جديد من crm.js
// ════════════════════════════════════════════════════════════
function custInteractionsHTML(interactions) {
    if (!interactions.length) return `<div style="font-size:12.5px;color:#94A3B8">لا توجد تفاعلات مسجّلة لهذا العميل.</div>`;
    const typeLabels = { call: '📞 مكالمة', visit: '🚶 زيارة', complaint: '⚠️ شكوى', note: '📝 ملاحظة' };
    return `<div class="mod-table-wrap"><table class="mod-table"><thead><tr>
        <th>النوع</th><th>المندوب</th><th>التاريخ</th><th>ملاحظات</th><th>المتابعة القادمة</th>
    </tr></thead><tbody>
        ${interactions.map(x => `<tr>
            <td>${typeLabels[x.type] || x.type}</td>
            <td style="color:#64748B">${x.sales_reps?.name || '—'}</td>
            <td style="font-size:12px">${new Date(x.interaction_date).toLocaleDateString('ar-EG')}</td>
            <td style="color:#64748B">${x.notes || '—'}${x.archive_documents ? `<br><a href="${x.archive_documents.file_url}" target="_blank" rel="noopener" style="font-size:11px;color:#D97706">📎 ${x.archive_documents.title}</a>` : ''}</td>
            <td style="font-size:12px">${x.next_follow_up_date ? new Date(x.next_follow_up_date).toLocaleDateString('ar-EG') + (x.is_done ? ' ✅' : '') : '—'}</td>
        </tr>`).join('')}
    </tbody></table></div>`;
}

window.custRefreshInteractions = async function (customerId) {
    const wrap = document.getElementById('custInteractionsWrap');
    if (!wrap) return;
    try {
        const { data } = await sb.from('customer_interactions').select('id,type,notes,interaction_date,next_follow_up_date,is_done,sales_reps(name),archive_documents(title,file_url)')
            .eq('customer_id', customerId).order('interaction_date', { ascending: false });
        wrap.innerHTML = custInteractionsHTML(data || []);
    } catch {}
};

// ════════════════════════════════════════════════════════════
// 4) أدوات مساعدة
// ════════════════════════════════════════════════════════════
function custFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
