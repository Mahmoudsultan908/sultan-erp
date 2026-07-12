let currentUser = null;

(async function initApp() {
    // التأكد من أن supabase متاح قبل الاستخدام
    if (typeof sb === 'undefined') {
        document.getElementById('root').innerHTML = '<p style="text-align:center;margin-top:50px">خطأ في تحميل قاعدة البيانات. تأكد من ملف supabase.js</p>';
        return;
    }
    
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
        document.getElementById('root').innerHTML = `
            <div class="login-wrapper">
                <div class="login-card">
                    <div class="login-logo">🏪</div>
                    <h2 style="margin-bottom:6px;color:#0F172A">مرحباً بك في Sultan ERP</h2>
                    <p style="color:#64748B;margin-bottom:20px">سجّل دخولك للمتابعة</p>
                    <input type="email" id="loginEmail" class="login-input" placeholder="البريد الإلكتروني" dir="ltr">
                    <input type="password" id="loginPass" class="login-input" placeholder="كلمة المرور" dir="ltr" onkeydown="if(event.key==='Enter')handleLogin()">
                    <button id="loginBtn" class="login-btn" onclick="handleLogin()">تسجيل الدخول</button>
                    <p id="loginErr" style="color:#DC2626;margin-top:16px;font-size:13px;display:none"></p>
                </div>
            </div>
        `;
    } else {
        currentUser = session.user;
        buildLayout();
        setupApp();
    }
})();

async function handleLogin() {
    const btn = document.getElementById('loginBtn');
    btn.innerText = 'جاري التحقق...'; 
    btn.disabled = true;
    try {
        const { data, error } = await sb.auth.signInWithPassword({ 
            email: document.getElementById('loginEmail').value, 
            password: document.getElementById('loginPass').value 
        });
        if (error) throw error;
        currentUser = data.user;
        buildLayout();
        setupApp();
    } catch (err) {
        const errEl = document.getElementById('loginErr');
        errEl.style.display = 'block';
        errEl.innerText = err.message;
    } finally {
        btn.innerText = 'تسجيل الدخول'; 
        btn.disabled = false;
    }
}

