/* ════════════════════════════════════════════════════════════
   المحاسبة الأساسية — accounting.js
   شجرة الحسابات + القيود اليومية (عرض) + ميزان المراجعة + الميزانية العمومية
   يصدّر: renderChartOfAccounts, renderJournalView,
          renderTrialBalance, renderBalanceSheet
   قراءة فقط بالكامل (عدا إضافة حساب جديد) — لا تلمس محرك القيود
   التلقائي أبداً (الـ Triggers هي المصدر الوحيد للقيود المالية)
   ════════════════════════════════════════════════════════════ */

function accFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
const ACC_TYPE_LABELS = { asset:'أصول', liability:'خصوم', equity:'حقوق ملكية', revenue:'إيرادات', expense:'مصروفات' };
const ACC_TYPE_COLORS = { asset:'#2563EB', liability:'#DC2626', equity:'#7C3AED', revenue:'#059669', expense:'#D97706' };

// ════════════════════════════════════════════════════════════
// ██ 1) شجرة الحسابات ██
// ════════════════════════════════════════════════════════════
async function renderChartOfAccounts(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل شجرة الحسابات...</div>';
    try {
        const { data: accounts } = await sb.from('accounts').select('*').order('code');
        const list = accounts || [];

        const grouped = {};
        list.forEach(a => { (grouped[a.type] = grouped[a.type] || []).push(a); });

        c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
            <div><h2 style="font-size:22px;font-weight:800">📒 شجرة الحسابات</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">الحسابات المحاسبية الأساسية للنظام</p></div>
            <button class="mod-btn mod-btn-primary" onclick="accOpenAddAccount()">+ حساب جديد</button>
        </div>
        ${Object.keys(ACC_TYPE_LABELS).map(type => {
            const items = grouped[type] || [];
            if (!items.length) return '';
            return `
            <div class="mod-card" style="margin-bottom:14px">
                <div style="font-weight:800;font-size:14px;color:${ACC_TYPE_COLORS[type]};margin-bottom:10px;padding-bottom:8px;border-bottom:2px solid ${ACC_TYPE_COLORS[type]}22">
                    ${ACC_TYPE_LABELS[type]} (${items.length})
                </div>
                ${items.map(a => `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #F8FAFC">
                    <div><span style="background:#F1F5F9;padding:2px 8px;border-radius:5px;font-size:11px;font-family:monospace;direction:ltr;display:inline-block;margin-left:8px">${a.code}</span><strong>${a.name}</strong></div>
                    <span style="font-size:11px;color:${a.is_active===false?'#DC2626':'#94A3B8'}">${a.is_active===false?'معطّل':'نشط'}</span>
                </div>`).join('')}
            </div>`;
        }).join('')}`;
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

window.accOpenAddAccount = async function() {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'accAddModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:420px">
            <div class="mod-modal-header"><h3>📒 حساب جديد</h3>
                <button class="mod-modal-close" onclick="document.getElementById('accAddModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>الكود *</label>
                    <input type="text" id="accCode" class="mod-form-input" placeholder="مثال: 5010" dir="ltr"></div>
                <div class="mod-form-group"><label>اسم الحساب *</label>
                    <input type="text" id="accName" class="mod-form-input" placeholder="مثال: مصروفات صيانة"></div>
                <div class="mod-form-group"><label>النوع *</label>
                    <select id="accType" class="mod-form-input">
                        ${Object.entries(ACC_TYPE_LABELS).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}
                    </select></div>
                <div style="background:#FFFBEB;border:1px solid #FED7AA;border-radius:8px;padding:10px 14px;font-size:12px;color:#92400E">
                    ⚠️ الحسابات الأساسية (الخزينة، العملاء، الموردون...) موجودة بالفعل. أضف حساباً جديداً فقط عند الحاجة لتصنيف مصروف أو إيراد إضافي.
                </div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('accAddModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="accSaveAccount()">💾 إضافة</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

window.accSaveAccount = async function() {
    const code = document.getElementById('accCode').value.trim();
    const name = document.getElementById('accName').value.trim();
    const type = document.getElementById('accType').value;
    if (!code || !name) return alert('الكود والاسم مطلوبان');
    try {
        const { error } = await sb.from('accounts').insert({ code, name, type });
        if (error) throw error;
        document.getElementById('accAddModal').remove();
        renderChartOfAccounts(document.getElementById('app-content'));
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

// ════════════════════════════════════════════════════════════
// ██ 2) القيود اليومية (عرض) ██
// ════════════════════════════════════════════════════════════
async function renderJournalView(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل القيود...</div>';
    try {
        const { data: entries } = await sb.from('journal_entries')
            .select('*, journal_entry_lines(account_code, debit, credit, accounts(name))')
            .order('created_at', { ascending: false }).limit(200);

        const rows = (entries||[]).map(je => {
            const totalDr = (je.journal_entry_lines||[]).reduce((s,l)=>s+Number(l.debit||0),0);
            return `<tr>
                <td class="dash-muted">${new Date(je.created_at).toLocaleDateString('ar-EG')}</td>
                <td><span style="background:#F1F5F9;padding:2px 8px;border-radius:5px;font-size:11px;font-family:monospace;direction:ltr;display:inline-block">${je.ref}</span></td>
                <td>${je.description}</td>
                <td style="text-align:left;font-weight:700;color:#2563EB">${accFmt(totalDr)}</td>
                <td><button class="cc-edit" onclick="accViewEntry('${je.id}')">👁️</button></td>
            </tr>`;
        }).join('');

        c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
            <div><h2 style="font-size:22px;font-weight:800">📝 القيود اليومية</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">آخر 200 قيد — كل القيود تُنشأ تلقائياً من العمليات (بيع/شراء/تحصيل/دفع/مصروف)</p></div>
        </div>
        <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px 14px;font-size:12.5px;color:#1E40AF;margin-bottom:16px">
            💡 كل القيود هنا تلقائية بالكامل من محرك النظام — لا يمكن إضافة أو تعديل قيد يدوياً (حماية من الأخطاء المالية).
        </div>
        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>التاريخ</th><th>المرجع</th><th>البيان</th><th style="text-align:left">المبلغ</th><th></th>
            </tr></thead>
            <tbody>${rows || '<tr><td colspan="5" class="empty-state"><span>📝</span>لا توجد قيود بعد</td></tr>'}</tbody>
            </table>
        </div>`;
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

window.accViewEntry = async function(entryId) {
    const { data: lines } = await sb.from('journal_entry_lines').select('*, accounts(name)').eq('entry_id', entryId);
    const { data: entry } = await sb.from('journal_entries').select('*').eq('id', entryId).single();

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'accViewModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:480px">
            <div class="mod-modal-header"><h3>📝 تفاصيل القيد — ${entry?.ref||''}</h3>
                <button class="mod-modal-close" onclick="document.getElementById('accViewModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <p style="font-size:13px;color:#64748B;margin-bottom:14px">${entry?.description||''}</p>
                <table class="dash-table" style="margin:0">
                    <thead><tr><th>الحساب</th><th style="text-align:left">مدين</th><th style="text-align:left">دائن</th></tr></thead>
                    <tbody>${(lines||[]).map(l=>`<tr>
                        <td>${l.accounts?.name||l.account_code}</td>
                        <td style="text-align:left;color:#2563EB;font-weight:700">${l.debit>0?accFmt(l.debit):'—'}</td>
                        <td style="text-align:left;color:#DC2626;font-weight:700">${l.credit>0?accFmt(l.credit):'—'}</td>
                    </tr>`).join('')}</tbody>
                </table>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

// ════════════════════════════════════════════════════════════
// ██ 3) ميزان المراجعة ██
// ════════════════════════════════════════════════════════════
async function renderTrialBalance(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري حساب ميزان المراجعة...</div>';
    await accLoadTrialBalance(c, '', '');
}

async function accLoadTrialBalance(c, from, to) {
    try {
        const { data: accounts } = await sb.from('accounts').select('*').order('code');
        let query = sb.from('journal_entry_lines').select('account_code, debit, credit, journal_entries!inner(entry_date)');
        if (from) query = query.gte('journal_entries.entry_date', from);
        if (to) query = query.lte('journal_entries.entry_date', to);
        const { data: lines } = await query;

        const totals = {};
        (lines||[]).forEach(l => {
            if (!totals[l.account_code]) totals[l.account_code] = { dr: 0, cr: 0 };
            totals[l.account_code].dr += Number(l.debit||0);
            totals[l.account_code].cr += Number(l.credit||0);
        });

        let totalDr = 0, totalCr = 0;
        const rows = (accounts||[]).map(a => {
            const t = totals[a.code] || { dr: 0, cr: 0 };
            if (t.dr === 0 && t.cr === 0) return '';
            totalDr += t.dr; totalCr += t.cr;
            return `<tr>
                <td><span style="background:#F1F5F9;padding:2px 8px;border-radius:5px;font-size:11px;font-family:monospace;direction:ltr;display:inline-block">${a.code}</span></td>
                <td><strong>${a.name}</strong></td>
                <td style="font-size:11px;color:${ACC_TYPE_COLORS[a.type]}">${ACC_TYPE_LABELS[a.type]}</td>
                <td style="text-align:left;color:#2563EB;font-weight:700">${t.dr>0?accFmt(t.dr):'—'}</td>
                <td style="text-align:left;color:#DC2626;font-weight:700">${t.cr>0?accFmt(t.cr):'—'}</td>
            </tr>`;
        }).filter(Boolean).join('');

        const balanced = Math.abs(totalDr - totalCr) < 0.01;

        c.innerHTML = `
        <div style="margin-bottom:20px"><h2 style="font-size:22px;font-weight:800">⚖️ ميزان المراجعة</h2>
        <p style="font-size:13px;color:#64748B;margin-top:4px">التأكد من توازن كل الحسابات (إجمالي المدين = إجمالي الدائن)</p></div>

        <div class="dash-card" style="padding:16px;margin-bottom:16px">
            <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
                <div><label class="ob-label">من تاريخ</label><input type="date" id="tbFrom" class="ob-input" style="margin:0" value="${from}"></div>
                <div><label class="ob-label">إلى تاريخ</label><input type="date" id="tbTo" class="ob-input" style="margin:0" value="${to}"></div>
                <button class="ob-add-btn" onclick="accApplyTbFilter()">🔍 تطبيق</button>
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="renderTrialBalance(document.getElementById('app-content'))">الكل</button>
            </div>
        </div>

        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">📊</div><div class="mod-card-val">${accFmt(totalDr)}</div><div class="mod-card-lbl">إجمالي المدين</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FEE2E2;color:#DC2626">📊</div><div class="mod-card-val">${accFmt(totalCr)}</div><div class="mod-card-lbl">إجمالي الدائن</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:${balanced?'#D1FAE5':'#FEF3C7'};color:${balanced?'#059669':'#D97706'}">${balanced?'✅':'⚠️'}</div><div class="mod-card-val">${balanced?'متوازن':'غير متوازن'}</div><div class="mod-card-lbl">حالة الميزان</div></div>
        </div>

        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>الكود</th><th>الحساب</th><th>النوع</th><th style="text-align:left">مدين</th><th style="text-align:left">دائن</th>
            </tr></thead>
            <tbody>${rows || '<tr><td colspan="5" class="empty-state"><span>⚖️</span>لا توجد حركات في هذه الفترة</td></tr>'}</tbody>
            <tfoot><tr style="background:#F8FAFC;font-weight:700">
                <td colspan="3" style="padding:12px">الإجمالي</td>
                <td style="text-align:left;color:#2563EB;padding:12px">${accFmt(totalDr)}</td>
                <td style="text-align:left;color:#DC2626;padding:12px">${accFmt(totalCr)}</td>
            </tr></tfoot>
            </table>
        </div>`;

        window.accApplyTbFilter = () => {
            const f = document.getElementById('tbFrom').value;
            const t = document.getElementById('tbTo').value;
            accLoadTrialBalance(c, f, t);
        };
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

// ════════════════════════════════════════════════════════════
// ██ 4) الميزانية العمومية ██
// ════════════════════════════════════════════════════════════
async function renderBalanceSheet(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري إعداد الميزانية العمومية...</div>';
    try {
        const { data: accounts } = await sb.from('accounts').select('*');
        const { data: lines } = await sb.from('journal_entry_lines').select('account_code, debit, credit');

        const totals = {};
        (lines||[]).forEach(l => {
            if (!totals[l.account_code]) totals[l.account_code] = { dr: 0, cr: 0 };
            totals[l.account_code].dr += Number(l.debit||0);
            totals[l.account_code].cr += Number(l.credit||0);
        });

        const byType = { asset: [], liability: [], equity: [] };
        (accounts||[]).forEach(a => {
            if (!byType[a.type]) return;
            const t = totals[a.code] || { dr: 0, cr: 0 };
            const balance = a.type === 'asset' ? (t.dr - t.cr) : (t.cr - t.dr);
            if (balance !== 0) byType[a.type].push({ ...a, balance });
        });

        // صافي الربح/الخسارة (من الإيرادات - المصروفات) بيدخل في حقوق الملكية
        let revTotal = 0, expTotal = 0;
        (accounts||[]).forEach(a => {
            const t = totals[a.code] || { dr: 0, cr: 0 };
            if (a.type === 'revenue') revTotal += (t.cr - t.dr);
            if (a.type === 'expense') expTotal += (t.dr - t.cr);
        });
        const netProfit = revTotal - expTotal;

        const totalAssets = byType.asset.reduce((s,a)=>s+a.balance, 0);
        const totalLiabilities = byType.liability.reduce((s,a)=>s+a.balance, 0);
        const totalEquity = byType.equity.reduce((s,a)=>s+a.balance, 0) + netProfit;
        const balanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01;

        const section = (title, items, color, extra) => `
            <div style="margin-bottom:16px">
                <div style="font-weight:800;font-size:13px;color:${color};margin-bottom:8px">${title}</div>
                ${items.map(a=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #F8FAFC;font-size:13px">
                    <span>${a.name}</span><span style="font-weight:700">${accFmt(a.balance)}</span></div>`).join('')}
                ${extra ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #F8FAFC;font-size:13px">
                    <span>${extra.label}</span><span style="font-weight:700;color:${extra.value>=0?'#059669':'#DC2626'}">${accFmt(Math.abs(extra.value))}</span></div>` : ''}
            </div>`;

        c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
            <div><h2 style="font-size:22px;font-weight:800">🏦 الميزانية العمومية</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">حتى تاريخ اليوم — الأصول = الخصوم + حقوق الملكية</p></div>
        </div>

        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">🏦</div><div class="mod-card-val">${accFmt(totalAssets)}</div><div class="mod-card-lbl">إجمالي الأصول</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FEE2E2;color:#DC2626">📉</div><div class="mod-card-val">${accFmt(totalLiabilities)}</div><div class="mod-card-lbl">إجمالي الخصوم</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:${balanced?'#D1FAE5':'#FEF3C7'};color:${balanced?'#059669':'#D97706'}">${balanced?'✅':'⚠️'}</div><div class="mod-card-val">${balanced?'متوازنة':'غير متوازنة'}</div><div class="mod-card-lbl">حالة الميزانية</div></div>
        </div>

        <div class="dash-row">
            <div class="dash-card" style="flex:1">
                ${section('🏦 الأصول', byType.asset, '#2563EB')}
                <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid #E2E8F0;font-weight:800;font-size:14px">
                    <span>إجمالي الأصول</span><span style="color:#2563EB">${accFmt(totalAssets)}</span>
                </div>
            </div>
            <div class="dash-card" style="flex:1">
                ${section('📉 الخصوم', byType.liability, '#DC2626')}
                ${section('💼 حقوق الملكية', byType.equity, '#7C3AED', { label: netProfit>=0?'صافي الربح (الفترة الحالية)':'صافي الخسارة (الفترة الحالية)', value: netProfit })}
                <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid #E2E8F0;font-weight:800;font-size:14px">
                    <span>إجمالي الخصوم وحقوق الملكية</span><span style="color:#DC2626">${accFmt(totalLiabilities + totalEquity)}</span>
                </div>
            </div>
        </div>`;
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

// ملاحظة: accApplyTbFilter مش موجودة هنا عمداً — بتتحدد ديناميكياً
// جوه accLoadTrialBalance() وقت ما شاشة ميزان المراجعة تُفتح فعلاً.
// أي محاولة نشيرلها هنا (كمعرّف عادي) وقت تحميل السكريبت هتفشل بـ
// ReferenceError لأنها لسه مش موجودة في اللحظة دي.
Object.assign(window, {
    renderChartOfAccounts, accOpenAddAccount, accSaveAccount,
    renderJournalView, accViewEntry,
    renderTrialBalance, accLoadTrialBalance,
    renderBalanceSheet,
});
