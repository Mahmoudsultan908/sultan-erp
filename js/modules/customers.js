/* ════════════════════════════════════════════════════════════
   العملاء + كشف الحساب — customers
   يعرض قائمة العملاء + تفاصيل/كشف حساب لكل عميل
   مصادر الحركة: sales (آجل/نقدي) + customer_payments (تحصيلات)
   ════════════════════════════════════════════════════════════ */

let _custList = [];
let _custRegionMap = {};
let _custLastIntMap = {};
let _custStmtMoves = []; // الحركات الكاملة لكشف الحساب المفتوح — عشان خانة البحث تفلتر منها من غير ما تعيد الحساب من القاعدة
let _custListSearch = ''; // بحث بالاسم/الهاتف في تبويب "كشف حساب" — بيتطبق مع فلتر الرصيد مع بعض (AND)

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي — قائمة العملاء
// ════════════════════════════════════════════════════════════
async function renderCustomers(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل العملاء...</div>';
    try {
        const [{ data: customers }, { data: regions }, interactionsResult] = await Promise.all([
            sb.from('customers').select('*').order('balance', { ascending: false }),
            sb.from('customer_regions').select('id,name'),
            // اختياري — لو جدول customer_interactions لسه ما اتعملش، نتجاهل الخطأ بهدوء
            sb.from('customer_interactions').select('customer_id, interaction_date').then(r => r, () => ({ data: [] })),
        ]);
        _custList = customers || [];
        _custRegionMap = {};
        (regions || []).forEach(r => { _custRegionMap[r.id] = r.name; });
        // آخر تفاعل لكل عميل — أحدث interaction_date من customer_interactions
        _custLastIntMap = {};
        (interactionsResult?.data || []).forEach(x => {
            if (!_custLastIntMap[x.customer_id] || x.interaction_date > _custLastIntMap[x.customer_id]) {
                _custLastIntMap[x.customer_id] = x.interaction_date;
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

            <div class="dash-card" style="padding:14px;margin-top:16px;display:flex;gap:10px;align-items:end;flex-wrap:wrap">
                <div style="flex:1;min-width:200px">
                    <label class="ob-label">بحث</label>
                    <input type="text" id="custListSearch" class="ob-input" style="margin:0" placeholder="🔍 بحث بالاسم أو الهاتف..." oninput="custListSearchInput(this.value)">
                </div>
                <div style="min-width:130px">
                    <label class="ob-label">فلتر الرصيد</label>
                    <select id="custBalFilterOp" class="ob-input" style="margin:0">
                        <option value="">الكل</option>
                        <option value="gt">أكبر من</option>
                        <option value="lt">أصغر من</option>
                    </select>
                </div>
                <div style="min-width:130px">
                    <input type="number" id="custBalFilterVal" class="ob-input" style="margin:0" placeholder="مبلغ..." dir="ltr">
                </div>
                <button class="ob-add-btn" onclick="custApplyBalanceFilter()">🔍 تطبيق</button>
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('custBalFilterOp').value='';document.getElementById('custBalFilterVal').value='';custApplyBalanceFilter()">الكل</button>
            </div>

            <div class="mod-table-wrap" style="margin-top:10px">
                <table class="mod-table"><thead><tr>
                    <th>العميل</th><th>الهاتف</th><th>المنطقة</th><th>آخر تفاعل</th>
                    <th style="text-align:left">الرصيد</th>
                    <th style="text-align:center">إجراءات</th>
                </tr></thead>
                <tbody id="custListTbody">${custListRowsHtml(_custList)}</tbody></table>
            </div>
        `;

        // ★ جاي من بحث Ctrl+K (app.js) — افتح كشف حساب نفس العميل تلقائياً
        if (window._pendingCustomerStatement) {
            const pendId = window._pendingCustomerStatement;
            window._pendingCustomerStatement = null;
            custShowStatement(pendId);
        }
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
        // ★★ وكمان تحويلات الأرصدة (balance_transfers) والأرصدة الافتتاحية
        // (opening_balances) — كانوا ناقصين خالص من الكشف، فلو عميل كان
        // طرف في تحويل رصيد أو له رصيد افتتاحي، الرصيد المتحرك جوه الكشف
        // كان بيختلف عن رصيده الحقيقي (customers.balance) من غير أي تفسير،
        // وده بالظبط سبب "الكشف مش مظبوط" اللي اتلاحظ.
        const [
            { data: sales },
            { data: payments },
            { data: returns },
            { data: transfersOut },
            { data: transfersIn },
            { data: openingBalances },
            docsResult,
            interactionsResult,
        ] = await Promise.all([
            sb.from('sales').select('invoice_no, total, payment_type, status, created_at')
                .eq('customer_id', customerId).order('created_at', { ascending: true }),
            sb.from('customer_payments').select('id, ref, amount, status, created_at')
                .eq('customer_id', customerId).order('created_at', { ascending: true }).limit(100),
            sb.from('sales_returns').select('return_no, total, payment_type, status, created_at')
                .eq('customer_id', customerId).order('created_at', { ascending: true }).limit(100),
            sb.from('balance_transfers').select('id, to_c:to_customer_id(name), amount, notes, created_at')
                .eq('from_customer_id', customerId).eq('transfer_type', 'customer_to_customer')
                .order('created_at', { ascending: true }),
            sb.from('balance_transfers').select('id, from_c:from_customer_id(name), amount, notes, created_at')
                .eq('to_customer_id', customerId).eq('transfer_type', 'customer_to_customer')
                .order('created_at', { ascending: true }),
            sb.from('opening_balances').select('id, amount, as_of_date, notes')
                .eq('customer_id', customerId).eq('balance_type', 'customer').eq('status', 'confirmed'),
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

        // دمج الحركات في timeline واحد + حساب الرصيد المتحرك — كل حركة معاها
        // nav (نوع + مرجع) عشان أيقونة الانتقال المباشر للمعاملة تحت
        const moves = [];
        (sales||[]).forEach(s => {
            if (s.status !== 'confirmed') return;
            if (s.payment_type === 'credit') {
                moves.push({ date: s.created_at, desc: `فاتورة بيع ${s.invoice_no}`, debit: Number(s.total)||0, credit: 0, type: 'sale-credit', nav: { kind: 'sale', no: s.invoice_no } });
            } else {
                // نقدي: بيتقيّد للمراجعة بس مالوش أثر على الرصيد (اتقبض وقتها)
                moves.push({ date: s.created_at, desc: `فاتورة بيع نقدي ${s.invoice_no}`, debit: 0, credit: 0, type: 'sale-cash', nav: { kind: 'sale', no: s.invoice_no } });
            }
        });
        (returns||[]).forEach(r => {
            if (r.status !== 'confirmed') return;
            if (r.payment_type === 'credit') {
                moves.push({ date: r.created_at, desc: `مرتجع بيع ${r.return_no}`, debit: 0, credit: Number(r.total)||0, type: 'return-credit', nav: { kind: 'return', no: r.return_no } });
            } else {
                moves.push({ date: r.created_at, desc: `مرتجع بيع نقدي ${r.return_no}`, debit: 0, credit: 0, type: 'return-cash', nav: { kind: 'return', no: r.return_no } });
            }
        });
        (payments||[]).forEach(p => {
            if (p.status === 'confirmed') {
                moves.push({ date: p.created_at, desc: `تحصيل ${p.ref||''}`, debit: 0, credit: Number(p.amount)||0, type: 'payment', nav: { kind: 'payment', id: p.id } });
            }
        });
        // تحويل رصيد "من" العميل ده لعميل تاني: بيقلل رصيده (دائن) — راجع
        // fn_balance_transfer_apply (balance = balance - amount للمصدر)
        (transfersOut||[]).forEach(t => {
            moves.push({ date: t.created_at, desc: `تحويل رصيد إلى ${t.to_c?.name || '—'}${t.notes ? ' — '+t.notes : ''}`, debit: 0, credit: Number(t.amount)||0, type: 'transfer-out', nav: { kind: 'transfer' } });
        });
        // تحويل رصيد "إلى" العميل ده من عميل تاني: بيزود رصيده (مدين)
        (transfersIn||[]).forEach(t => {
            moves.push({ date: t.created_at, desc: `تحويل رصيد من ${t.from_c?.name || '—'}${t.notes ? ' — '+t.notes : ''}`, debit: Number(t.amount)||0, credit: 0, type: 'transfer-in', nav: { kind: 'transfer' } });
        });
        // رصيد افتتاحي — راجع fn_opening_balance_status_change (balance += amount)،
        // فمبلغ سالب (نادر) معناه رصيد افتتاحي دائن، بنقسمه مدين/دائن حسب إشارته
        (openingBalances||[]).forEach(o => {
            const amt = Number(o.amount) || 0;
            moves.push({ date: o.as_of_date, desc: `رصيد افتتاحي${o.notes ? ' — '+o.notes : ''}`, debit: Math.max(amt,0), credit: Math.max(-amt,0), type: 'opening', nav: { kind: 'opening' } });
        });
        moves.sort((a,b) => new Date(a.date) - new Date(b.date));

        // ★ إجماليات "المبيعات/التحصيلات" فى الكروت لازم تفضل حقيقية 100%
        //   (مبنية بس على حركات فعلية)، فبنحسبها هنا قبل أي إضافة صناعية تحت.
        const balNow = Number(cust.balance)||0;
        const totalDebit = moves.reduce((s,m)=>s+m.debit,0);
        const totalCredit = moves.reduce((s,m)=>s+m.credit,0);

        // ★ حل جذري لعدم تطابق الكشف مع الرصيد الحقيقي عند عملاء منقولين من
        //   نظام قديم (رصيدهم اتحط رقم مباشر وقت النقل من غير ما يتسجل أي
        //   مستند يفسّره فى سلطان — مفيش صف حركة يمثّله). بدل ما نسيب عمود
        //   "الرصيد" جنب كل صف يوصل لرقم مختلف عن رصيد العميل الحقيقي فى
        //   آخر الكشف (مربك ومش دقيق)، بنضيف سطر واحد صناعي "رصيد مرحّل من
        //   النظام القديم" بالفرق بالظبط، فيتصالح الرصيد المتحرك تمامًا مع
        //   customers.balance الحقيقي — من غير ما نلمس قاعدة البيانات خالص
        //   (عرض بس، مفيش أي تعديل على رصيد العميل الفعلي).
        const displayMoves = [...moves];
        const rawTotal = moves.reduce((s,m)=>s+(m.debit-m.credit),0);
        const legacyDiff = balNow - rawTotal;
        if (Math.abs(legacyDiff) > 0.01) {
            // لازم يتحط قبل أول حركة حقيقية زمنيًا (زي رصيد افتتاحي حقيقي) —
            // مش وقت إنشاء سجل العميل نفسه فى سلطان (وقت الهجرة)، لأن ده
            // ممكن يكون متأخر عن تواريخ المستندات القديمة المُعاد تشغيلها فعليًا
            const earliestDate = moves.length ? new Date(new Date(moves[0].date).getTime() - 1000).toISOString() : (cust.created_at || new Date(0).toISOString());
            displayMoves.push({
                date: earliestDate,
                desc: 'رصيد مرحّل من النظام القديم (قبل سلطان)',
                debit: Math.max(legacyDiff, 0), credit: Math.max(-legacyDiff, 0),
                type: 'legacy-carry', nav: null,
            });
        }
        displayMoves.sort((a,b) => new Date(a.date) - new Date(b.date));

        // حساب الرصيد المتحرك — على displayMoves (تشمل السطر الصناعي لو موجود)
        // عشان عمود "الرصيد" جنب كل صف يتصالح صح مع الرصيد الحقيقي فى الآخر
        let running = 0;
        displayMoves.forEach(m => { running += (m.debit - m.credit); m.balance = running; });
        const tableDebit = displayMoves.reduce((s,m)=>s+m.debit,0);
        const tableCredit = displayMoves.reduce((s,m)=>s+m.credit,0);

        _custStmtMoves = displayMoves;

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

            <input type="text" id="custStmtSearch" class="mod-form-input" style="margin-bottom:10px" placeholder="🔍 بحث في الحركات (اسم الفاتورة/المرتجع/البيان)..." oninput="custStmtFilterRows(this.value)">
            <div class="mod-table-wrap">
                <table class="mod-table"><thead><tr>
                    <th>التاريخ</th><th>البيان</th>
                    <th style="text-align:left">مدين</th>
                    <th style="text-align:left">دائن</th>
                    <th style="text-align:left">الرصيد</th>
                    <th></th>
                </tr></thead>
                <tbody id="custStmtTbody">${custStmtRowsHtml(displayMoves)}</tbody>
                ${displayMoves.length ? `<tfoot><tr style="background:#F8FAFC;font-weight:800">
                    <td colspan="2">الإجمالي</td>
                    <td style="text-align:left;color:#DC2626">${custFmt(tableDebit)}</td>
                    <td style="text-align:left;color:#059669">${custFmt(tableCredit)}</td>
                    <td style="text-align:left">${custFmt(balNow)}</td>
                    <td></td>
                </tr></tfoot>` : ''}
                </table>
            </div>
            ${Math.abs(legacyDiff) > 0.01 ? `
            <div style="background:#F1F5F9;border:1px solid #E2E8F0;color:#475569;padding:10px 14px;border-radius:10px;margin-top:10px;font-size:12px">
                🗄️ سطر "رصيد مرحّل من النظام القديم" (${custFmt(legacyDiff)}) هو الفرق بين رصيد العميل الحقيقي وحركاته المسجّلة فعليًا فى سلطان —
                غالبًا عميل منقول من نظام قديم برصيد بداية من غير تفاصيل مستندات. رصيد العميل نفسه صحيح، السطر ده للعرض بس ومفيهوش أي تعديل على البيانات.
            </div>` : ''}

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

// بناء صفوف قائمة العملاء — دالة منفصلة عشان تتنادى من العرض الأول
// ومن custApplyBalanceFilter من غير تكرار كود
function custListRowsHtml(list) {
    if (!list.length) return `<tr><td colspan="6" class="empty-state"><span>👥</span>لا يوجد عملاء.</td></tr>`;
    return list.map(c => {
        const bal = Number(c.balance)||0;
        const balColor = bal > 0 ? '#DC2626' : bal < 0 ? '#059669' : '#64748B';
        const lastInt = _custLastIntMap[c.id];
        return `<tr>
            <td>
                <div style="display:flex;align-items:center;gap:8px">
                    <div style="width:32px;height:32px;border-radius:50%;background:#F1F5F9;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#475569">${(c.name||'?').charAt(0)}</div>
                    <div><div style="font-weight:600">${c.name}</div>${c.code?`<div style="font-size:11px;color:#94A3B8">${c.code}</div>`:''}</div>
                </div>
            </td>
            <td dir="ltr" style="text-align:right;color:#64748B">${c.phone||'—'}</td>
            <td style="color:#64748B">${_custRegionMap[c.region_id] || '—'}</td>
            <td style="font-size:12px;color:#94A3B8">${lastInt ? new Date(lastInt).toLocaleDateString('ar-EG') : '—'}</td>
            <td style="text-align:left;font-weight:700;color:${balColor}">${custFmt(bal)}</td>
            <td style="text-align:center;white-space:nowrap">
                <button class="cc-edit" onclick="custShowStatement('${c.id}')" style="background:#FFFBEB;color:#D97706">📄 كشف حساب</button>
                ${typeof crmOpenAdd === 'function' ? `<button class="cc-edit" style="background:#EFF6FF;color:#2563EB" onclick="crmOpenAdd('${c.id}','${(c.name||'').replace(/'/g,"\\'")}')" title="تسجيل تفاعل سريع">📞</button>` : ''}
            </td>
        </tr>`;
    }).join('');
}

window.custApplyBalanceFilter = function() {
    const op = document.getElementById('custBalFilterOp')?.value;
    const val = parseFloat(document.getElementById('custBalFilterVal')?.value);
    let filtered = _custList;
    if (_custListSearch) {
        const q = _custListSearch.toLowerCase();
        filtered = filtered.filter(c => (c.name||'').toLowerCase().includes(q) || (c.phone||'').includes(q));
    }
    if (op && !isNaN(val)) {
        filtered = filtered.filter(c => op === 'gt' ? (Number(c.balance)||0) > val : (Number(c.balance)||0) < val);
    }
    const tbody = document.getElementById('custListTbody');
    if (tbody) tbody.innerHTML = custListRowsHtml(filtered);
};
window.custListSearchInput = function(v) { _custListSearch = v; window.custApplyBalanceFilter(); };

// بناء صفوف جدول كشف الحساب — دالة منفصلة عشان تتنادى من العرض الأول
// ومن custStmtFilterRows (البحث) من غير تكرار كود
function custStmtRowsHtml(moves) {
    if (!moves.length) return `<tr><td colspan="6" class="empty-state"><span>📭</span>لا توجد حركات.</td></tr>`;
    return moves.map(m => {
        const isCash = m.type.endsWith('-cash');
        const bg = m.type==='sale-credit' ? '#FEF2F2' : m.type==='payment' ? '#ECFDF5'
            : m.type==='return-credit' || m.type==='return-cash' ? '#FFFBEB'
            : m.type==='transfer-out' || m.type==='transfer-in' ? '#EFF6FF'
            : m.type==='opening' ? '#F5F3FF'
            : m.type==='legacy-carry' ? '#F1F5F9' : '#F8FAFC';
        const icon = m.type==='sale-credit' ? '<span style="color:#DC2626">🛒</span>'
            : m.type==='sale-cash' ? '<span style="color:#94A3B8">💰</span>'
            : m.type.startsWith('return') ? '<span style="color:#D97706">↩️</span>'
            : m.type.startsWith('transfer') ? '<span style="color:#2563EB">🔀</span>'
            : m.type==='opening' ? '<span style="color:#7C3AED">📋</span>'
            : m.type==='legacy-carry' ? '<span style="color:#64748B">🗄️</span>'
            : '<span style="color:#059669">💵</span>';
        const navBtn = m.nav?.kind === 'sale' ? `<button class="cc-edit" title="افتح الفاتورة" onclick="custGoToDoc('sales','${m.nav.no}')">🔗</button>`
            : m.nav?.kind === 'return' ? `<button class="cc-edit" title="افتح المرتجع" onclick="custGoToDoc('sales_return','${m.nav.no}')">🔗</button>`
            : m.nav?.kind === 'payment' ? `<button class="cc-edit" title="افتح سند التحصيل" onclick="custGoToPayment('${m.nav.id}')">🔗</button>`
            : m.nav?.kind === 'transfer' ? `<button class="cc-edit" title="افتح تحويل الأرصدة" onclick="custGoToModule('balance-transfer')">🔗</button>`
            : m.nav?.kind === 'opening' ? `<button class="cc-edit" title="افتح الأرصدة الافتتاحية" onclick="custGoToModule('opening-balances')">🔗</button>`
            : '';
        return `<tr style="background:${bg}">
        <td style="font-size:12px">${new Date(m.date).toLocaleDateString('ar-EG')}</td>
        <td>
            ${icon} ${m.desc}
            ${isCash ? '<span style="font-size:11.5px;color:#94A3B8"> (نقدي — بدون أثر على الرصيد)</span>' : ''}
        </td>
        <td style="text-align:left;font-weight:600;color:#DC2626">${m.debit?custFmt(m.debit):'—'}</td>
        <td style="text-align:left;font-weight:600;color:#059669">${m.credit?custFmt(m.credit):'—'}</td>
        <td style="text-align:left;font-weight:700">${custFmt(m.balance)}</td>
        <td style="text-align:center">${navBtn}</td>
    </tr>`;
    }).join('');
}

window.custStmtFilterRows = function(query) {
    const q = (query || '').trim().toLowerCase();
    const filtered = q ? _custStmtMoves.filter(m => (m.desc || '').toLowerCase().includes(q)) : _custStmtMoves;
    const tbody = document.getElementById('custStmtTbody');
    if (tbody) tbody.innerHTML = custStmtRowsHtml(filtered);
};

// ينقل لصفحة "إدارة العملاء" (master-data.js) ويفتح نافذة تعديل بيانات
// نفس العميل تلقائياً — قبل كده كانت الصفحتين منفصلتين تماماً من غير أي
// رابط بينهم، فالمستخدم كان لازم يقفل كشف الحساب ويدوّر على العميل تاني
// في شاشة تانية عشان يعدّل رقم تليفون أو حد ائتماني مثلاً.
window.custGoEditProfile = function(customerId) {
    window._pendingCustomerEdit = customerId;
    window._pendingCustHubTab = 'manage';
    custCloseModal('custStmtModal');
    document.querySelector('[data-mod="customers-hub"]')?.click();
};

// أيقونة الانتقال المباشر جنب كل حركة فى الكشف — بتاخد نفس فكرة
// custGoEditProfile بالظبط (pending flag + كليك على عنصر القائمة الجانبية)
window.custGoToDoc = function(revType, no) {
    window._pendingInvoiceReviewSearch = { type: revType, no };
    custCloseModal('custStmtModal');
    document.querySelector('[data-mod="invoice-review"]')?.click();
};
window.custGoToPayment = function(paymentId) {
    window._pendingCollectionEdit = paymentId;
    custCloseModal('custStmtModal');
    document.querySelector('[data-mod="collections"]')?.click();
};
window.custGoToModule = function(mod) {
    custCloseModal('custStmtModal');
    document.querySelector(`[data-mod="${mod}"]`)?.click();
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
