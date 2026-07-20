/* ════════════════════════════════════════════════════════════
   العملاء — customers-hub.js
   صفحة واحدة بتبويبات بدل 3 عناصر منفصلة في القائمة الجانبية —
   👤 القائمة (renderCustomersManage من master-data.js)
   📥 استيراد Excel (renderCustomerImport من customer-supplier-import.js)
   📇 كشف حساب (renderCustomers من customers.js)
   يصدّر: renderCustomersHub(container)

   ★ الانتقال المباشر من كشف الحساب لتعديل بيانات نفس العميل
   (custGoEditProfile فى customers.js) بيحط window._pendingCustHubTab='manage'
   قبل ما يدوس على عنصر القائمة الجانبية — نفس فكرة _pendingCustomerEdit
   اللي renderCustomersManage نفسها بتقرأها بالفعل، محدش لمسها.
   ════════════════════════════════════════════════════════════ */

let _custHubTab = 'manage'; // 'manage' | 'import' | 'statement'

async function renderCustomersHub(c) {
    if (window._pendingCustHubTab) { _custHubTab = window._pendingCustHubTab; window._pendingCustHubTab = null; }
    c.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <button class="mod-btn ${_custHubTab==='manage'?'mod-btn-primary':''}" onclick="custHubSwitchTab('manage')">👤 القائمة</button>
        <button class="mod-btn ${_custHubTab==='import'?'mod-btn-primary':''}" onclick="custHubSwitchTab('import')">📥 استيراد Excel</button>
        <button class="mod-btn ${_custHubTab==='statement'?'mod-btn-primary':''}" onclick="custHubSwitchTab('statement')">📇 كشف حساب</button>
    </div>
    <div id="custHubBody"></div>`;
    await custHubRenderTab();
}

async function custHubRenderTab() {
    const body = document.getElementById('custHubBody');
    if (!body) return;
    if (_custHubTab === 'manage') await renderCustomersManage(body);
    else if (_custHubTab === 'import') await renderCustomerImport(body);
    else await renderCustomers(body);
}

window.custHubSwitchTab = async function (tab) {
    _custHubTab = tab;
    await renderCustomersHub(document.getElementById('app-content'));
};

Object.assign(window, { renderCustomersHub, custHubSwitchTab });
