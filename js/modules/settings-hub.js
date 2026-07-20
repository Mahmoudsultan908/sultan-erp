/* ════════════════════════════════════════════════════════════
   الإعدادات — settings-hub.js
   صفحة واحدة بتبويبات بدل 3 عناصر منفصلة في القائمة الجانبية —
   ⚙️ عام (renderSettings من settings.js)
   👥 المستخدمون (renderUsersManagement من users-management.js)
   🔐 الصلاحيات المتقدمة (renderAdvancedPermissions من advanced-permissions.js)
   يصدّر: renderSettingsHub(container)

   ★ زرار "اعمل نسخة الآن" فى لوحة التحكم (dashboard.js) بيحط
   window._pendingSetHubTab='general' قبل الانتقال — نفس فكرة باقي
   الـ hubs، حتى لو 'general' هو التبويب الافتراضي أصلاً.
   ════════════════════════════════════════════════════════════ */

let _setHubTab = 'general'; // 'general' | 'users' | 'permissions'

async function renderSettingsHub(c) {
    if (window._pendingSetHubTab) { _setHubTab = window._pendingSetHubTab; window._pendingSetHubTab = null; }
    c.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <button class="mod-btn ${_setHubTab==='general'?'mod-btn-primary':''}" onclick="setHubSwitchTab('general')">⚙️ عام</button>
        <button class="mod-btn ${_setHubTab==='users'?'mod-btn-primary':''}" onclick="setHubSwitchTab('users')">👥 المستخدمون</button>
        <button class="mod-btn ${_setHubTab==='permissions'?'mod-btn-primary':''}" onclick="setHubSwitchTab('permissions')">🔐 الصلاحيات المتقدمة</button>
    </div>
    <div id="setHubBody"></div>`;
    await setHubRenderTab();
}

async function setHubRenderTab() {
    const body = document.getElementById('setHubBody');
    if (!body) return;
    if (_setHubTab === 'users') await renderUsersManagement(body);
    else if (_setHubTab === 'permissions') await renderAdvancedPermissions(body);
    else await renderSettings(body);
}

window.setHubSwitchTab = async function (tab) {
    _setHubTab = tab;
    await renderSettingsHub(document.getElementById('app-content'));
};

Object.assign(window, { renderSettingsHub, setHubSwitchTab });
