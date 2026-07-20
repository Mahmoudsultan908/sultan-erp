/* ════════════════════════════════════════════════════════════
   جرد فعلي (تسوية) لمخزون عربية مندوب — van-stock-count.js
   نفس فكرة تبويب "🧮 جرد فعلي" في inventory.js بالظبط، بس على van_stock
   بدل inventory_stock — راجع van_stock_count_reconciliation migration.
   مفيش أي أثر محاسبي هنا، مجرد تصحيح مباشر لكمية van_stock + سجل تدقيق
   (system_qty وقت الجرد، الكمية المعدودة، الفرق).
   يصدّر: renderVanStockCount(container)
   ════════════════════════════════════════════════════════════ */

let vscReps = [];
let vscRows = []; // { product_id, name, code, unit, system_qty }

async function renderVanStockCount(root) {
    root.innerHTML = `<div style="text-align:center;padding:40px;color:#64748B"><div style="font-size:32px;margin-bottom:8px">⏳</div>جاري تحميل المندوبين...</div>`;
    try {
        if (!vscReps.length) {
            const { data } = await sb.from('sales_reps').select('id,name').eq('is_active', true).order('name');
            vscReps = data || [];
        }
        if (!vscReps.length) {
            root.innerHTML = `<div class="dash-error"><div style="font-size:32px">⚠️</div><div>لا يوجد مندوبين نشطين</div></div>`;
            return;
        }
        const defaultRep = vscReps[0]?.id || '';
        await vscLoadRep(root, defaultRep);
    } catch (err) {
        root.innerHTML = `<div class="dash-error"><div style="font-size:32px">⚠️</div><div>خطأ: ${err.message}</div></div>`;
    }
}

async function vscLoadRep(root, repId) {
    root.innerHTML = `<div style="text-align:center;padding:40px;color:#64748B"><div style="font-size:32px;margin-bottom:8px">⏳</div>جاري تحميل الأصناف...</div>`;
    try {
        const [{ data: products }, { data: stock }] = await Promise.all([
            sb.from('products').select('id,name,code,unit').eq('is_active', true).order('name'),
            sb.from('van_stock').select('product_id,qty').eq('rep_id', repId),
        ]);
        const stockMap = {};
        (stock || []).forEach(s => stockMap[s.product_id] = Number(s.qty) || 0);
        vscRows = (products || []).map(p => ({
            product_id: p.id, name: p.name, code: p.code, unit: p.unit || 'وحدة',
            system_qty: stockMap[p.id] || 0,
        }));
        vscRenderTable(root, repId, '');
    } catch (err) {
        root.innerHTML = `<div class="dash-error"><div style="font-size:32px">⚠️</div><div>خطأ: ${err.message}</div></div>`;
    }
}

