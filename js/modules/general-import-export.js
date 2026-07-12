/* ════════════════════════════════════════════════════════════
   استيراد/تصدير عام — general-import-export.js
   يصدّر: renderGeneralImportExport(container)

   أداة إدارية عامة (لمدير النظام فقط):
   - تصدير: أي جدول من الجداول الرئيسية لملف Excel خام (أعمدة = أسماء
     أعمدة قاعدة البيانات الحقيقية، بدون ترجمة) — مفيد كنسخة احتياطية
     سريعة أو للمراجعة خارج النظام.
   - استيراد: مقصور عمداً على جداول البيانات المرجعية "الآمنة" فقط
     (مخازن، بنود مصروفات، مناطق/تصنيفات/مجموعات عملاء، مستويات أسعار،
     مندوبين، شجرة حسابات) — ولا يشمل أبداً الجداول التي فيها Triggers
     مالية (sales/purchases/sale_items/... إلخ) لأن استيراد صف خام
     فيها هيتخطى محرك القيود/المخزون تماماً ويكسر الأرصدة. الأصناف
     والعملاء والموردين ليهم شاشات استيراد مخصصة أدق (product-import.js
     وcustomer-supplier-import.js) — الأداة دي مش بديل لهم.

   نمط "صدّر → عدّل → استورد": زرار "تنزيل قالب" بيصدّر بيانات الجدول
   الحالي كما هي، عشان يبقى واضح شكل الأعمدة المطلوبة بالظبط.
   ════════════════════════════════════════════════════════════ */

const GX_EXPORT_TABLES = [
    ['products', 'الأصناف'], ['customers', 'العملاء'], ['suppliers', 'الموردون'],
    ['warehouses', 'المخازن'], ['inventory_stock', 'أرصدة المخزون'],
    ['sales', 'فواتير المبيعات'], ['sale_items', 'بنود فواتير المبيعات'],
    ['purchases', 'فواتير المشتريات'], ['purchase_items', 'بنود فواتير المشتريات'],
    ['sales_returns', 'مرتجعات المبيعات'], ['purchase_returns', 'مرتجعات المشتريات'],
    ['customer_payments', 'تحصيلات العملاء'], ['supplier_payments', 'دفعات الموردين'],
    ['expenses', 'المصروفات'], ['expense_categories', 'بنود المصروفات'],
    ['accounts', 'شجرة الحسابات'], ['journal_entries', 'القيود اليومية'],
    ['journal_entry_lines', 'سطور القيود'], ['quotations', 'عروض الأسعار'],
    ['purchase_orders', 'أوامر الشراء'], ['customer_regions', 'مناطق العملاء'],
    ['customer_classifications', 'تصنيفات العملاء'], ['customer_groups', 'مجموعات العملاء'],
    ['price_levels', 'مستويات الأسعار'], ['product_prices', 'أسعار الأصناف حسب المستوى'],
    ['sales_reps', 'المندوبون'], ['opening_balances', 'الأرصدة الافتتاحية'],
    ['profiles', 'المستخدمون'], ['app_settings', 'إعدادات النظام'],
];

const GX_IMPORT_TABLES = [
    ['warehouses', 'المخازن'], ['expense_categories', 'بنود المصروفات'],
    ['customer_regions', 'مناطق العملاء'], ['customer_classifications', 'تصنيفات العملاء'],
    ['customer_groups', 'مجموعات العملاء'], ['price_levels', 'مستويات الأسعار'],
    ['sales_reps', 'المندوبون'], ['accounts', 'شجرة الحسابات'],
];

let _gxTab = 'export'; // 'export' | 'import'
let _gxParsedRows = [];

function gxToday() { return new Date().toISOString().slice(0, 10); }

