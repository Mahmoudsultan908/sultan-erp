/* ════════════════════════════════════════════════════════════
   إعدادات تطبيق سلطانو — sultanoo-settings.js
   إدارة الإعدادات الخاصة بتطبيق الكتالوج (سلطانو):
   - وضع الإجازة (vacation_mode)
   - رسالة الإجازة (vacation_message)
   - طريقة عرض الأقسام (category_display_mode)
   يصدّر: renderSultanooSettings(container)
   ════════════════════════════════════════════════════════════ */

let _sultanooSettingsContainer = null; // بند 2026-09-22: الحاوية الوحيدة اللي
// بتتعرض جواها الإعدادات دلوقتي هي corBody (customer-orders-review.js)

// بند 2026-09-23: دالة إشعار "شو تووست" مش معرّفة في أي مكان في البرنامج
// كله (خطأ أصلي موجود قبل أي تعديل من عندنا) — عرّفنا Toast خاص بالملف ده،
// على نفس نمط invToast/posToast/purToast الموجودين في باقي الشاشات.
function sultanooToast(msg, type = 'info') {
    let t = document.getElementById('sultanooSetToast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'sultanooSetToast'; t.className = 'inv-toast';
        document.body.appendChild(t);
    }
    t.className = 'inv-toast ' + type;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(window._sultanooSetToastT);
    window._sultanooSetToastT = setTimeout(() => t.classList.remove('show'), 2600);
}

async function renderSultanooSettings(c) {
    _sultanooSettingsContainer = c;
    if (typeof sb === 'undefined') { c.innerHTML = '<p class="error-msg">⚠️ غير متصل بقاعدة البيانات</p>'; return; }

    c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--inv-muted)">⏳ جارٍ تحميل إعدادات سلطانو...</div>';

    try {
        // جلب الإعدادات الحالية
        const { data: settings, error } = await sb
            .from('app_settings')
            .select('key, value')
            .in('key', ['vacation_mode', 'vacation_message', 'category_display_mode', 'sultanoo_default_price_level']);
        // مستويات الأسعار المتاحة (لاختيار المستوى الافتراضي للعملاء اللي ملهمش مجموعة)
        let priceLevels = [];
        try {
            const { data: pls } = await sb.from('price_levels').select('code, name').order('name');
            priceLevels = pls || [];
        } catch { /* لو فشل الاختيار بيتخفى والإعداد القديم يفضل شغال */ }

        console.log('Sultanoo settings response:', { settings, error });

        if (error) throw error;

        // تحويل المصفوفة إلى object
        const settingsObj = {};
        (settings || []).forEach(s => {
            settingsObj[s.key] = s.value;
        });

        console.log('Settings object:', settingsObj);

        const vacationMode = settingsObj.vacation_mode === true;
        const vacationMessage = settingsObj.vacation_message || '';
        const categoryMode = settingsObj.category_display_mode || 'main';
        const defaultLevel = String(settingsObj.sultanoo_default_price_level ?? '').replace(/^"|"$/g, '') || 'SPECIAL';
        const lvlEsc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

        console.log('Parsed values:', { vacationMode, vacationMessage, categoryMode });

        c.innerHTML = `
        <div class="dash-card" style="max-width:800px;margin:0 auto">
            <h2 style="margin:0 0 20px;color:var(--inv-text)">📱 إعدادات تطبيق سلطانو (الكتالوج)</h2>

            <!-- وضع الإجازة -->
            <div class="mod-card" style="margin-bottom:20px;padding:20px">
                <h3 style="margin:0 0 12px;color:var(--inv-text);font-size:16px">🌴 وضع الإجازة</h3>
                <p style="color:var(--inv-muted);font-size:13px;margin-bottom:15px">
                    عند التفعيل، يتم إيقاف التطبيق بالكامل وعرض شاشة إجازة للعملاء
                </p>

                <div style="margin-bottom:15px">
                    <label class="ob-label">
                        <input type="checkbox" id="sultanooVacationMode" ${vacationMode ? 'checked' : ''}>
                        <span style="font-weight:600;margin-right:8px">تفعيل وضع الإجازة</span>
                    </label>
                </div>

                <div id="sultanooVacationMessageBox" style="display:${vacationMode ? 'block' : 'none'}">
                    <label class="ob-label">رسالة الإجازة (اختياري)</label>
                    <textarea id="sultanooVacationMessage" class="mod-form-input" rows="3"
                        placeholder="مثال: نحن في إجازة حتى 15 سبتمبر، هنرجع قريباً 🌴"
                        style="width:100%;resize:vertical">${vacationMessage}</textarea>
                    <div style="font-size:12px;color:var(--inv-muted-light);margin-top:5px">
                        إذا تركت فارغاً، سيظهر النص الافتراضي: "التطبيق في إجازة مؤقتة"
                    </div>
                </div>
            </div>

            <!-- طريقة عرض الأقسام -->
            <div class="mod-card" style="margin-bottom:20px;padding:20px">
                <h3 style="margin:0 0 12px;color:var(--inv-text);font-size:16px">📂 طريقة عرض الأقسام في الرئيسية</h3>
                <p style="color:var(--inv-muted);font-size:13px;margin-bottom:15px">
                    اختر كيف تريد عرض الأقسام في الصفحة الرئيسية للتطبيق
                </p>

                <div style="display:flex;gap:15px;flex-direction:column">
                    <label class="ob-label">
                        <input type="radio" name="categoryMode" value="main" ${categoryMode === 'main' ? 'checked' : ''}>
                        <span style="font-weight:600;margin-right:8px">الأقسام الرئيسية فقط</span>
                        <span style="color:var(--inv-muted);font-size:12px">(الوضع الافتراضي)</span>
                    </label>

                    <label class="ob-label">
                        <input type="radio" name="categoryMode" value="sub" ${categoryMode === 'sub' ? 'checked' : ''}>
                        <span style="font-weight:600;margin-right:8px">كل الأقسام الفرعية مباشرة</span>
                        <span style="color:var(--inv-muted);font-size:12px">(بدون أقسام رئيسية)</span>
                    </label>
                </div>
            </div>

            <!-- مستوى السعر الافتراضي -->
            ${priceLevels.length ? `
            <div class="mod-card" style="margin-bottom:20px;padding:20px">
                <h3 style="margin:0 0 12px;color:var(--inv-text);font-size:16px">💲 مستوى السعر الافتراضي</h3>
                <p style="color:var(--inv-muted);font-size:13px;margin-bottom:15px;line-height:1.7">
                    العميل اللي مالوش مجموعة (زي أي عميل جديد سجّل نفسه من التطبيق) بياخد الأسعار حسب المستوى ده — في الكتالوج وفي الطلب. العميل اللي ليه مجموعة بياخد مستوى مجموعته زي ما هو.
                </p>
                <select id="sultanooDefaultLevel" class="mod-form-input" style="max-width:300px">
                    ${priceLevels.map(l => `<option value="${lvlEsc(l.code)}" ${l.code === defaultLevel ? 'selected' : ''}>${lvlEsc(l.name)} (${lvlEsc(l.code)})</option>`).join('')}
                </select>
            </div>` : ''}

            <!-- أزرار الحفظ -->
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
                <button class="mod-btn mod-btn-primary" onclick="sultanooSaveSettings()" style="min-width:120px">
                    💾 حفظ التعديلات
                </button>
            </div>
        </div>`;

        // إظهار/إخفاء رسالة الإجازة حسب التفعيل
        const vacationCheckbox = document.getElementById('sultanooVacationMode');
        const messageBox = document.getElementById('sultanooVacationMessageBox');

        vacationCheckbox.addEventListener('change', () => {
            messageBox.style.display = vacationCheckbox.checked ? 'block' : 'none';
        });

    } catch (err) {
        console.error('Error loading sultanoo settings:', err);
        c.innerHTML = `<p class="error-msg">⚠️ خطأ في تحميل الإعدادات: ${err.message}</p>`;
    }
}

