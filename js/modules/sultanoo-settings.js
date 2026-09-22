/* ════════════════════════════════════════════════════════════
   إعدادات تطبيق سلطانو — sultanoo-settings.js
   إدارة الإعدادات الخاصة بتطبيق الكتالوج (سلطانو):
   - وضع الإجازة (vacation_mode)
   - رسالة الإجازة (vacation_message)
   - طريقة عرض الأقسام (category_display_mode)
   يصدّر: renderSultanooSettings(container)
   ════════════════════════════════════════════════════════════ */

async function renderSultanooSettings(c) {
    if (typeof sb === 'undefined') { c.innerHTML = '<p class="error-msg">⚠️ غير متصل بقاعدة البيانات</p>'; return; }

    showLoadingOverlay('جارٍ تحميل إعدادات سلطانو...');

    try {
        // جلب الإعدادات الحالية
        const { data: settings, error } = await sb
            .from('app_settings')
            .select('key, value')
            .in('key', ['vacation_mode', 'vacation_message', 'category_display_mode']);

        if (error) throw error;

        // تحويل المصفوفة إلى object
        const settingsObj = {};
        (settings || []).forEach(s => {
            settingsObj[s.key] = s.value;
        });

        const vacationMode = settingsObj.vacation_mode === true;
        const vacationMessage = settingsObj.vacation_message || '';
        const categoryMode = settingsObj.category_display_mode || 'main';

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
    } finally {
        hideLoadingOverlay();
    }
}

window.sultanooSaveSettings = async function() {
    if (typeof sb === 'undefined') { showToast('⚠️ غير متصل بقاعدة البيانات', 'error'); return; }

    const vacationMode = document.getElementById('sultanooVacationMode').checked;
    const vacationMessage = document.getElementById('sultanooVacationMessage').value.trim();
    const categoryMode = document.querySelector('input[name="categoryMode"]:checked').value;

    showLoadingOverlay('جارٍ حفظ الإعدادات...');

    try {
        // تحديث الإعدادات واحدة واحدة
        const updates = [
            { key: 'vacation_mode', value: vacationMode },
            { key: 'vacation_message', value: vacationMessage },
            { key: 'category_display_mode', value: categoryMode }
        ];

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

        showToast('✅ تم حفظ إعدادات سلطانو بنجاح', 'success');

        // إعادة تحميل الصفحة لعرض التحديثات
        setTimeout(() => {
            renderSultanooSettings(document.getElementById('setHubBody'));
        }, 800);

    } catch (err) {
        console.error('Error saving sultanoo settings:', err);
        showToast('⚠️ خطأ في حفظ الإعدادات: ' + err.message, 'error');
    } finally {
        hideLoadingOverlay();
    }
};

Object.assign(window, { renderSultanooSettings, sultanooSaveSettings });