async function gxCurrentIsAdmin() {
    if (window._currentUserRole) return window._currentUserRole === 'admin';
    try {
        const { data: { user } } = await sb.auth.getUser();
        if (!user) return false;
        const { data: p } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle();
        if (!p) return true; // فشل آمن — نفس فلسفة usrCurrentIsAdmin
        return p.role === 'admin';
    } catch { return true; }
}

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي
// ════════════════════════════════════════════════════════════
async function renderGeneralImportExport(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري التحقق من الصلاحيات...</div>';
    const isAdmin = await gxCurrentIsAdmin();
    if (!isAdmin) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:24px;border-radius:12px;text-align:center">
            <div style="font-size:32px;margin-bottom:8px">🔒</div>
            هذه الصفحة متاحة لمدير النظام فقط.
        </div>`;
        return;
    }
    _gxTab = 'export';
    _gxParsedRows = [];
    gxRenderPage(c);
}

window.gxSwitchTab = function (tab) {
    _gxTab = tab;
    _gxParsedRows = [];
    gxRenderPage(document.getElementById('app-content'));
};

function gxRenderPage(c) {
    c.innerHTML = `
    <div style="margin-bottom:20px"><h2 style="font-size:22px;font-weight:800">🔄 استيراد وتصدير عام</h2>
    <p style="font-size:13px;color:#64748B;margin-top:4px">تصدير أي جدول لإكسل، واستيراد بيانات مرجعية عامة — أداة إدارية لمدير النظام</p></div>
    <div class="ob-tabs">
        <button class="ob-tab ${_gxTab === 'export' ? 'active' : ''}" onclick="gxSwitchTab('export')">📤 تصدير</button>
        <button class="ob-tab ${_gxTab === 'import' ? 'active' : ''}" onclick="gxSwitchTab('import')">📥 استيراد</button>
    </div>
    <div id="gx-body" style="margin-top:16px"></div>`;
    if (_gxTab === 'export') gxRenderExportTab();
    else gxRenderImportTab();
}

// ════════════════════════════════════════════════════════════
// 2) تصدير
// ════════════════════════════════════════════════════════════
function gxRenderExportTab() {
    const body = document.getElementById('gx-body');
    if (!body) return;
    body.innerHTML = `
    <div class="dash-card" style="padding:20px">
        <label class="ob-label" style="margin-top:0">اختر الجدول</label>
        <select id="gxExportTable" class="ob-input" style="max-width:340px">
            ${GX_EXPORT_TABLES.map(([v, l]) => `<option value="${v}">${l} <span style="direction:ltr">(${v})</span></option>`).join('')}
        </select>
        <div style="margin-top:14px">
            <button class="mod-btn mod-btn-primary" onclick="gxExport()">📤 تصدير Excel</button>
        </div>
        <div style="background:#EFF6FF;border:1px solid #BFDBFE;color:#1E40AF;padding:10px 14px;border-radius:8px;font-size:12px;margin-top:16px">
            💡 التصدير خام (أعمدة الملف = أعمدة قاعدة البيانات الفعلية، بدون ترجمة) — بحد أقصى 5000 صف لكل تصدير.
        </div>
    </div>`;
}

window.gxExport = async function () {
    const table = document.getElementById('gxExportTable')?.value;
    if (!table) return alert('اختر جدولاً');
    try {
        const { data, error } = await sb.from(table).select('*').limit(5000);
        if (error) throw error;
        if (!data || !data.length) { alert('⚠️ الجدول فارغ — لا يوجد بيانات للتصدير'); return; }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, table.slice(0, 31));
        XLSX.writeFile(wb, `${table}_${gxToday()}.xlsx`);
    } catch (err) {
        alert('❌ خطأ أثناء التصدير: ' + err.message);
    }
};

// ════════════════════════════════════════════════════════════
// 3) استيراد (مقصور على الجداول المرجعية الآمنة)
// ════════════════════════════════════════════════════════════
function gxRenderImportTab() {
    const body = document.getElementById('gx-body');
    if (!body) return;
    body.innerHTML = `
    <div style="background:#FFFBEB;border:1px solid #FED7AA;color:#92400E;padding:10px 14px;border-radius:8px;font-size:12px;margin-bottom:16px">
        ⚠️ الاستيراد هنا مقصور عمداً على جداول البيانات المرجعية (مخازن، بنود مصروفات، مناطق/تصنيفات/مجموعات عملاء، مستويات أسعار، مندوبين، شجرة حسابات).
        الأصناف/العملاء/الموردين ليهم شاشات استيراد مخصصة أدق (📥 استيراد أصناف/عملاء/موردين Excel من القائمة الجانبية).
        باقي الجداول (فواتير، مرتجعات، قيود...) مش متاحة للاستيراد العام هنا لأنها مرتبطة بمحرك مخزون/محاسبة تلقائي (Triggers) هيتخطّاه أي استيراد خام.
    </div>
    <div class="dash-card" style="padding:20px">
        <label class="ob-label" style="margin-top:0">اختر الجدول</label>
        <select id="gxImportTable" class="ob-input" style="max-width:340px">
            ${GX_IMPORT_TABLES.map(([v, l]) => `<option value="${v}">${l} <span style="direction:ltr">(${v})</span></option>`).join('')}
        </select>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px">
            <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="gxDownloadTemplate()">📄 تنزيل بيانات الجدول الحالي كقالب</button>
            <input type="file" id="gxFileInput" accept=".xlsx,.xls" style="display:none" onchange="gxHandleFile(this.files[0])">
            <button class="mod-btn mod-btn-primary" onclick="document.getElementById('gxFileInput').click()">📂 اختر ملف Excel</button>
            <span id="gxFileName" style="font-size:12.5px;color:#64748B"></span>
        </div>
        <div style="background:#EFF6FF;border:1px solid #BFDBFE;color:#1E40AF;padding:10px 14px;border-radius:8px;font-size:12px;margin-top:14px">
            💡 لو عمود <code>id</code> في صف معيّن فيه قيمة موجودة فعلاً، هيتحدّث الصف ده. لو فاضي، هيتضاف صف جديد. أي عمود فاضي في الملف بيتم تجاهله (مش هيبعت قيمة فاضية تكسر نوع العمود).
        </div>
    </div>
    <div id="gxPreviewArea"></div>`;
}

window.gxDownloadTemplate = async function () {
    const table = document.getElementById('gxImportTable')?.value;
    if (!table) return alert('اختر جدولاً');
    try {
        const { data, error } = await sb.from(table).select('*').limit(5000);
        if (error) throw error;
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(data && data.length ? data : []);
        XLSX.utils.book_append_sheet(wb, ws, table.slice(0, 31));
        XLSX.writeFile(wb, `قالب_${table}_${gxToday()}.xlsx`);
    } catch (err) {
        alert('❌ خطأ: ' + err.message);
    }
};

window.gxHandleFile = async function (file) {
    if (!file) return;
    const table = document.getElementById('gxImportTable')?.value;
    if (!table) { alert('اختر جدولاً أولاً'); return; }
    const nameEl = document.getElementById('gxFileName');
    if (nameEl) nameEl.textContent = '📄 ' + file.name;

    try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (!rows.length) { alert('⚠️ الملف فارغ'); return; }

        // تنظيف: شيل أي عمود فاضي لكل صف (يشمل id الفاضي) عشان قاعدة
        // البيانات تولّد القيم الافتراضية بنفسها بدل ما نبعت سترينج
        // فاضي '' لعمود uuid/boolean/رقمي فيرفضه Postgres.
        _gxParsedRows = rows.map(r => {
            const clean = {};
            Object.entries(r).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) clean[k] = v; });
            return clean;
        }).filter(r => Object.keys(r).length > 0);

        gxRenderPreview(table);
    } catch (err) {
        alert('❌ خطأ في قراءة الملف: ' + err.message);
    }
};

function gxRenderPreview(table) {
    const area = document.getElementById('gxPreviewArea');
    if (!area) return;
    if (!_gxParsedRows.length) { area.innerHTML = ''; return; }

    const cols = [...new Set(_gxParsedRows.flatMap(r => Object.keys(r)))];
    area.innerHTML = `
    <div class="dash-card" style="padding:20px;margin-top:16px">
        <div style="font-weight:800;margin-bottom:10px">معاينة (${_gxParsedRows.length} صف)</div>
        <div style="overflow-x:auto">
            <table class="mod-table"><thead><tr>${cols.map(c => `<th style="white-space:nowrap">${c}</th>`).join('')}</tr></thead>
            <tbody>${_gxParsedRows.slice(0, 10).map(r => `<tr>${cols.map(c => `<td style="white-space:nowrap">${r[c] ?? ''}</td>`).join('')}</tr>`).join('')}</tbody></table>
        </div>
        ${_gxParsedRows.length > 10 ? `<div style="font-size:12px;color:#94A3B8;margin-top:6px">...و${_gxParsedRows.length - 10} صف إضافي</div>` : ''}
        <button class="mod-btn mod-btn-primary" style="margin-top:14px" onclick="gxConfirmImport('${table}')">✅ تأكيد الاستيراد إلى ${table}</button>
    </div>`;
}

window.gxConfirmImport = async function (table) {
    if (!_gxParsedRows.length) return;
    if (!confirm(`هيتم استيراد ${_gxParsedRows.length} صف لجدول "${table}". متابعة؟`)) return;

    const btn = document.querySelector('#gxPreviewArea .mod-btn-primary');
    if (btn) { btn.innerText = '⏳ جاري الاستيراد...'; btn.disabled = true; }
    try {
        const { error } = await sb.from(table).upsert(_gxParsedRows);
        if (error) throw error;
        alert(`✅ تم استيراد ${_gxParsedRows.length} صف بنجاح إلى ${table}`);
        _gxParsedRows = [];
        const area = document.getElementById('gxPreviewArea');
        if (area) area.innerHTML = '';
        const fileInput = document.getElementById('gxFileInput');
        if (fileInput) fileInput.value = '';
        const nameEl = document.getElementById('gxFileName');
        if (nameEl) nameEl.textContent = '';
    } catch (err) {
        alert('❌ خطأ أثناء الاستيراد: ' + err.message);
        if (btn) { btn.innerText = '✅ تأكيد الاستيراد'; btn.disabled = false; }
    }
};

Object.assign(window, {
    renderGeneralImportExport, gxSwitchTab, gxExport, gxDownloadTemplate, gxHandleFile, gxConfirmImport,
});
