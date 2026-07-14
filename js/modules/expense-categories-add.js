/* ════════════════════════════════════════════════════════════
   إضافة بند مصروف جديد — ملحق لـ expenses.js
   ملف منفصل عمداً (بدل تعديل expenses.js نفسه) لتفادي أي تعارض
   مستقبلي مع تعديلات zcode على نفس الملف.
   يعمل injection لزرار "+ بند جديد" داخل لوحة البنود الموجودة.
   ════════════════════════════════════════════════════════════ */

// نلف renderExpenses الأصلية عشان نضيف الزرار بعد كل مرة تترسم فيها الصفحة
const _origRenderExpenses = window.renderExpenses;
window.renderExpenses = async function(c) {
    await _origRenderExpenses(c);
    ecInjectAddButton();
};

function ecInjectAddButton() {
    // ندور على عنوان لوحة البنود ونضيف الزرار جنبه، لو لسه مش مضاف
    const header = Array.from(document.querySelectorAll('.mod-table-wrap > div'))
        .find(d => d.textContent.includes('دليل بنود المصروفات'));
    if (!header || document.getElementById('ecAddBtn')) return;

    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';

    const btn = document.createElement('button');
    btn.id = 'ecAddBtn';
    btn.className = 'mod-btn mod-btn-primary';
    btn.style.whiteSpace = 'nowrap';
    btn.textContent = '+ بند جديد';
    btn.onclick = ecOpenAdd;
    header.appendChild(btn);
}

// ════════════════════════════════════════════════════════════
// نافذة إضافة بند مصروف جديد
// ════════════════════════════════════════════════════════════
async function ecOpenAdd() {
    const { data: accounts } = await sb.from('accounts').select('code, name').eq('type', 'expense').order('code');

    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'ecAddModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:460px">
            <div class="mod-modal-header"><h3>📋 بند مصروف جديد</h3>
                <button class="mod-modal-close" onclick="document.getElementById('ecAddModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>اسم البند *</label>
                    <input type="text" id="ecName" class="mod-form-input" placeholder="مثال: إيجارات، صيانة، مواصلات"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>الكود</label>
                        <input type="text" id="ecCode" class="mod-form-input" placeholder="اختياري" dir="ltr"></div>
                    <div class="mod-form-group"><label>النوع</label>
                        <select id="ecSubtype" class="mod-form-input">
                            <option value="operating">تشغيلي</option>
                            <option value="admin">إداري</option>
                            <option value="cogs">تكلفة بضاعة مباعة</option>
                        </select></div>
                </div>
                <div class="mod-form-group"><label>الحساب المحاسبي المرتبط *</label>
                    <select id="ecAccountCode" class="mod-form-input">
                        ${(accounts||[]).map(a=>`<option value="${a.code}">${a.code} — ${a.name}</option>`).join('')}
                    </select></div>
                <div class="mod-form-group"><label>الحد الشهري (اختياري)</label>
                    <input type="number" id="ecLimit" class="mod-form-input" placeholder="0 = بدون حد" min="0" step="0.01"></div>
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('ecAddModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="ecSaveNew()">💾 إضافة البند</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    setTimeout(()=>document.getElementById('ecName')?.focus(), 50);
}

window.ecOpenAdd = ecOpenAdd;

window.ecSaveNew = async function() {
    const name = document.getElementById('ecName').value.trim();
    const code = document.getElementById('ecCode').value.trim();
    const subtype = document.getElementById('ecSubtype').value;
    const account_code = document.getElementById('ecAccountCode').value;
    const monthly_limit = parseFloat(document.getElementById('ecLimit').value) || 0;

    if (!name) return alert('اسم البند مطلوب');
    if (!account_code) return alert('اختر الحساب المحاسبي المرتبط');

    const btn = document.querySelector('#ecAddModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الإضافة...'; btn.disabled = true;
    try {
        const { error } = await sb.from('expense_categories').insert({
            name, code: code || null, subtype, account_code, monthly_limit
        });
        if (error) throw error;
        document.getElementById('ecAddModal').remove();
        renderExpenses(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ: ' + err.message);
        btn.innerText = '💾 إضافة البند'; btn.disabled = false;
    }
};
