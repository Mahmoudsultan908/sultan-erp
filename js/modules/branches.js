// ════════════════════════════════════════════════════════════
// branches.js — الفروع: إدارة الفروع (كارت في الإعدادات) + اختيار الفرع في نماذج المخزن والخزنة
// يصدّر: brLoad, brIsMulti, brSelectHtml, brName, brRenderCard
//
// فكرة التصميم: الفرع بيتحدد على المخزن والخزنة بس. أي فاتورة/مصروف/تحصيل بيتحسب على فرع
// مخزنه أو خزنته (v_doc_branch في القاعدة) — مفيش branch_id على الحركات نفسها.
// لو جدول الفروع مش موجود (الـ migration لسه ما اتطبقش) كل حاجة هنا بتختفي من غير أخطاء.
// فرع واحد بس (الرئيسي) = مفيش اختيار فرع في أي نموذج؛ النظام شغال زي ما هو.
// ════════════════════════════════════════════════════════════

let _brCache = null;   // { ok, list }

function brEsc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function brLoad(force) {
    if (_brCache && !force) return _brCache;
    try {
        const { data, error } = await sb.from('branches').select('*').order('is_main', { ascending: false }).order('name');
        _brCache = error ? { ok: false, list: [] } : { ok: true, list: data || [] };
    } catch { _brCache = { ok: false, list: [] }; }
    return _brCache;
}

// أكتر من فرع نشط؟ (وقتها بس بنظهر اختيار الفرع في النماذج)
async function brIsMulti() {
    const c = await brLoad();
    return c.ok && c.list.filter(b => b.is_active).length > 1;
}

function brName(list, id) {
    const b = (list || []).find(x => x.id === id);
    return b ? b.name : '';
}

// <select> للفرع — فاضي ('') لو فرع واحد بس. لو الفرع الحالي معطّل بنسيبه ظاهر عشان ما يتغيّرش بالغلط.
async function brSelectHtml(selectId, selectedId) {
    const c = await brLoad();
    if (!c.ok || c.list.filter(b => b.is_active).length < 2) return '';
    const opts = c.list.filter(b => b.is_active || b.id === selectedId)
        .map(b => `<option value="${b.id}" ${b.id === (selectedId || (c.list.find(x => x.is_main) || {}).id) ? 'selected' : ''}>${brEsc(b.name)}${b.is_active ? '' : ' (معطّل)'}</option>`).join('');
    return `<div class="mod-form-group"><label>الفرع</label><select id="${selectId}" class="mod-form-input">${opts}</select></div>`;
}

// ── فلتر الفرع للتقارير ──
// الفرع المختار = نفس اختيار لوحة التحكم (localStorage 'dash_branch') — فاضي = كل الفروع.
// فرع المستند = فرع مخزنه لو له مخزن، وإلا فرع خزنته، وإلا الفرع الرئيسي (نفس fn_branch_of في القاعدة).
function brSelectedId() { try { return localStorage.getItem('dash_branch') || null; } catch { return null; } }
const _brFilterCache = {};
async function brReportFilter() {
    const id = brSelectedId(); if (!id) return null;
    const c = await brLoad(); const b = c.ok ? c.list.find(x => x.id === id && x.is_active) : null;
    if (!b) return null;                                   // فرع اتحذف/اتعطّل → كل الفروع
    if (_brFilterCache[id] && Date.now() - _brFilterCache[id].t < 60000) return _brFilterCache[id].f;
    const [w, t] = await Promise.all([ sb.from('warehouses').select('id').eq('branch_id', id), sb.from('treasuries').select('id').eq('branch_id', id) ]);
    const wh = (w.data || []).map(x => x.id), tr = (t.data || []).map(x => x.id), none = '00000000-0000-0000-0000-000000000000';
    const doc = [];
    if (wh.length) doc.push(`warehouse_id.in.(${wh.join(',')})`);
    if (tr.length) doc.push(`and(warehouse_id.is.null,treasury_id.in.(${tr.join(',')}))`);
    if (b.is_main) doc.push('and(warehouse_id.is.null,treasury_id.is.null)');
    const trOnly = [];
    if (tr.length) trOnly.push(`treasury_id.in.(${tr.join(',')})`);
    if (b.is_main) trOnly.push('treasury_id.is.null');
    const f = { id, name: b.name, wh, tr, isMain: !!b.is_main,
        docOr: doc.length ? doc.join(',') : `warehouse_id.eq.${none}`,       // مستندات فيها مخزن + خزنة (مبيعات، مرتجعات...)
        trOr: trOnly.length ? trOnly.join(',') : `treasury_id.eq.${none}` };   // مستندات فيها خزنة بس (تحصيلات، مدفوعات، مصروفات)
    _brFilterCache[id] = { t: Date.now(), f };
    return f;
}
// بيطبّق الفلتر على استعلام (kind: 'doc' | 'tr'، foreign: اسم الجدول لو الاستعلام على جدول متداخل زي sales!inner)
function brApply(q, f, kind, foreign) {
    if (!f) return q;
    const expr = kind === 'tr' ? f.trOr : f.docOr;
    return foreign ? q.or(expr, { foreignTable: foreign, referencedTable: foreign }) : q.or(expr);
}

