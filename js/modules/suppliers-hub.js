/* ════════════════════════════════════════════════════════════
   الموردين — suppliers-hub.js
   صفحة واحدة بتبويبات —
   🏭 القائمة (renderSuppliersManage من master-data.js — فيها التعديل
      وزرار "📄 كشف حساب" مع بعض دلوقتي، بعد دمج بند 4 بتاريخ 2026-07-25)
   📥 استيراد Excel (renderSupplierImport من customer-supplier-import.js)
   يصدّر: renderSuppliersHub(container)

   ★ نفس فكرة customers-hub.js بالظبط — window._pendingSuppHubTab='manage'
   بتتحط من suppGoEditProfile فى suppliers.js قبل الانتقال.
   ════════════════════════════════════════════════════════════ */

let _suppHubTab = 'manage'; // 'manage' | 'import' | 'decision'

async function renderSuppliersHub(c) {
    if (window._pendingSuppHubTab) { _suppHubTab = window._pendingSuppHubTab; window._pendingSuppHubTab = null; }
    c.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <button class="mod-btn ${_suppHubTab==='manage'?'mod-btn-primary':''}" onclick="suppHubSwitchTab('manage')">🏭 القائمة</button>
        <button class="mod-btn ${_suppHubTab==='import'?'mod-btn-primary':''}" onclick="suppHubSwitchTab('import')">📥 استيراد Excel</button>
        <button class="mod-btn ${_suppHubTab==='decision'?'mod-btn-primary':''}" onclick="suppHubSwitchTab('decision')">🎯 مركز القرار</button>
    </div>
    <div id="suppHubBody"></div>`;
    await suppHubRenderTab();
}

async function suppHubRenderTab() {
    const body = document.getElementById('suppHubBody');
    if (!body) return;
    if (_suppHubTab === 'import') await renderSupplierImport(body);
    else if (_suppHubTab === 'decision') await renderSupplierDecisionCenter(body);
    else await renderSuppliersManage(body);
}

window.suppHubSwitchTab = async function (tab) {
    _suppHubTab = tab;
    await renderSuppliersHub(document.getElementById('app-content'));
};

Object.assign(window, { renderSuppliersHub, suppHubSwitchTab });
