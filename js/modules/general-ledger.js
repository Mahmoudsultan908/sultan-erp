/* ════════════════════════════════════════════════════════════
   الأستاذ العام — general-ledger.js
   تفاصيل كل حساب بمرور الزمن (كل الحركات + رصيد متحرك)
   يصدّر: renderGeneralLedger(container)
   قراءة فقط بالكامل — لا يكتب أي شيء في قاعدة البيانات
   ════════════════════════════════════════════════════════════ */

let _glAccounts = [];
let _glSelectedCode = '';

function glFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ★ Supabase بيرجع 1000 صف كحد أقصى افتراضي لأي select عادي من غير فلتر
//   يضيّق النتيجة — لسه الحساب الأكبر (الخزينة) تحت الحد ده، لكن قريب
//   منه وبيكبر مع كل عملية، فالإصلاح هنا وقائي قبل ما يحصل نفس اللي
//   حصل في قائمة الدخل. نفس نمط الإصلاح في reports.js/accounting.js.
async function glFetchAllRows(table, select, applyFilters) {
    let all = [], from = 0;
    const pageSize = 1000;
    while (true) {
        let q = sb.from(table).select(select);
        if (applyFilters) q = applyFilters(q);
        const { data, error } = await q.range(from, from + pageSize - 1);
        if (error) return { data: null, error };
        all = all.concat(data || []);
        if (!data || data.length < pageSize) break;
        from += pageSize;
    }
    return { data: all, error: null };
}