window.sultanooSaveSettings = async function() {
    if (typeof sb === 'undefined') { sultanooToast('⚠️ غير متصل بقاعدة البيانات', 'error'); return; }

    const vacationMode = document.getElementById('sultanooVacationMode').checked;
    const vacationMessage = document.getElementById('sultanooVacationMessage').value.trim();
    const categoryMode = document.querySelector('input[name="categoryMode"]:checked').value;
    const defaultLevelVal = document.getElementById('sultanooDefaultLevel')?.value || null;   // لازم نقراه قبل ما الحاوية تتبدّل بشاشة "جارٍ الحفظ"

    const container = _sultanooSettingsContainer || document.getElementById('corBody');
    if (!container) { sultanooToast('⚠️ تعذّر تحديد مكان عرض الإعدادات — أعد فتح الصفحة', 'error'); return; }
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--inv-muted)">⏳ جارٍ حفظ الإعدادات...</div>';

    try {
        // تحديث الإعدادات واحدة واحدة
        const updates = [
            { key: 'vacation_mode', value: vacationMode },
            { key: 'vacation_message', value: vacationMessage },
            { key: 'category_display_mode', value: categoryMode }
        ];

        // مستوى السعر الافتراضي: upsert (المفتاح ممكن يكون لسه مش موجود، والـupdate كان هيعدّي بصمت من غير ما يحفظ حاجة)
        if (defaultLevelVal) {
            const { error } = await sb.from('app_settings').upsert(
                { key: 'sultanoo_default_price_level', value: defaultLevelVal, updated_at: new Date().toISOString() }, { onConflict: 'key' });
            if (error) throw error;
        }

        for (const update of updates) {
            const { error } = await sb
                .from('app_settings')
                .update({
                    value: update.value,
                    updated_at: new Date().toISOString()
                })
                .eq('key', update.key);

            if (error) throw error;
        }

        sultanooToast('✅ تم حفظ إعدادات سلطانو بنجاح', 'success');

        // إعادة تحميل الصفحة لعرض التحديثات
        setTimeout(() => {
            renderSultanooSettings(container);
        }, 800);

    } catch (err) {
        console.error('Error saving sultanoo settings:', err);
        sultanooToast('⚠️ خطأ في حفظ الإعدادات: ' + err.message, 'error');
        // إعادة عرض الصفحة عند الخطأ
        setTimeout(() => {
            renderSultanooSettings(container);
        }, 500);
    }
};

Object.assign(window, { renderSultanooSettings, sultanooSaveSettings });