function buildLayout() {
    document.getElementById('root').innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="sidebar-logo">
            <div class="logo-icon">🏪</div>
            <div class="logo-text"><h1>Sultan ERP</h1><span>SMART EDITION V2.0</span></div>
        </div>
        <div class="nav-group">لوحة التحكم</div>
        <div class="nav-item active" data-mod="dashboard" onclick="loadMod(this, 'dashboard')">🏠 الرئيسية</div>

        <div class="nav-group">البيانات الأساسية</div>
        <div class="nav-item" data-mod="products" onclick="loadMod(this, 'products')">🏷️ الأصناف</div>
        <div class="nav-item" data-mod="product-import" onclick="loadMod(this, 'product-import')">📥 استيراد أصناف Excel</div>
        <div class="nav-item" data-mod="customers-manage" onclick="loadMod(this, 'customers-manage')">👤 إدارة العملاء</div>
        <div class="nav-item" data-mod="customer-import" onclick="loadMod(this, 'customer-import')">📥 استيراد عملاء Excel</div>
        <div class="nav-item" data-mod="suppliers-manage" onclick="loadMod(this, 'suppliers-manage')">🏭 إدارة الموردين</div>
        <div class="nav-item" data-mod="supplier-import" onclick="loadMod(this, 'supplier-import')">📥 استيراد موردين Excel</div>

        <div class="nav-group">المبيعات والعملاء</div>
        <div class="nav-item" data-mod="sales" onclick="loadMod(this, 'sales')">🧾 فاتورة المبيعات</div>
        <div class="nav-item" data-mod="quotations" onclick="loadMod(this, 'quotations')">📋 عروض الأسعار</div>
        <div class="nav-item" data-mod="collections" onclick="loadMod(this, 'collections')">💵 تحصيل العملاء</div>
        <div class="nav-item" data-mod="customers" onclick="loadMod(this, 'customers')">📇 كشف حساب عميل</div>

        <div class="nav-group">المشتريات والموردين</div>
        <div class="nav-item" data-mod="purchases" onclick="loadMod(this, 'purchases')">📥 فاتورة المشتريات</div>
        <div class="nav-item" data-mod="purchase-orders" onclick="loadMod(this, 'purchase-orders')">📋 أوامر الشراء</div>
        <div class="nav-item" data-mod="payments" onclick="loadMod(this, 'payments')">💸 دفع الموردين</div>
        <div class="nav-item" data-mod="suppliers" onclick="loadMod(this, 'suppliers')">📇 كشف حساب مورد</div>

        <div class="nav-group">المراجعة والمرتجعات</div>
        <div class="nav-item" data-mod="invoice-review" onclick="loadMod(this, 'invoice-review')">🔍 مراجعة الفواتير</div>
        <div class="nav-item" data-mod="returns" onclick="loadMod(this, 'returns')">↩️ المرتجعات</div>

        <div class="nav-group">المالية والمخزن</div>
        <div class="nav-item" data-mod="expenses" onclick="loadMod(this, 'expenses')">💸 المصروفات</div>
        <div class="nav-item" data-mod="stock-transfer" onclick="loadMod(this, 'stock-transfer')">🔄 تحويل مخزون</div>
        <div class="nav-item" data-mod="inventory" onclick="loadMod(this, 'inventory')">📦 المخزون</div>
        <div class="nav-item" data-mod="warehouses" onclick="loadMod(this, 'warehouses')">🏭 إدارة المخازن</div>

        <div class="nav-group">المحاسبة</div>
        <div class="nav-item" data-mod="coa" onclick="loadMod(this, 'coa')">📒 شجرة الحسابات</div>
        <div class="nav-item" data-mod="journal" onclick="loadMod(this, 'journal')">📝 القيود اليومية</div>
        <div class="nav-item" data-mod="ledger" onclick="loadMod(this, 'ledger')">📖 الأستاذ العام</div>
        <div class="nav-item" data-mod="cash-movement" onclick="loadMod(this, 'cash-movement')">💰 حركة الخزينة</div>
        <div class="nav-item" data-mod="audit-log" onclick="loadMod(this, 'audit-log')">🔐 سجل التدقيق</div>
        <div class="nav-item" data-mod="trialbalance" onclick="loadMod(this, 'trialbalance')">⚖️ ميزان المراجعة</div>
        <div class="nav-item" data-mod="balancesheet" onclick="loadMod(this, 'balancesheet')">🏦 الميزانية العمومية</div>

        <div class="nav-group">🔜 قريباً</div>
        <div class="nav-item" data-mod="warehouse-reports" onclick="loadMod(this, 'warehouse-reports')">📊 تقارير المخازن</div>
        <div class="nav-item" data-mod="general-import-export" onclick="loadMod(this, 'general-import-export')">🔄 استيراد/تصدير عام</div>
        <div class="nav-item" data-mod="sales-reps" onclick="loadMod(this, 'sales-reps')">🚗 المندوبون</div>
        <div class="nav-item" data-mod="performance-reports" onclick="loadMod(this, 'performance-reports')">📈 تقارير الأداء المتقدمة</div>
        <div class="nav-item" data-mod="advanced-permissions" onclick="loadMod(this, 'advanced-permissions')">🔐 الصلاحيات المتقدمة</div>
        <div class="nav-item" data-mod="print-center" onclick="loadMod(this, 'print-center')">🖨️ مركز الطباعة</div>
        <div class="nav-item" data-mod="crm" onclick="loadMod(this, 'crm')">🤝 إدارة علاقات العملاء</div>
        <div class="nav-item" data-mod="archive" onclick="loadMod(this, 'archive')">🗄️ الأرشيف</div>
        <div class="nav-item" data-mod="whatsapp" onclick="loadMod(this, 'whatsapp')">💬 تكامل واتساب</div>
        <div class="nav-item" data-mod="ai-dashboard" onclick="loadMod(this, 'ai-dashboard')">🤖 لوحة الذكاء الاصطناعي</div>
        <div class="nav-item" data-mod="employee-evaluation" onclick="loadMod(this, 'employee-evaluation')">⭐ تقييم الموظفين</div>
        <div class="nav-item" data-mod="customer-orders-link" onclick="loadMod(this, 'customer-orders-link')">🔗 ربط برنامج طلبات العملاء</div>
        <div class="nav-item" data-mod="rep-app-link" onclick="loadMod(this, 'rep-app-link')">📱 ربط برنامج المندوب</div>

        <div class="nav-group">التقارير والإعدادات</div>
        <div class="nav-item" data-mod="reports" onclick="loadMod(this, 'reports')">📈 التقارير</div>
        <div class="nav-item" data-mod="opening-balances" onclick="loadMod(this, 'opening-balances')">📋 الأرصدة الافتتاحية</div>
        <div class="nav-item" data-mod="settings" onclick="loadMod(this, 'settings')">⚙️ الإعدادات</div>
        <div class="nav-item" data-mod="users" onclick="loadMod(this, 'users')">👥 المستخدمون</div>
        
        <div class="sidebar-footer"><span>© 2026 Sultan Food</span><span style="color:#3B82F6">v2.0</span></div>
      </aside>
      <div class="main">
        <div class="topbar">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="sidebar-toggle" id="sidebarToggle" onclick="toggleSidebar()" title="إظهار/إخفاء القائمة (Alt+H)">☰</button>
            <div class="topbar-title" id="topbarTitle">لوحة تحكم المصروفات</div>
          </div>
          <div class="topbar-actions">
            <div class="badge-offline" id="topbarOffline" onclick="offlineOpenPanel()" title="حالة الاتصال والمزامنة">🟢 متصل</div>
            <div class="badge-cash" id="topbarCash">جاري التحميل...</div>
            <div class="user-profile">
                <div class="user-avatar" id="userAvatar">م</div>
                <div class="user-info" id="userBadge">جاري التحميل...</div>
            </div>
            <button class="btn-logout" onclick="handleLogout()">خروج</button>
          </div>
        </div>
        <div class="content" id="app-content"></div>
      </div>
    </div>`;
}

async function setupApp() {
    restoreSidebarState();
    document.getElementById('userAvatar').textContent = currentUser.email.charAt(0).toUpperCase();
    document.getElementById('userBadge').innerHTML = `${currentUser.email} <span>مدير النظام</span>`;
    if (typeof refreshOnlineState === 'function') { await refreshOnlineState(); offlineUpdateBadge(); }
    try {
        const { data: cash } = await sb.rpc('get_cash_balance');
        document.getElementById('topbarCash').textContent = '💰 ' + (cash || 0).toFixed(2) + ' ج.م';
    } catch(e) {
        document.getElementById('topbarCash').textContent = '💰 0.00 ج.م';
    }
    
    loadMod(document.querySelector('[data-mod="dashboard"]'), 'dashboard');
}

window.loadMod = async function(el, modName) {
    if (el) {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        el.classList.add('active');
    }
    if (window.innerWidth <= 1100) document.body.classList.remove('sidebar-open');
    
    const c = document.getElementById('app-content');
    if (!c) return;
    c.innerHTML = '<p style="text-align:center;padding:40px;">جاري تحميل الواجهة...</p>';
    
    const titles = {
        'dashboard': 'لوحة التحكم',
        'products': 'إدارة الأصناف',
        'product-import': 'استيراد الأصناف من Excel',
        'customers-manage': 'إدارة العملاء',
        'customer-import': 'استيراد العملاء من Excel',
        'suppliers-manage': 'إدارة الموردين',
        'supplier-import': 'استيراد الموردين من Excel',
        'expenses': 'لوحة تحكم المصروفات',
        'stock-transfer': 'تحويل مخزون',
        'sales': 'فاتورة مبيعات جديدة',
        'quotations': 'عروض الأسعار',
        'purchases': 'فاتورة مشتريات جديدة',
        'purchase-orders': 'أوامر الشراء',
        'payments': 'دفع الموردين (سندات صرف)',
        'collections': 'تحصيل العملاء (سندات قبض)',
        'customers': 'كشف حساب عميل',
        'suppliers': 'كشف حساب مورد',
        'invoice-review': 'مراجعة الفواتير وتعديلها',
        'returns': 'المرتجعات',
        'inventory': 'المخزون',
        'warehouses': 'إدارة المخازن',
        'coa': 'شجرة الحسابات',
        'journal': 'القيود اليومية',
        'ledger': 'الأستاذ العام',
        'cash-movement': 'حركة الخزينة التفصيلية',
        'audit-log': 'سجل التدقيق',
        'trialbalance': 'ميزان المراجعة',
        'balancesheet': 'الميزانية العمومية',
        'warehouse-reports': 'تقارير المخازن',
        'general-import-export': 'استيراد وتصدير عام',
        'sales-reps': 'المندوبون',
        'performance-reports': 'تقارير الأداء المتقدمة',
        'advanced-permissions': 'الصلاحيات المتقدمة',
        'print-center': 'مركز الطباعة',
        'crm': 'إدارة علاقات العملاء',
        'archive': 'الأرشيف',
        'whatsapp': 'تكامل واتساب',
        'ai-dashboard': 'لوحة الذكاء الاصطناعي',
        'employee-evaluation': 'تقييم الموظفين',
        'customer-orders-link': 'ربط برنامج طلبات العملاء',
        'rep-app-link': 'ربط برنامج المندوب',
        'reports': 'التقارير المالية',
        'opening-balances': 'الأرصدة الافتتاحية',
        'settings': 'الإعدادات العامة',
        'users': 'إدارة المستخدمين'
    };
    if (titles[modName]) document.getElementById('topbarTitle').innerText = titles[modName];
    
    if (modName === 'dashboard' && typeof renderDashboard === 'function') await renderDashboard(c);
    if (modName === 'products' && typeof renderProducts === 'function') await renderProducts(c);
    if (modName === 'product-import' && typeof renderProductImport === 'function') await renderProductImport(c);
    if (modName === 'customers-manage' && typeof renderCustomersManage === 'function') await renderCustomersManage(c);
    if (modName === 'customer-import' && typeof renderCustomerImport === 'function') await renderCustomerImport(c);
    if (modName === 'suppliers-manage' && typeof renderSuppliersManage === 'function') await renderSuppliersManage(c);
    if (modName === 'supplier-import' && typeof renderSupplierImport === 'function') await renderSupplierImport(c);
    if (modName === 'expenses' && typeof renderExpenses === 'function') await renderExpenses(c);
    if (modName === 'stock-transfer' && typeof renderStockTransfer === 'function') await renderStockTransfer(c);
    if (modName === 'sales' && typeof renderSales === 'function') await renderSales(c);
    if (modName === 'quotations' && typeof renderQuotations === 'function') await renderQuotations(c);
    if (modName === 'purchases' && typeof renderPurchases === 'function') await renderPurchases(c);
    if (modName === 'purchase-orders' && typeof renderPurchaseOrders === 'function') await renderPurchaseOrders(c);
    if (modName === 'payments' && typeof renderPayments === 'function') await renderPayments(c);
    if (modName === 'collections' && typeof renderCollections === 'function') await renderCollections(c);
    if (modName === 'customers' && typeof renderCustomers === 'function') await renderCustomers(c);
    if (modName === 'suppliers' && typeof renderSuppliers === 'function') await renderSuppliers(c);
    if (modName === 'invoice-review' && typeof renderInvoiceReview === 'function') await renderInvoiceReview(c);
    if (modName === 'returns' && typeof renderReturns === 'function') await renderReturns(c);
    if (modName === 'inventory' && typeof renderInventory === 'function') await renderInventory(c);
    if (modName === 'warehouses' && typeof renderWarehouses === 'function') await renderWarehouses(c);
    if (modName === 'coa' && typeof renderChartOfAccounts === 'function') await renderChartOfAccounts(c);
    if (modName === 'journal' && typeof renderJournalView === 'function') await renderJournalView(c);
    if (modName === 'ledger' && typeof renderGeneralLedger === 'function') await renderGeneralLedger(c);
    if (modName === 'cash-movement' && typeof renderCashMovement === 'function') await renderCashMovement(c);
    if (modName === 'audit-log' && typeof renderAuditLog === 'function') await renderAuditLog(c);
    if (modName === 'trialbalance' && typeof renderTrialBalance === 'function') await renderTrialBalance(c);
    if (modName === 'balancesheet' && typeof renderBalanceSheet === 'function') await renderBalanceSheet(c);
    if (modName === 'warehouse-reports' && typeof renderWarehouseReports === 'function') await renderWarehouseReports(c);
    if (modName === 'general-import-export' && typeof renderGeneralImportExport === 'function') await renderGeneralImportExport(c);
    if (modName === 'sales-reps' && typeof renderSalesReps === 'function') await renderSalesReps(c);
    if (modName === 'performance-reports' && typeof renderPerformanceReports === 'function') await renderPerformanceReports(c);
    if (modName === 'advanced-permissions' && typeof renderAdvancedPermissions === 'function') await renderAdvancedPermissions(c);
    if (modName === 'print-center' && typeof renderPrintCenter === 'function') await renderPrintCenter(c);
    if (modName === 'crm' && typeof renderCRM === 'function') await renderCRM(c);
    if (modName === 'archive' && typeof renderArchive === 'function') await renderArchive(c);
    if (modName === 'whatsapp' && typeof renderWhatsAppIntegration === 'function') await renderWhatsAppIntegration(c);
    if (modName === 'ai-dashboard' && typeof renderAIDashboard === 'function') await renderAIDashboard(c);
    if (modName === 'employee-evaluation' && typeof renderEmployeeEvaluation === 'function') await renderEmployeeEvaluation(c);
    if (modName === 'customer-orders-link' && typeof renderCustomerOrdersLink === 'function') await renderCustomerOrdersLink(c);
    if (modName === 'rep-app-link' && typeof renderRepAppLink === 'function') await renderRepAppLink(c);
    if (modName === 'reports' && typeof renderReports === 'function') await renderReports(c);
    if (modName === 'opening-balances' && typeof renderOpeningBalances === 'function') await renderOpeningBalances(c);
    if (modName === 'settings' && typeof renderSettings === 'function') await renderSettings(c);
    if (modName === 'users' && typeof renderUsersManagement === 'function') await renderUsersManagement(c);
}

window.handleLogout = async function() {
    await sb.auth.signOut();
    location.reload();
};

// ── الشريط الجانبي قابل للطي (ديسكتوب) / منزلق (شاشات صغيرة) ──
window.toggleSidebar = function(force) {
    const sbEl = document.querySelector('.sidebar');
    if (!sbEl) return;
    const isMobile = window.innerWidth <= 1100;

    if (isMobile) {
        const open = (force !== undefined) ? force : !document.body.classList.contains('sidebar-open');
        document.body.classList.toggle('sidebar-open', open);
    } else {
        const collapse = (force !== undefined) ? force : !sbEl.classList.contains('collapsed');
        sbEl.classList.toggle('collapsed', collapse);
        localStorage.setItem('sidebar_collapsed', collapse ? '1' : '0');
        const btn = document.getElementById('sidebarToggle');
        if (btn) btn.textContent = collapse ? '◗' : '☰';
    }
};
function restoreSidebarState() {
    if (window.innerWidth <= 1100) return; // الموبايل دايماً يبدأ مقفول (افتراضي من CSS)
    if (localStorage.getItem('sidebar_collapsed') === '1') {
        const sb = document.querySelector('.sidebar');
        if (sb) sb.classList.add('collapsed');
        const btn = document.getElementById('sidebarToggle');
        if (btn) btn.textContent = '◗';
    }
}
document.addEventListener('click', (e) => {
    // الضغط على الخلفية المعتمة (overlay) يقفل القائمة في الموبايل
    if (document.body.classList.contains('sidebar-open') && !e.target.closest('.sidebar') && !e.target.closest('.sidebar-toggle')) {
        window.toggleSidebar(false);
    }
});
document.addEventListener('keydown', (e) => {
    // Alt+H → طي/إظهار الشريط الجانبي (Ctrl+H كانت بتتصادم مع سجل التصفح في كروم)
    if (e.altKey && (e.key === 'h' || e.key === 'H' || e.key === 'ة')) {
        e.preventDefault();
        window.toggleSidebar();
    }
});
// إقفال تلقائي للقائمة بعد اختيار صفحة في الشاشات الصغيرة (تجربة استخدام أفضل)
const _origLoadModForSidebar = window.loadMod;

// ── تسجيل Service Worker (يفعّل خيار "تثبيت على سطح المكتب") ──
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    });
}