async function renderGeneralLedger(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الأستاذ العام...</div>';
    try {
        const { data: accounts } = await sb.from('accounts').select('*').order('code');
        _glAccounts = accounts || [];
        glRenderPage(c);
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function glRenderPage(c) {
    c.innerHTML = `
        <div style="margin-bottom:20px"><h2 style="font-size:22px;font-weight:800">📖 الأستاذ العام</h2>
        <p style="font-size:13px;color:#64748B;margin-top:4px">كل حركات أي حساب بالترتيب الزمني مع الرصيد المتحرك</p></div>

        <div class="dash-card" style="padding:16px;margin-bottom:16px">
            <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
                <div style="flex:1;min-width:220px">
                    <label class="ob-label">اختر الحساب</label>
                    <select id="glAccountSelect" class="ob-input" style="margin:0" onchange="glOnAccountChange(this.value)">
                        <option value="">-- اختر حساباً --</option>
                        ${_glAccounts.map(a=>`<option value="${a.code}">${a.code} — ${a.name}</option>`).join('')}
                    </select>
                </div>
                <div><label class="ob-label">من تاريخ</label><input type="date" id="glFrom" class="ob-input" style="margin:0"></div>
                <div><label class="ob-label">إلى تاريخ</label><input type="date" id="glTo" class="ob-input" style="margin:0"></div>
                <button class="ob-add-btn" onclick="glApplyFilter()">🔍 تطبيق</button>
            </div>
        </div>

        <div id="glResult">
            <div style="text-align:center;padding:50px;color:#94A3B8">
                <div style="font-size:32px;margin-bottom:8px">📖</div>
                اختر حساباً من القائمة أعلاه لعرض حركاته بالتفصيل
            </div>
        </div>`;
}

window.glOnAccountChange = function(code) {
    _glSelectedCode = code;
    if (code) glLoadAccount(code, '', '');
    else document.getElementById('glResult').innerHTML = `<div style="text-align:center;padding:50px;color:#94A3B8">اختر حساباً لعرض حركاته</div>`;
};

window.glApplyFilter = function() {
    if (!_glSelectedCode) return alert('اختر حساباً أولاً');
    const from = document.getElementById('glFrom').value;
    const to = document.getElementById('glTo').value;
    glLoadAccount(_glSelectedCode, from, to);
};

async function glLoadAccount(code, from, to) {
    const result = document.getElementById('glResult');
    result.innerHTML = '<div style="text-align:center;padding:40px;color:#64748B">⏳ جاري التحميل...</div>';

    try {
        const account = _glAccounts.find(a => a.code === code);

        const { data: lines, error } = await glFetchAllRows(
            'journal_entry_lines',
            'debit, credit, journal_entries!inner(ref, description, entry_date, created_at)',
            (q) => {
                q = q.eq('account_code', code).order('journal_entries(entry_date)', { ascending: true });
                if (from) q = q.gte('journal_entries.entry_date', from);
                if (to) q = q.lte('journal_entries.entry_date', to);
                return q;
            }
        );
        if (error) throw error;

        const isDebitNature = ['asset', 'expense'].includes(account?.type);
        let running = 0;
        const rows = (lines || []).map(l => {
            const dr = Number(l.debit || 0);
            const cr = Number(l.credit || 0);
            running += isDebitNature ? (dr - cr) : (cr - dr);
            return { ...l.journal_entries, dr, cr, running };
        });

        const totalDr = rows.reduce((s, r) => s + r.dr, 0);
        const totalCr = rows.reduce((s, r) => s + r.cr, 0);

        result.innerHTML = `
        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">📋</div><div class="mod-card-val">${account?.code} — ${account?.name}</div><div class="mod-card-lbl">الحساب المحدد</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#F0FDF4;color:#059669">📊</div><div class="mod-card-val">${glFmt(totalDr)}</div><div class="mod-card-lbl">إجمالي مدين</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FEE2E2;color:#DC2626">📊</div><div class="mod-card-val">${glFmt(totalCr)}</div><div class="mod-card-lbl">إجمالي دائن</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#F5F3FF;color:#7C3AED">${running>=0?'📈':'📉'}</div><div class="mod-card-val" style="color:${running>=0?'#059669':'#DC2626'}">${glFmt(Math.abs(running))}</div><div class="mod-card-lbl">الرصيد الحالي</div></div>
        </div>

        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>التاريخ</th><th>المرجع</th><th>البيان</th>
                <th style="text-align:left">مدين</th><th style="text-align:left">دائن</th><th style="text-align:left">الرصيد</th>
            </tr></thead>
            <tbody>
                ${rows.length ? rows.map(r => `<tr>
                    <td class="dash-muted">${new Date(r.entry_date || r.created_at).toLocaleDateString('ar-EG')}</td>
                    <td><span style="background:#F1F5F9;padding:2px 8px;border-radius:5px;font-size:11px;font-family:monospace;direction:ltr;display:inline-block">${r.ref}</span></td>
                    <td>${r.description}</td>
                    <td style="text-align:left;color:#2563EB;font-weight:700">${r.dr>0?glFmt(r.dr):'—'}</td>
                    <td style="text-align:left;color:#DC2626;font-weight:700">${r.cr>0?glFmt(r.cr):'—'}</td>
                    <td style="text-align:left;font-weight:800;color:${r.running>=0?'#059669':'#DC2626'}">${glFmt(r.running)}</td>
                </tr>`).join('') : '<tr><td colspan="6" class="empty-state"><span>📖</span>لا توجد حركات لهذا الحساب في هذه الفترة</td></tr>'}
            </tbody>
            <tfoot><tr style="background:#F8FAFC;font-weight:700">
                <td colspan="3" style="padding:12px">الإجمالي</td>
                <td style="text-align:left;color:#2563EB;padding:12px">${glFmt(totalDr)}</td>
                <td style="text-align:left;color:#DC2626;padding:12px">${glFmt(totalCr)}</td>
                <td style="text-align:left;padding:12px;color:${running>=0?'#059669':'#DC2626'}">${glFmt(running)}</td>
            </tr></tfoot>
            </table>
        </div>`;
    } catch (err) {
        result.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

Object.assign(window, { renderGeneralLedger, glOnAccountChange, glApplyFilter });
