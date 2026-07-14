/* ════════════════════════════════════════════════════════════
   حركة الخزينة التفصيلية — cash-movement.js
   كل حركة دخول/خروج فلوس بالترتيب الزمني + رصيد متحرك
   يصدّر: renderCashMovement(container)
   قراءة فقط بالكامل — لا يكتب أي شيء في قاعدة البيانات
   ════════════════════════════════════════════════════════════ */

let _cmList = [];
let _cmFilterType = '';
let _cmFrom = '';
let _cmTo = '';

const CASH_REF_LABELS = {
    sale: 'بيع', purchase: 'شراء', expense: 'مصروف',
    collection: 'تحصيل عميل', payment: 'دفع مورد',
    reversal: 'عكس عملية', opening_balance: 'رصيد افتتاحي',
    treasury_transfer: 'تحويل بين الخزن', balance_transfer: 'تحويل أرصدة'
};

function cmFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function renderCashMovement(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل حركة الخزينة...</div>';
    try {
        await cmLoadData(c, '', '', '');
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

async function cmLoadData(c, from, to, refType) {
    try {
        const { data: cashBalance } = await sb.rpc('get_cash_balance');

        let query = sb.from('cash_transactions').select('*').order('created_at', { ascending: true });
        if (from) query = query.gte('created_at', from);
        if (to) query = query.lte('created_at', to + 'T23:59:59');
        if (refType) query = query.eq('ref_type', refType);

        const { data: allRows, error } = await query;
        if (error) throw error;

        _cmList = allRows || [];

        // رصيد متحرك — نحسبه من كل الحركات بالترتيب الزمني (مش بس المفلترة)
        // عشان الرصيد المعروض يكون صحيح حتى لو فيه فلتر تاريخ مطبّق
        let runningFull = 0;
        const withRunning = _cmList.map(tx => {
            runningFull += tx.direction === 'in' ? Number(tx.amount) : -Number(tx.amount);
            return { ...tx, running: runningFull };
        });

        const totalIn = _cmList.filter(t=>t.direction==='in').reduce((s,t)=>s+Number(t.amount),0);
        const totalOut = _cmList.filter(t=>t.direction==='out').reduce((s,t)=>s+Number(t.amount),0);

        const rows = withRunning.slice().reverse().map(tx => `<tr>
            <td class="dash-muted">${new Date(tx.created_at).toLocaleString('ar-EG', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</td>
            <td>${tx.reason}</td>
            <td><span class="dash-badge dash-badge-blue">${CASH_REF_LABELS[tx.ref_type] || tx.ref_type}</span></td>
            <td style="text-align:left;color:#059669;font-weight:700">${tx.direction==='in' ? cmFmt(tx.amount) : '—'}</td>
            <td style="text-align:left;color:#DC2626;font-weight:700">${tx.direction==='out' ? cmFmt(tx.amount) : '—'}</td>
            <td style="text-align:left;font-weight:800;color:${tx.running>=0?'#0F172A':'#DC2626'}">${cmFmt(tx.running)}</td>
        </tr>`).join('');

        c.innerHTML = `
        <div style="margin-bottom:20px"><h2 style="font-size:22px;font-weight:800">💰 حركة الخزينة التفصيلية</h2>
        <p style="font-size:13px;color:#64748B;margin-top:4px">كل حركة دخول وخروج فلوس بالترتيب الزمني مع الرصيد المتحرك</p></div>

        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#F0FDF4;color:#059669">📈</div><div class="mod-card-val">${cmFmt(totalIn)}</div><div class="mod-card-lbl">إجمالي الداخل</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FEE2E2;color:#DC2626">📉</div><div class="mod-card-val">${cmFmt(totalOut)}</div><div class="mod-card-lbl">إجمالي الخارج</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">💰</div><div class="mod-card-val">${cmFmt(cashBalance)}</div><div class="mod-card-lbl">الرصيد الحالي</div></div>
        </div>

        <div class="dash-card" style="padding:16px;margin-bottom:16px">
            <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
                <div><label class="ob-label">من تاريخ</label><input type="date" id="cmFrom" class="ob-input" style="margin:0" value="${from}"></div>
                <div><label class="ob-label">إلى تاريخ</label><input type="date" id="cmTo" class="ob-input" style="margin:0" value="${to}"></div>
                <div style="min-width:180px">
                    <label class="ob-label">نوع الحركة</label>
                    <select id="cmRefType" class="ob-input" style="margin:0">
                        <option value="">كل الأنواع</option>
                        ${Object.entries(CASH_REF_LABELS).map(([v,l])=>`<option value="${v}" ${refType===v?'selected':''}>${l}</option>`).join('')}
                    </select>
                </div>
                <button class="ob-add-btn" onclick="cmApplyFilter()">🔍 تطبيق</button>
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="renderCashMovement(document.getElementById('app-content'))">الكل</button>
            </div>
        </div>

        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>التاريخ</th><th>البيان</th><th>النوع</th>
                <th style="text-align:left">داخل</th><th style="text-align:left">خارج</th><th style="text-align:left">الرصيد</th>
            </tr></thead>
            <tbody>${rows || '<tr><td colspan="6" class="empty-state"><span>💰</span>لا توجد حركات في هذه الفترة</td></tr>'}</tbody>
            </table>
        </div>`;

        window.cmApplyFilter = () => {
            const f = document.getElementById('cmFrom').value;
            const t = document.getElementById('cmTo').value;
            const rt = document.getElementById('cmRefType').value;
            cmLoadData(c, f, t, rt);
        };
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

// ملاحظة: cmApplyFilter مش موجودة هنا عمداً — بتتحدد ديناميكياً جوه
// cmLoadData() وقت ما الشاشة تُفتح فعلاً (نفس سبب accApplyTbFilter
// في accounting.js — الإشارة لها هنا كمعرّف عادي وقت تحميل السكريبت
// هتفشل بـ ReferenceError).
Object.assign(window, { renderCashMovement, cmLoadData });
