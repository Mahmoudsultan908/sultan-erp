// ════════════════════════════════════════════════════════════
// settings.js — الإعدادات العامة
// يصدّر: renderSettings(container)
// ════════════════════════════════════════════════════════════

async function renderSettings(container) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:#64748B">⏳ جاري التحميل...</div>`;
    try {
        const { data: settings } = await sb.from('app_settings').select('*');
        const map = {};
        (settings||[]).forEach(s => map[s.key] = s.value);

        const get = (key, def='') => {
            try { return JSON.parse(map[key]); } catch { return map[key] ?? def; }
        };

        container.innerHTML = `
        <div class="set-wrap">
            <div class="dash-header">
                <div><h2 class="dash-title">⚙️ الإعدادات العامة</h2><p class="dash-sub">إعدادات النظام الأساسية</p></div>
            </div>

            <div class="dash-row">
                <div class="dash-card" style="flex:1;padding:24px">
                    <h3 style="margin:0 0 16px;font-size:15px">🏢 بيانات الشركة</h3>
                    <label class="ob-label">اسم الشركة</label>
                    <input type="text" id="set-company-name" class="ob-input" value="${get('company_name','Sultan Food Products')}">
                    <label class="ob-label">رقم الهاتف</label>
                    <input type="text" id="set-company-phone" class="ob-input" value="${get('company_phone','')}" dir="ltr">
                    <label class="ob-label">العنوان</label>
                    <input type="text" id="set-company-address" class="ob-input" value="${get('company_address','')}">
                </div>

                <div class="dash-card" style="flex:1;padding:24px">
                    <h3 style="margin:0 0 16px;font-size:15px">🧾 إعدادات الفواتير</h3>
                    <label class="ob-label">رقم الفاتورة التالي</label>
                    <input type="number" id="set-invoice-counter" class="ob-input" value="${get('invoice_counter','1')}" min="1">
                    <label class="ob-label" style="display:flex;align-items:center;gap:8px;margin-top:14px">
                        <input type="checkbox" id="set-vat-enabled" ${get('vat_enabled','false')==='true'||get('vat_enabled')===true ? 'checked':''} style="width:auto">
                        تفعيل ضريبة القيمة المضافة
                    </label>
                    <label class="ob-label">نسبة الضريبة (%)</label>
                    <input type="number" id="set-vat-rate" class="ob-input" value="${get('vat_rate','14')}" min="0" max="100" step="0.5">
                </div>
            </div>

            <div class="dash-card" style="padding:24px;margin-top:16px">
                <h3 style="margin:0 0 16px;font-size:15px">📅 إعدادات النظام</h3>
                <label class="ob-label">تاريخ بداية استخدام النظام</label>
                <input type="date" id="set-system-start" class="ob-input" style="max-width:250px" value="${get('system_start_date', new Date().toISOString().slice(0,10))}">
                <p style="font-size:12px;color:#94A3B8;margin-top:6px">يُستخدم كمرجع لإدخال الأرصدة الافتتاحية</p>
                <label class="ob-label" style="margin-top:14px">الهدف اليومي للمبيعات (ج.م)</label>
                <input type="number" id="set-daily-sales-target" class="ob-input" style="max-width:250px" value="${get('daily_sales_target','0')}" min="0" step="100">
                <p style="font-size:12px;color:#94A3B8;margin-top:6px">بيتعرض كخط مرجعي على رسم "اتجاه المبيعات" فى لوحة التحكم — سيبه صفر لو مش عايز تفعّله.</p>
            </div>

            <div class="dash-card" style="padding:24px;margin-top:16px">
                <h3 style="margin:0 0 16px;font-size:15px">💾 نسخة احتياطية</h3>
                <p id="sett-backup-last" style="font-size:13px;color:#64748B;margin-bottom:14px">${settFmtLastBackup(get('last_backup_at', null))}</p>
                <button class="ob-save-btn" id="sett-backup-btn" onclick="settBackupNow()">⬇️ تحميل نسخة احتياطية الآن</button>
                <p style="font-size:11.5px;color:#94A3B8;margin-top:8px;line-height:1.6">
                    بيتحمّل ملف JSON واحد فيه كل بيانات النظام (الأصناف، العملاء، الموردين، الفواتير، المرتجعات، الحسابات، المخزون...) — احتفظ بيه في مكان آمن (إيميلك، جوجل درايف، فلاشة) بعيد عن الجهاز نفسه.
                </p>
            </div>

            <button class="ob-save-btn" style="margin-top:20px;padding:14px 32px;font-size:14px" onclick="settSaveAll()">💾 حفظ كل الإعدادات</button>
            <span id="sett-save-msg" style="margin-right:12px;font-size:13px;color:#059669;display:none">✅ تم الحفظ بنجاح</span>
        </div>`;

        window.settSaveAll = async () => {
            const entries = [
                { key: 'company_name', value: document.getElementById('set-company-name').value },
                { key: 'company_phone', value: document.getElementById('set-company-phone').value },
                { key: 'company_address', value: document.getElementById('set-company-address').value },
                { key: 'invoice_counter', value: document.getElementById('set-invoice-counter').value },
                { key: 'vat_enabled', value: String(document.getElementById('set-vat-enabled').checked) },
                { key: 'vat_rate', value: document.getElementById('set-vat-rate').value },
                { key: 'system_start_date', value: document.getElementById('set-system-start').value },
                { key: 'daily_sales_target', value: document.getElementById('set-daily-sales-target').value },
            ];
            try {
                for (const e of entries) {
                    await sb.from('app_settings').upsert({ key: e.key, value: JSON.stringify(e.value), updated_at: new Date().toISOString() });
                }
                const msg = document.getElementById('sett-save-msg');
                msg.style.display = 'inline';
                setTimeout(()=> msg.style.display='none', 3000);
            } catch(err) {
                alert('❌ خطأ في الحفظ: ' + err.message);
            }
        };

    } catch(err) {
        container.innerHTML = `<div class="dash-error"><div style="font-size:32px">⚠️</div><div>خطأ: ${err.message}</div></div>`;
    }
}