function vscRenderTable(root, repId, search) {
    const q = (search || '').toLowerCase();
    const visibleRows = vscRows.filter(r => !q || r.name.toLowerCase().includes(q) || (r.code || '').toLowerCase().includes(q));

    root.innerHTML = `
    <div class="mod-alert-banner info" style="margin-bottom:16px">
        <span>ℹ️</span>
        <span>سجّل الكمية المعدودة فعليًا في عربية المندوب لكل صنف — الأصناف اللي متسجّلش لها كمية هتتجاهل ومخزونها مش هيتأثر.</span>
    </div>
    <div class="dash-card" style="padding:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
        <select id="vsc-rep-select" style="padding:8px 12px;border:1px solid #E2E8F0;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px">
            ${vscReps.map(r => `<option value="${r.id}" ${r.id === repId ? 'selected' : ''}>${r.name}</option>`).join('')}
        </select>
        <input type="text" id="vsc-search" placeholder="🔍 بحث باسم أو كود..." value="${search || ''}" style="flex:1;min-width:180px;padding:8px 12px;border:1px solid #E2E8F0;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px">
        <span id="vsc-counted-badge" style="font-size:12px;color:#64748B;font-weight:700"></span>
    </div>
    <div class="dash-card" style="padding:0;overflow:hidden">
        <table class="dash-table" style="margin:0">
            <thead><tr><th>الصنف</th><th>الكود</th><th>رصيد النظام</th><th>الكمية المعدودة</th><th>الفرق</th></tr></thead>
            <tbody id="vsc-tbody">
                ${visibleRows.length ? visibleRows.map(r => `
                <tr>
                    <td><strong>${r.name}</strong></td>
                    <td style="direction:ltr;text-align:center">${r.code || '—'}</td>
                    <td class="dash-muted">${r.system_qty} <small>${r.unit}</small></td>
                    <td><input type="number" step="any" class="vsc-count-input" data-pid="${r.product_id}" style="width:100px;padding:6px 8px;border:1px solid #E2E8F0;border-radius:6px;font-family:Cairo,sans-serif" oninput="vscUpdateDiff(this)"></td>
                    <td class="vsc-diff-cell" data-pid-diff="${r.product_id}">—</td>
                </tr>`).join('') : `<tr><td colspan="5" style="text-align:center;padding:30px;color:#94A3B8">لا توجد نتائج</td></tr>`}
            </tbody>
        </table>
    </div>
    <div style="margin-top:16px">
        <label class="ob-label">ملاحظات (اختياري)</label>
        <textarea id="vsc-notes" class="ob-input" style="min-height:60px" placeholder="مثال: جرد بعد بلاغ بضاعة زيادة/ناقصة"></textarea>
    </div>
    <button class="ob-save-btn" style="margin-top:16px" onclick="vscConfirm('${repId}')">✅ تأكيد الجرد وتحديث مخزون العربية</button>`;

    document.getElementById('vsc-rep-select').onchange = (e) => vscLoadRep(root, e.target.value);
    const searchEl = document.getElementById('vsc-search');
    let searchTimer = null;
    searchEl.oninput = () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => vscRenderTable(root, repId, searchEl.value), 250);
    };
    vscUpdateBadge();
}

function vscUpdateDiff(inputEl) {
    const pid = inputEl.dataset.pid;
    const row = vscRows.find(r => r.product_id === pid);
    const diffCell = document.querySelector(`[data-pid-diff="${pid}"]`);
    if (!row || !diffCell) return;
    if (inputEl.value === '') { diffCell.textContent = '—'; diffCell.style.color = ''; vscUpdateBadge(); return; }
    const diff = Number(inputEl.value) - row.system_qty;
    diffCell.textContent = (diff > 0 ? '+' : '') + diff;
    diffCell.style.color = diff > 0 ? '#059669' : diff < 0 ? '#DC2626' : '#94A3B8';
    vscUpdateBadge();
}

function vscUpdateBadge() {
    const filled = document.querySelectorAll('.vsc-count-input').length
        ? [...document.querySelectorAll('.vsc-count-input')].filter(i => i.value !== '').length : 0;
    const badge = document.getElementById('vsc-counted-badge');
    if (badge) badge.textContent = filled ? `تم إدخال ${filled} صنف` : '';
}

window.vscConfirm = async (repId) => {
    const inputs = [...document.querySelectorAll('.vsc-count-input')].filter(i => i.value !== '');
    if (!inputs.length) { alert('⚠️ محتاج تدخل الكمية المعدودة لصنف واحد على الأقل'); return; }

    const items = inputs.map(i => {
        const row = vscRows.find(r => r.product_id === i.dataset.pid);
        return { product_id: i.dataset.pid, system_qty: row.system_qty, counted_qty: Number(i.value) || 0, unit_name: row.unit };
    });

    const repName = vscReps.find(r => r.id === repId)?.name || '';
    if (!confirm(`هيتم تحديث مخزون عربية "${repName}" لـ ${items.length} صنف مباشرة على الكمية اللي دخلتها. متأكد؟`)) return;

    try {
        await sb.rpc('fn_apply_van_stock_count', {
            p_rep_id: repId,
            p_notes: document.getElementById('vsc-notes')?.value || null,
            p_created_by: currentUser?.id || null,
            p_items: items,
        });
        alert(`✅ تم تحديث مخزون عربية "${repName}" لـ ${items.length} صنف بنجاح`);
        const root = document.getElementById('repMgmtBody');
        if (root) await vscLoadRep(root, repId);
    } catch (err) {
        alert('❌ خطأ أثناء تطبيق الجرد: ' + err.message);
    }
};

Object.assign(window, { renderVanStockCount, vscUpdateDiff });
