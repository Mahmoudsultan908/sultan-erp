/* ════════════════════════════════════════════════════════════
   الموردين — suppliers-hub.js
   صفحة واحدة بتبويبات بدل 3 عناصر منفصلة في القائمة الجانبية —
   🏭 القائمة (renderSuppliersManage من master-data.js)
   📥 استيراد Excel (renderSupplierImport من customer-supplier-import.js)
   📇 كشف حساب (renderSuppliers من suppliers.js)
   يصدّر: renderSuppliersHub(container)

   ★ نفس فكرة customers-hub.js بالظبط — window._pendingSuppHubTab='manage'
   بتتحط من suppGoEditProfile فى suppliers.js قبل الانتقال.
   ════════════════════════════════════════════════════════════ */

let _suppHubTab = 'manage'; // 'manage' | 'import' | 'statement'

async function renderSuppliersHub(c) {
    if (window._pendingSuppHubTab) { _suppHubTab = window._pendingSuppHubTab; window._pendingSuppHubTab = null; }
    c.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <button class="mod-btn ${_suppHubTab==='manage'?'mod-btn-primary':''}" onclick="suppHubSwitchTab('manage')">🏭 القائمة</button>
        <button class="mod-btn ${_suppHubTab==='import'?'mod-btn-primary':''}" onclick="suppHubSwitchTab('import')">📥 استيراد Excel</button>
        <button class="mod-btn ${_suppHubTab==='statement'?'mod-btn-primary':''}" onclick="suppHubSwitchTab('statement')">📇 كشف حساب</button>
    </div>
    <div id="suppHubBody"></div>`;
    await suppHubRenderTab();
}

async function suppHubRenderTab() {
    const body = document.getElementById('suppHubBody');
    if (!body) return;
    if (_suppHubTab === 'manage') await renderSuppliersManage(body);
    else if (_suppHubTab === 'import') await renderSupplierImport(body);
    else await renderSuppliers(body);
}

window.suppHubSwitchTab = async function (tab) {
    _suppHubTab = tab;
    await renderSuppliersHub(document.getElementById('app-content'));
};

Object.assign(window, { renderSuppliersHub, suppHubSwitchTab });
