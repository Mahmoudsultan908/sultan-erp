// ════════════════════════════════════════════════════════════
// budgets.js — الميزانيات الشهرية: هدف مبيعات + ميزانية لكل بند مصروفات، ومقارنتها بالفعلي
// يصدّر: renderBudgets
//
// الفعلي بيتحسب من: صافي المبيعات (fn_report_totals) والمصروفات المؤكدة بالشهر. بيحترم فلتر الفرع المختار.
// زرار "طباعة / PDF" بيفتح نافذة طباعة نظيفة — اختار منها "حفظ كـ PDF".
// الميزة مقفولة لحد ما الأدمن يفعّلها من الإعدادات (feature_budgets).
// ════════════════════════════════════════════════════════════

let _bgMonth = new Date().toISOString().slice(0, 7), _bgData = null;

function bgEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function bgFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function bgMonthRange(m) {
    const [y, mo] = m.split('-').map(Number);
    const last = new Date(y, mo, 0).getDate();
    return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` };
}

async function renderBudgets(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري التحميل...</div>';
    try {
        if (typeof ftOn === 'function' && !(await ftOn('feature_budgets'))) {
            c.innerHTML = `<div class="dash-card" style="padding:28px;text-align:center"><div style="font-size:34px">🎯</div>
                <h3 style="margin:10px 0 6px">ميزة الميزانيات مقفولة</h3>
                <p style="font-size:13px;color:var(--inv-muted)">الأدمن يقدر يفعّلها من الإعدادات ← المميزات الإضافية.</p></div>`;
            return;
        }
        await bgLoad(c);
    } catch (err) {
        c.innerHTML = `<div style="background:var(--inv-red-bg);color:var(--inv-red);padding:20px;border-radius:12px">خطأ: ${bgEsc(err.message)}</div>`;
    }
}

async function bgLoad(c) {
    const { from, to } = bgMonthRange(_bgMonth);
    const bf = typeof brReportFilter === 'function' ? await brReportFilter() : null;
    let expQ = sb.from('expenses').select('category_id, amount').eq('status', 'confirmed').gte('expense_date', from).lte('expense_date', to);
    if (bf && typeof brApply === 'function') expQ = brApply(expQ, bf, 'tr');
    const [cats, bud, exps, tot] = await Promise.all([
        sb.from('expense_categories').select('id,name').order('name'),
        sb.from('budgets').select('*').eq('period', _bgMonth),
        expQ,
        sb.rpc('fn_report_totals', { p_from: from, p_to: to, ...(bf ? { p_branch: bf.id } : {}) }),
    ]);
    for (const r of [cats, bud, exps, tot]) if (r.error) throw r.error;
    const actualByCat = {};
    (exps.data || []).forEach(e => { actualByCat[e.category_id] = (actualByCat[e.category_id] || 0) + (Number(e.amount) || 0); });
    const budOf = (kind, cid) => (bud.data || []).find(b => b.kind === kind && (b.category_id || null) === (cid || null));
    _bgData = {
        branch: bf?.name || '',
        sales: { id: budOf('sales', null)?.id || null, budget: Number(budOf('sales', null)?.amount) || 0, actual: (Number(tot.data?.sales) || 0) - (Number(tot.data?.returns) || 0) },
        cats: (cats.data || []).map(k => ({ id: k.id, bid: budOf('expense', k.id)?.id || null, name: k.name, budget: Number(budOf('expense', k.id)?.amount) || 0, actual: actualByCat[k.id] || 0 })),
    };
    bgRender(c);
}

function bgBar(actual, budget, higherIsBetter) {
    if (!budget) return '<span style="color:var(--inv-muted);font-size:12px">لا توجد ميزانية</span>';
    const pct = (actual / budget) * 100;
    const bad = higherIsBetter ? pct < 80 : pct > 100;
    const warn = higherIsBetter ? pct < 100 : pct > 85;
    const col = bad ? 'var(--inv-red)' : warn ? '#B45309' : 'var(--inv-green)';
    return `<div style="display:flex;align-items:center;gap:8px"><div style="flex:1;min-width:70px;height:8px;background:#E2E8F0;border-radius:4px;overflow:hidden"><div style="width:${Math.min(pct, 100)}%;height:100%;background:${col}"></div></div><b style="color:${col};font-size:12px">${pct.toFixed(0)}%</b></div>`;
}

function bgRender(c) {
    c = c || document.getElementById('app-content');
    const d = _bgData;
    const totBud = d.cats.reduce((s, x) => s + x.budget, 0), totAct = d.cats.reduce((s, x) => s + x.actual, 0);
    c.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px">
        <div><h2 style="font-size:22px;font-weight:800">🎯 الميزانيات${d.branch ? ' — ' + bgEsc(d.branch) : ''}</h2>
            <p style="font-size:13px;color:var(--inv-muted);margin-top:4px">حدد هدف المبيعات وميزانية كل بند مصروفات، وقارنها بالفعلي</p></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input type="month" class="ob-input" style="margin:0;width:auto" value="${_bgMonth}" onchange="_bgMonth=this.value||_bgMonth;bgLoad(document.getElementById('app-content'))">
            <button class="mod-btn" onclick="bgPrint()">🖨️ طباعة / PDF</button>
            <button class="mod-btn mod-btn-primary" onclick="bgSave()">💾 حفظ الميزانية</button>
        </div>
    </div>
    <div class="mod-table-wrap"><table class="mod-table"><thead><tr>
        <th>البند</th><th style="width:150px">الميزانية / الهدف</th><th style="text-align:left">الفعلي</th><th style="text-align:left">الفرق</th><th style="width:170px">التحقيق</th></tr></thead><tbody>
        <tr style="background:#F8FAFC"><td><b>📈 صافي المبيعات (هدف)</b></td>
            <td><input type="number" min="0" step="0.01" class="ob-input" style="margin:0" id="bgSales" value="${d.sales.budget || ''}"></td>
            <td style="text-align:left;font-weight:700">${bgFmt(d.sales.actual)}</td>
            <td style="text-align:left;color:${d.sales.actual - d.sales.budget >= 0 ? 'var(--inv-green)' : 'var(--inv-red)'}">${d.sales.budget ? bgFmt(d.sales.actual - d.sales.budget) : '—'}</td>
            <td>${bgBar(d.sales.actual, d.sales.budget, true)}</td></tr>
        ${d.cats.map((k, i) => `<tr><td>💸 ${bgEsc(k.name)}</td>
            <td><input type="number" min="0" step="0.01" class="ob-input" style="margin:0" id="bgCat${i}" value="${k.budget || ''}"></td>
            <td style="text-align:left;font-weight:700">${bgFmt(k.actual)}</td>
            <td style="text-align:left;color:${k.budget && k.actual > k.budget ? 'var(--inv-red)' : 'inherit'}">${k.budget ? bgFmt(k.budget - k.actual) + ' متبقي' : '—'}</td>
            <td>${bgBar(k.actual, k.budget, false)}</td></tr>`).join('')}
        </tbody><tfoot><tr style="background:#F8FAFC;font-weight:800"><td>إجمالي المصروفات</td><td>${bgFmt(totBud)}</td><td style="text-align:left">${bgFmt(totAct)}</td><td></td><td>${bgBar(totAct, totBud, false)}</td></tr></tfoot></table></div>
    <p style="font-size:12px;color:var(--inv-muted-light);margin-top:10px">سيب الخانة فاضية لو مفيش ميزانية للبند. الفعلي بيتحسب من المصروفات المؤكدة ومن صافي المبيعات (بعد المرتجعات) في الشهر ده.</p>`;
}
window._bgMonth = _bgMonth;
window.bgLoad = bgLoad;