function settFmtLastBackup(iso) {
    if (!iso) return '⚠️ لسه معملتش أي نسخة احتياطية';
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    const when = d.toLocaleString('ar-EG', { day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });
    return `آخر نسخة احتياطية: ${when}${days > 0 ? ` (من ${days} يوم)` : ' (اليوم)'}`;
}

// ★ الجداول المُتضمَّنة في النسخة الاحتياطية — كل جداول Sultan ERP
//   الفعلية (بيانات أساسية + حركات مالية/مخزون)، عدا جداول اللوج/
//   الإشعارات (activity_logs, notifications) وجداول تانية في نفس
//   مشروع Supabase مش تابعة للتطبيق ده أصلاً (tasks, conversations...).
const SETT_BACKUP_TABLES = [
    'products','product_categories','product_companies','price_levels','product_prices',
    'customer_regions','customer_classifications','customer_groups','customers','suppliers',
    'warehouses','inventory_stock','accounts','expense_categories','cash_transactions',
    'journal_entries','journal_entry_lines','sales','sale_items','sales_returns','sale_return_items',
    'purchases','purchase_items','purchase_returns','purchase_return_items','purchase_orders',
    'purchase_order_items','quotations','quotation_items','expenses','expense_violations',
    'customer_collections','customer_payments','supplier_payments','opening_balances',
    'deferred_rebates','deferred_rebates_manual','deferred_rebate_settlements',
    'deferred_rebate_settlement_items','financial_events','inventory_transfers',
    'inventory_transfer_items','stock_transfers','stock_transfer_items','sales_reps',
    'treasuries','treasury_transfers','balance_transfers','employees','employee_evaluations',
    'archive_documents','customer_interactions','role_permissions','van_stock',
    'customer_orders','customer_order_items','banners','attendance_records',
    'system_settings','app_settings',
];

window.settBackupNow = async () => {
    const btn = document.getElementById('sett-backup-btn');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ جاري تجهيز النسخة...';
    try {
        const results = await Promise.all(
            SETT_BACKUP_TABLES.map(t => sb.from(t).select('*').then(r => ({ table: t, ...r })))
        );
        const backup = { exported_at: new Date().toISOString(), tables: {} };
        const failedTables = [];
        results.forEach(r => {
            if (r.error) { failedTables.push(r.table); return; }
            backup.tables[r.table] = r.data;
        });

        const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toISOString().slice(0,16).replace(/[:T]/g,'-');
        a.href = url;
        a.download = `sultan-erp-backup-${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        const nowIso = new Date().toISOString();
        await sb.from('app_settings').upsert({ key: 'last_backup_at', value: JSON.stringify(nowIso), updated_at: nowIso });
        const lastEl = document.getElementById('sett-backup-last');
        if (lastEl) lastEl.textContent = settFmtLastBackup(nowIso);

        if (failedTables.length) {
            alert('⚠️ اتحمّلت النسخة لكن بعض الجداول فشلت (ممكن تكون مش موجودة أو الصلاحيات ماسمحتش): ' + failedTables.join(', '));
        }
    } catch (err) {
        alert('❌ خطأ أثناء تجهيز النسخة الاحتياطية: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = original;
    }
};