// ── كارت إدارة الفروع (الإعدادات العامة) ──
async function brRenderCard(el) {
    if (!el) return;
    const c = await brLoad(true);
    if (!c.ok) { el.innerHTML = ''; return; }   // الجدول مش موجود لسه → مفيش كارت
    const isAdmin = window._currentUserRole === 'admin';
    const rows = c.list.map(b => `
        <tr>
            <td><b>${brEsc(b.name)}</b> ${b.is_main ? '<span class="dash-badge dash-badge-green">⭐ الرئيسي</span>' : ''}</td>
            <td dir="ltr" style="text-align:right">${brEsc(b.code || '')}</td>
            <td>${b.is_active ? '<span style="color:var(--inv-green)">نشط</span>' : '<span style="color:var(--inv-muted)">معطّل</span>'}</td>
            <td style="white-space:nowrap">${isAdmin ? `
                <button class="cc-edit" onclick="brRename('${b.id}')" title="تعديل الاسم">✏️</button>
                ${b.is_main ? '' : `<button class="cc-edit" onclick="brToggle('${b.id}', ${b.is_active})" title="${b.is_active ? 'تعطيل' : 'تفعيل'}">${b.is_active ? '⏸️' : '▶️'}</button>
                <button class="cc-edit" onclick="brDelete('${b.id}')" title="حذف (لو مفيش مخازن/خزن تابعة له)">🗑️</button>`}` : ''}</td>
        </tr>`).join('');
    el.innerHTML = `
        <div class="dash-card" style="padding:24px;margin-top:16px">
            <h3 style="margin:0 0 6px;font-size:15px">🏬 الفروع</h3>
            <p style="font-size:12px;color:var(--inv-muted-light);margin:0 0 12px;line-height:1.7">
                كل مخزن وكل خزنة بتتبع فرع، وأي فاتورة أو مصروف أو تحصيل بيتحسب على فرع مخزنه/خزنته. دلوقتي عندك فرع واحد (الرئيسي) فكل حاجة شغالة زي ما هي؛
                لما تضيف فرع تاني هيظهر اختيار الفرع في شاشتي المخازن والخزن.</p>
            <div class="mod-table-wrap"><table class="mod-table"><thead><tr><th>الفرع</th><th>الكود</th><th>الحالة</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
            ${isAdmin ? `
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:center">
                <input type="text" id="brNewName" class="ob-input" style="margin:0;max-width:220px" placeholder="اسم الفرع الجديد">
                <input type="text" id="brNewCode" class="ob-input" style="margin:0;max-width:120px" placeholder="كود (اختياري)" dir="ltr">
                <button class="ob-save-btn" onclick="brAdd()">+ إضافة فرع</button>
            </div>` : '<p style="font-size:12px;color:var(--inv-muted)">إدارة الفروع للأدمن فقط.</p>'}
        </div>`;
}

async function brAfterChange() {
    await brLoad(true);
    brRenderCard(document.getElementById('set-branches-card'));
}

window.brAdd = async function () {
    const name = (document.getElementById('brNewName')?.value || '').trim();
    const code = (document.getElementById('brNewCode')?.value || '').trim();
    if (!name) return alert('اسم الفرع مطلوب');
    try {
        const { error } = await sb.from('branches').insert({ name, code: code || null });
        if (error) throw error;
        await brAfterChange();
    } catch (err) { alert('❌ تعذّرت الإضافة: ' + (/duplicate/i.test(err.message) ? 'الاسم أو الكود مستخدم قبل كده' : err.message)); }
};

window.brRename = async function (id) {
    const c = await brLoad();
    const b = c.list.find(x => x.id === id); if (!b) return;
    const name = prompt('اسم الفرع:', b.name); if (name === null) return;
    if (!name.trim()) return alert('الاسم مطلوب');
    try {
        const { error } = await sb.from('branches').update({ name: name.trim() }).eq('id', id);
        if (error) throw error;
        await brAfterChange();
    } catch (err) { alert('❌ ' + (/duplicate/i.test(err.message) ? 'الاسم مستخدم قبل كده' : err.message)); }
};

window.brToggle = async function (id, active) {
    if (!confirm(active ? 'تعطيل الفرع؟ مخازنه وخزنه تفضل موجودة، بس هو مش هيظهر كخيار جديد.' : 'إعادة تفعيل الفرع؟')) return;
    try {
        const { error } = await sb.from('branches').update({ is_active: !active }).eq('id', id);
        if (error) throw error;
        await brAfterChange();
    } catch (err) { alert('❌ ' + err.message); }
};

window.brDelete = async function (id) {
    const c = await brLoad();
    const b = c.list.find(x => x.id === id); if (!b) return;
    if (!confirm(`حذف الفرع "${b.name}" نهائياً؟`)) return;
    try {
        const { error } = await sb.from('branches').delete().eq('id', id);
        if (error) throw error;
        await brAfterChange();
    } catch (err) {
        alert('❌ ' + (/foreign key|violates/i.test(err.message) ? 'مينفعش تحذف الفرع ده: فيه مخازن أو خزن تابعة له. انقلها لفرع تاني أو عطّل الفرع بدل الحذف.' : err.message));
    }
};

Object.assign(window, { brLoad, brIsMulti, brSelectHtml, brName, brRenderCard, brSelectedId, brReportFilter, brApply });
