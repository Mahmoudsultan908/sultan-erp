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
