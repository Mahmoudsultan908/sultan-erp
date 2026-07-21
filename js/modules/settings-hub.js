/* ════════════════════════════════════════════════════════════
   الإعدادات — settings-hub.js
   صفحة واحدة بتبويبات بدل 6 عناصر منفصلة في القائمة الجانبية —
   ⚙️ عام (renderSettings من settings.js)
   👥 المستخدمون (renderUsersManagement من users-management.js)
   🔐 الصلاحيات المتقدمة (renderAdvancedPermissions من advanced-permissions.js)
   🔄 استيراد/تصدير عام (renderGeneralImportExport من general-import-export.js)
   🖨️ مركز الطباعة (renderPrintCenter من print-center.js)
   📋 الأرصدة الافتتاحية (renderOpeningBalances من opening-balances.js)
   يصدّر: renderSettingsHub(container)

   ★ زرار "اعمل نسخة الآن" فى لوحة التحكم (dashboard.js) بيحط
   window._pendingSetHubTab='general' قبل الانتقال — نفس فكرة باقي
   الـ hubs، حتى لو 'general' هو التبويب الافتراضي أصلاً.
   ════════════════════════════════════════════════════════════ */

let _setHubTab = 'general'; // 'general' | 'users' | 'permissions' | 'import-export' | 'print' | 'opening-balances'

async function renderSettingsHub(c) {
    if (window._pendingSetHubTab) { _setHubTab = window._pendingSetHubTab; window._pendingSetHubTab = null; }
    c.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <button class="mod-btn ${_setHubTab==='general'?'mod-btn-primary':''}" onclick="setHubSwitchTab('general')">⚙️ عام</button>
        <button class="mod-btn ${_setHubTab==='users'?'mod-btn-primary':''}" onclick="setHubSwitchTab('users')">👥 المستخدمون</button>
        <button class="mod-btn ${_setHubTab==='permissions'?'mod-btn-primary':''}" onclick="setHubSwitchTab('permissions')">🔐 الصلاحيات المتقدمة</button>
        <button class="mod-btn ${_setHubTab==='import-export'?'mod-btn-primary':''}" onclick="setHubSwitchTab('import-export')">🔄 استيراد/تصدير عام</button>
        <button class="mod-btn ${_setHubTab==='print'?'mod-btn-primary':''}" onclick="setHubSwitchTab('print')">🖨️ مركز الطباعة</button>
        <button class="mod-btn ${_setHubTab==='opening-balances'?'mod-btn-primary':''}" onclick="setHubSwitchTab('opening-balances')">📋 الأرصدة الافتتاحية</button>
    </div>
    <div id="setHubBody"></div>`;
    await setHubRenderTab();
}

async function setHubRenderTab() {
    const body = document.getElementById('setHubBody');
    if (!body) return;
    if (_setHubTab === 'users') await renderUsersManagement(body);
    else if (_setHubTab === 'permissions') await renderAdvancedPermissions(body);
    else if (_setHubTab === 'import-export') await renderGeneralImportExport(body);
    else if (_setHubTab === 'print') await renderPrintCenter(body);
    else if (_setHubTab === 'opening-balances') await renderOpeningBalances(body);
    else await renderSettings(body);
}

window.setHubSwitchTab = async function (tab) {
    _setHubTab = tab;
    await renderSettingsHub(document.getElementById('app-content'));
};

Object.assign(window, { renderSettingsHub, setHubSwitchTab });
