// ════════════════════════════════════════════════════════════
// settings.js — الإعدادات العامة
// يصدّر: renderSettings(container)
// ════════════════════════════════════════════════════════════

async function renderSettings(container) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--inv-muted)">⏳ جاري التحميل...</div>`;
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
                <p style="font-size:12px;color:var(--inv-muted-light);margin-top:6px">يُستخدم كمرجع لإدخال الأرصدة الافتتاحية</p>
                <label class="ob-label" style="margin-top:14px">الهدف اليومي للمبيعات (ج.م)</label>
                <input type="number" id="set-daily-sales-target" class="ob-input" style="max-width:250px" value="${get('daily_sales_target','0')}" min="0" step="100">
                <p style="font-size:12px;color:var(--inv-muted-light);margin-top:6px">بيتعرض كخط مرجعي على رسم "اتجاه المبيعات" فى لوحة التحكم — سيبه صفر لو مش عايز تفعّله.</p>
                <label class="ob-label" style="margin-top:14px">هامش الربح المستهدف شهريًا (ج.م)</label>
                <input type="number" id="set-monthly-target-margin" class="ob-input" style="max-width:250px" value="${get('monthly_target_profit_margin','0')}" min="0" step="100">
                <p style="font-size:12px;color:var(--inv-muted-light);margin-top:6px">هدف المبيعات الشهري فى لوحة التحكم = (رواتب الموظفين النشطين + بنود المصروفات التشغيلية اللي ليها حد شهري) + الرقم ده. سيبه صفر لو مش عايز تفعّله.</p>
            </div>

            <div class="dash-card" style="padding:24px;margin-top:16px">
                <h3 style="margin:0 0 16px;font-size:15px">📊 مؤشرات لوحة التحكم</h3>
                <label class="ob-label">العميل الراكد: عدد الأيام بدون شراء</label>
                <input type="number" id="set-dash-dormant-days" class="ob-input" style="max-width:250px" value="${get('dash_dormant_customer_days','30')}" min="1" max="365" step="1">
                <p style="font-size:12px;color:var(--inv-muted-light);margin-top:6px">العميل اللي اشترى قبل كده ومشترّاش خلال العدد ده من الأيام بيتحسب "راكد" في اللوحة (من 1 إلى 365، الافتراضي 30). بيظهر بعد ما يعدّي نفس العدد من الأيام على تشغيل النظام.</p>
                <label class="ob-label" style="margin-top:14px">الصنف الراكد: عدد الأيام بدون بيع</label>
                <input type="number" id="set-dash-slow-days" class="ob-input" style="max-width:250px" value="${get('dash_slow_stock_days','60')}" min="1" max="730" step="1">
                <p style="font-size:12px;color:var(--inv-muted-light);margin-top:6px">الصنف اللي له مخزون ومتباعش خلال العدد ده من الأيام بيتحسب "راكد" (من 1 إلى 730، الافتراضي 60).</p>
                <label class="ob-label" style="margin-top:14px">تحذير المرتجعات: النسبة من المبيعات (%)</label>
                <input type="number" id="set-dash-returns-warn" class="ob-input" style="max-width:250px" value="${get('dash_returns_warn_pct','5')}" min="0" max="100" step="0.5">
                <p style="font-size:12px;color:var(--inv-muted-light);margin-top:6px">لو المرتجعات عدّت النسبة دي من مبيعات الشهر، سطرها في اللوحة بيتلوّن بالأصفر (الافتراضي 5%).</p>
                <label class="ob-label" style="margin-top:14px">شرائح أعمار الديون (بالأيام)</label>
                <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
                    <span style="font-size:13px">حتى</span>
                    <input type="number" id="set-dash-aging-1" class="ob-input" style="width:90px" value="${get('dash_aging_days_1','30')}" min="1" max="3650" step="1">
                    <span style="font-size:13px">ثم حتى</span>
                    <input type="number" id="set-dash-aging-2" class="ob-input" style="width:90px" value="${get('dash_aging_days_2','60')}" min="1" max="3650" step="1">
                    <span style="font-size:13px">ثم حتى</span>
                    <input type="number" id="set-dash-aging-3" class="ob-input" style="width:90px" value="${get('dash_aging_days_3','90')}" min="1" max="3650" step="1">
                    <span style="font-size:13px">وبعدها "أكثر من"</span>
                </div>
                <p style="font-size:12px;color:var(--inv-muted-light);margin-top:6px">بتحدد شرائح كارت "أعمار الديون" في اللوحة (الافتراضي 30 / 60 / 90). لازم الأرقام تتزايد (الأول أصغر من التاني وهكذا). الشرائح دي بتتطبق كمان على كشف حساب العميل وتقرير "أرصدة العملاء" (لو الحساب الدقيق تعذّر تحميله، الحساب التقريبي البديل بيستخدم 30/60/90).</p>
            </div>

            <div id="set-branches-card"></div>

            <div class="dash-card" style="padding:24px;margin-top:16px">
                <h3 style="margin:0 0 16px;font-size:15px">🛒 إعدادات سلطانو</h3>
                <label class="ob-label">الحد الأدنى العام للطلب (ج.م)</label>
                <input type="number" id="set-sultano-min-order" class="ob-input" style="max-width:250px" value="${get('sultanoo_min_order_amount','0')}" min="0" step="10">
                <p style="font-size:12px;color:var(--inv-muted-light);margin-top:6px">لو منطقة العميل ليها حد أدنى خاص بيها (من شاشة "إدارة المناطق")، بيتطبّق هو بدل الحد العام ده.</p>
                <p style="font-size:12px;color:var(--inv-muted-light);margin-top:14px">الحد الأقصى لكمية أي صنف في الطلب = رصيد المخزون المتاح منه تلقائياً، إلا لو الصنف ليه حد أقصى خاص (من شاشة الأصناف) فبيتطبّق هو بدل رصيد المخزون.</p>

                <label class="ob-label" style="display:flex;align-items:center;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid var(--inv-divider)">
                    <input type="checkbox" id="set-loyalty-enabled" ${get('sultanoo_loyalty_enabled','false')===true||get('sultanoo_loyalty_enabled')==='true' ? 'checked':''} style="width:auto">
                    🎁 تفعيل نظام نقاط الولاء
                </label>
                <p style="font-size:12px;color:var(--inv-muted-light);margin-top:6px">لو متفعّل، العميل بيكسب نقاط تلقائيًا لما طلبه يوصل "تم التسليم"، وبيشوف رصيده في تطبيق سلطانو. الاستبدال يدوي حاليًا (من شاشة العميل).</p>
                <label class="ob-label" style="margin-top:14px">نقطة لكل كام جنيه</label>
                <input type="number" id="set-loyalty-rate" class="ob-input" style="max-width:250px" value="${get('sultanoo_loyalty_points_per_egp','0.1')}" min="0" step="0.01">
                <p style="font-size:12px;color:var(--inv-muted-light);margin-top:6px">مثلاً 0.1 = نقطة واحدة لكل 10 ج.م. تقدر تغيّرها في أي وقت من غير ما يتأثر رصيد النقاط اللي اتكسبت قبل كده.</p>
            </div>

            <div class="dash-card" style="padding:24px;margin-top:16px">
                <h3 style="margin:0 0 16px;font-size:15px">💾 نسخة احتياطية</h3>
                <p id="sett-backup-last" style="font-size:13px;color:var(--inv-muted);margin-bottom:14px">${settFmtLastBackup(get('last_backup_at', null))}</p>
                <button class="ob-save-btn" id="sett-backup-btn" onclick="settBackupNow()">⬇️ تحميل نسخة احتياطية كاملة الآن</button>
                <p style="font-size:11.5px;color:var(--inv-muted-light);margin-top:8px;line-height:1.6">
                    بيتحمّل ملفين: HTML تفتحه بدون إنترنت (كشوف الخزن والعملاء والموردين والفواتير والقيود...) + JSON بكل البيانات الخام. بيسحب كل الصفوف وبيقارن العدد بالعدد الحقيقي. احتفظ بالملفين في مكانين (الجهاز + فلاشة) — فيهم بيانات حساسة، ما ترفعهمش على GitHub أو أي مكان عام. للأدمن فقط.
                </p>
            </div>

            <button class="ob-save-btn" style="margin-top:20px;padding:14px 32px;font-size:14px" onclick="settSaveAll()">💾 حفظ كل الإعدادات</button>
            <span id="sett-save-msg" style="margin-right:12px;font-size:13px;color:var(--inv-green);display:none">✅ تم الحفظ بنجاح</span>
        </div>`;

        // كارت الفروع (branches.js) — بيختفي لوحده لو جدول الفروع مش موجود
        if (typeof brRenderCard === 'function') brRenderCard(document.getElementById('set-branches-card'));

        window.settSaveAll = async () => {
            // مؤشرات اللوحة: نتأكد من المدى قبل الحفظ (القاعدة كمان بترجع للافتراضي لو القيمة برا المدى)
            const dashRange = (id, label, min, max) => {
                const v = parseFloat(document.getElementById(id).value);
                if (!(v >= min && v <= max)) { alert(`❌ ${label}: لازم رقم بين ${min} و ${max}`); return null; }
                return v;
            };
            const dashDormant = dashRange('set-dash-dormant-days', 'أيام العميل الراكد', 1, 365);
            const dashSlow = dashRange('set-dash-slow-days', 'أيام الصنف الراكد', 1, 730);
            const dashRetWarn = dashRange('set-dash-returns-warn', 'نسبة تحذير المرتجعات', 0, 100);
            const dashAg1 = dashRange('set-dash-aging-1', 'الشريحة الأولى (أيام)', 1, 3650);
            const dashAg2 = dashRange('set-dash-aging-2', 'الشريحة الثانية (أيام)', 1, 3650);
            const dashAg3 = dashRange('set-dash-aging-3', 'الشريحة الثالثة (أيام)', 1, 3650);
            if (dashDormant === null || dashSlow === null || dashRetWarn === null
                || dashAg1 === null || dashAg2 === null || dashAg3 === null) return;
            if (!(dashAg1 < dashAg2 && dashAg2 < dashAg3)) {
                alert('❌ شرائح أعمار الديون: لازم تتزايد (الأولى أصغر من الثانية والثانية أصغر من الثالثة)');
                return;
            }
            const entries = [
                { key: 'company_name', value: document.getElementById('set-company-name').value },
                { key: 'company_phone', value: document.getElementById('set-company-phone').value },
                { key: 'company_address', value: document.getElementById('set-company-address').value },
                { key: 'invoice_counter', value: document.getElementById('set-invoice-counter').value },
                { key: 'vat_enabled', value: String(document.getElementById('set-vat-enabled').checked) },
                { key: 'vat_rate', value: document.getElementById('set-vat-rate').value },
                { key: 'system_start_date', value: document.getElementById('set-system-start').value },
                { key: 'daily_sales_target', value: document.getElementById('set-daily-sales-target').value },
                { key: 'monthly_target_profit_margin', value: document.getElementById('set-monthly-target-margin').value },
                { key: 'dash_dormant_customer_days', value: String(dashDormant) },
                { key: 'dash_slow_stock_days', value: String(dashSlow) },
                { key: 'dash_returns_warn_pct', value: String(dashRetWarn) },
                { key: 'dash_aging_days_1', value: String(dashAg1) },
                { key: 'dash_aging_days_2', value: String(dashAg2) },
                { key: 'dash_aging_days_3', value: String(dashAg3) },
                { key: 'sultanoo_min_order_amount', value: document.getElementById('set-sultano-min-order').value },
                { key: 'sultanoo_loyalty_enabled', value: document.getElementById('set-loyalty-enabled').checked },
                { key: 'sultanoo_loyalty_points_per_egp', value: document.getElementById('set-loyalty-rate').value },
            ];
            try {
                // طلب واحد لكل الإعدادات (بدل 12 طلب ورا بعض): أسرع، وإما يتحفظوا كلهم أو ولا واحد
                const stamp = new Date().toISOString();
                const { error } = await sb.from('app_settings').upsert(
                    entries.map(e => ({ key: e.key, value: JSON.stringify(e.value), updated_at: stamp })));
                if (error) throw error;
                // الصفحة ممكن تكون اتبدّلت أثناء الحفظ — ما نكسرش الحفظ بسبب رسالة التأكيد
                const msg = document.getElementById('sett-save-msg');
                if (msg) {
                    msg.style.display = 'inline';
                    setTimeout(() => { msg.style.display = 'none'; }, 3000);
                } else {
                    alert('✅ تم حفظ الإعدادات');
                }
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

// النسخة الاحتياطية الكاملة (HTML أوفلاين + JSON) في js/modules/backup.js — بتسحب كل الصفوف
// صفحة صفحة وبتقارن العدد بالعدد الحقيقي على السيرفر. (الزرار القديم كان بيسحب أول 1000 صف بس.)
window.settBackupNow = () => {
    if (typeof backupRunFull === 'function') return backupRunFull();
    alert('وحدة النسخ الاحتياطي لسه ما اتحمّلتش — حدّث الصفحة وجرّب تاني');
};
