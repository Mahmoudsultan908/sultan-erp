/* ════════════════════════════════════════════════════════════
   التقارير — reports-hub.js
   صفحة واحدة بتبويبات بدل عنصرين منفصلين في القائمة الجانبية —
   📈 عام (renderReports من reports.js)
   📈 أداء متقدم (renderPerformanceReports من performance-reports.js)
   يصدّر: renderReportsHub(container)
   ════════════════════════════════════════════════════════════ */

let _rptHubTab = 'general'; // 'general' | 'performance'

// فلتر الفرع للتقارير (بيظهر بس لما يبقى فيه أكتر من فرع نشط): نفس اختيار لوحة التحكم، وبيأثر على قائمة الدخل
// وتقارير الأداء وتقارير المخازن. كشوف العملاء والموردين لكل الفروع (العملاء والموردين مشتركين).
async function rptHubBranchHtml() {
    try {
        if (typeof brIsMulti !== 'function' || !(await brIsMulti())) return '';
        const c = await brLoad(); const sel = typeof brSelectedId === 'function' ? brSelectedId() : null;
        const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
        return `<select class="ob-input" style="margin:0;width:auto;min-width:150px;font-size:13px" onchange="rptHubSetBranch(this.value)" title="فلتر الفرع">
            <option value="">🏬 كل الفروع</option>
            ${c.list.filter(b => b.is_active).map(b => `<option value="${esc(b.id)}" ${b.id === sel ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}
        </select>`;
    } catch { return ''; }
}

window.rptHubSetBranch = async function (id) {
    try { if (id) localStorage.setItem('dash_branch', id); else localStorage.removeItem('dash_branch'); } catch { /* مش مهم */ }
    try { if (typeof dashBranchSel !== 'undefined') dashBranchSel = id || null; } catch { /* اللوحة مش محمّلة */ }
    await renderReportsHub(document.getElementById('app-content'));
};

async function renderReportsHub(c) {
    const brHtml = await rptHubBranchHtml();
    c.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap;align-items:center">
        <button class="mod-btn ${_rptHubTab==='general'?'mod-btn-primary':''}" onclick="rptHubSwitchTab('general')">📈 عام</button>
        <button class="mod-btn ${_rptHubTab==='performance'?'mod-btn-primary':''}" onclick="rptHubSwitchTab('performance')">📈 أداء متقدم</button>
        ${brHtml ? `<span style="margin-right:auto;display:flex;gap:8px;align-items:center">${brHtml}</span>` : ''}
    </div>
    <div id="rptHubBody"></div>`;
    await rptHubRenderTab();
}

async function rptHubRenderTab() {
    const body = document.getElementById('rptHubBody');
    if (!body) return;
    if (_rptHubTab === 'performance') await renderPerformanceReports(body);
    else await renderReports(body);
}

window.rptHubSwitchTab = async function (tab) {
    _rptHubTab = tab;
    await renderReportsHub(document.getElementById('app-content'));
};

Object.assign(window, { renderReportsHub, rptHubSwitchTab });