window.bgSave = async function () {
    const d = _bgData; if (!d) return;
    // كل صف: فيه رقم → تحديث (لو موجود) أو إضافة، فاضي → حذف الصف القديم لو كان موجود. من غير مسح جماعي.
    const upserts = [], deletes = [];
    const handle = (existingId, val, base) => {
        if (val >= 0) upserts.push({ ...(existingId ? { id: existingId } : {}), ...base, amount: val, updated_at: new Date().toISOString() });
        else if (existingId) deletes.push(existingId);
    };
    handle(d.sales.id, parseFloat(document.getElementById('bgSales').value), { period: _bgMonth, kind: 'sales', category_id: null });
    d.cats.forEach((k, i) => handle(k.bid, parseFloat(document.getElementById('bgCat' + i).value), { period: _bgMonth, kind: 'expense', category_id: k.id }));
    try {
        const upd = upserts.filter(r => r.id), ins = upserts.filter(r => !r.id);
        if (upd.length) { const r = await sb.from('budgets').upsert(upd, { onConflict: 'id' }); if (r.error) throw r.error; }
        if (ins.length) { const r = await sb.from('budgets').insert(ins); if (r.error) throw r.error; }
        if (deletes.length) { const r = await sb.from('budgets').delete().in('id', deletes); if (r.error) throw r.error; }
        alert('✅ اتحفظت ميزانية ' + _bgMonth);
        await bgLoad(document.getElementById('app-content'));
    } catch (err) { alert('❌ ' + err.message); }
};

window.bgPrint = function () {
    const d = _bgData; if (!d) return;
    const row = (n, b, a, hi) => `<tr><td>${bgEsc(n)}</td><td>${b ? bgFmt(b) : '—'}</td><td>${bgFmt(a)}</td><td>${b ? ((a / b) * 100).toFixed(0) + '%' : '—'}</td></tr>`;
    const w = window.open('', '_blank');
    if (!w) return alert('المتصفح منع النافذة — اسمح بالنوافذ المنبثقة وجرّب تاني');
    w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>الميزانية ${bgEsc(_bgMonth)}</title>
        <style>body{font-family:Cairo,Tahoma,sans-serif;padding:24px;color:#0F172A}h2{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:14px}
        th,td{border:1px solid #CBD5E1;padding:8px 10px;text-align:right;font-size:13px}th{background:#F1F5F9}</style></head><body>
        <h2>ميزانية شهر ${bgEsc(_bgMonth)}${d.branch ? ' — ' + bgEsc(d.branch) : ''}</h2><div style="font-size:12px;color:#64748B">تاريخ الطباعة: ${new Date().toLocaleDateString('ar-EG')}</div>
        <table><thead><tr><th>البند</th><th>الميزانية / الهدف</th><th>الفعلي</th><th>التحقيق</th></tr></thead><tbody>
        ${row('صافي المبيعات', d.sales.budget, d.sales.actual)}${d.cats.filter(k => k.budget || k.actual).map(k => row(k.name, k.budget, k.actual)).join('')}
        </tbody></table><script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
    w.document.close();
};

Object.assign(window, { renderBudgets });
