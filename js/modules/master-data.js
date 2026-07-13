/* ════════════════════════════════════════════════════════════
   إدارة البيانات الأساسية — العملاء والموردين
   master-data.js
   يصدّر: renderCustomersManage(container), renderSuppliersManage(container)
   (منفصل عمداً عن customers.js/suppliers.js اللي بيعرضوا كشف الحساب)
   ════════════════════════════════════════════════════════════ */

function mdFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ════════════════════════════════════════════════════════════
// ██ العملاء ██
// ════════════════════════════════════════════════════════════
let _mgCustList = [];
let _mgCustRegions = [];
let _mgCustClassifications = [];
let _mgCustGroups = [];
let _mgCustSearch = '';
let _mgCustEditingId = null;

async function renderCustomersManage(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل العملاء...</div>';
    try {
        const [{ data: customers }, { data: regions }, { data: classifications }, { data: groups }] = await Promise.all([
            sb.from('customers').select('*').order('name'),
            sb.from('customer_regions').select('*').order('name'),
            sb.from('customer_classifications').select('*').order('name'),
            sb.from('customer_groups').select('*, price_levels(name)').order('name'),
        ]);
        _mgCustList = customers || [];
        _mgCustRegions = regions || [];
        _mgCustClassifications = classifications || [];
        _mgCustGroups = groups || [];
        custRenderPage(c);

        // ★ جاي من زرار "تعديل بيانات العميل" في كشف الحساب (customers.js) —
        //   افتح نافذة التعديل لنفس العميل تلقائياً بدل ما المستخدم يدوّر عليه تاني
        if (window._pendingCustomerEdit) {
            const pendId = window._pendingCustomerEdit;
            window._pendingCustomerEdit = null;
            custOpenEdit(pendId);
        }
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function custRenderPage(c) {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
            <div><h2 style="font-size:22px;font-weight:800">👥 إدارة العملاء</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">إضافة وتعديل بيانات العملاء</p></div>
            <div style="display:flex;gap:8px">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="mdOpenLookupManager('customer')">⚙️ المناطق/التصنيفات/المجموعات</button>
                <button class="mod-btn mod-btn-primary" onclick="custOpenAdd()">+ إضافة عميل</button>
            </div>
        </div>
        <div class="mod-card" style="margin-bottom:16px">
            <input type="text" id="custMgSearch" class="mod-form-input" style="margin:0" placeholder="🔍 بحث بالاسم أو الهاتف..." oninput="custMgSearch(this.value)">
        </div>
        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>العميل</th><th>الهاتف</th><th>المنطقة</th><th>التصنيف</th><th>المجموعة</th>
                <th style="text-align:left">الحد الائتماني</th><th style="text-align:left">الرصيد</th><th></th>
            </tr></thead><tbody id="custMgTbody"></tbody></table>
        </div>`;
    custRenderRows();
}

function custRenderRows() {
    const tbody = document.getElementById('custMgTbody');
    if (!tbody) return;
    let rows = _mgCustList;
    if (_mgCustSearch) {
        const q = _mgCustSearch.toLowerCase();
        rows = rows.filter(x => (x.name||'').toLowerCase().includes(q) || (x.phone||'').includes(q));
    }
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="8" class="empty-state"><span>👥</span>لا يوجد عملاء بعد — ابدأ بإضافة أول عميل</td></tr>`; return; }

    tbody.innerHTML = rows.map(x => {
        const region = _mgCustRegions.find(r=>r.id===x.region_id);
        const cls = _mgCustClassifications.find(cl=>cl.id===x.classification_id);
        const grp = _mgCustGroups.find(g=>g.id===x.group_id);
        const bal = Number(x.balance)||0;
        return `<tr>
            <td><strong>${x.name}</strong></td>
            <td dir="ltr" style="text-align:right">${x.phone||'—'}</td>
            <td>${region?.name||'—'}</td>
            <td>${cls?.name||'—'}</td>
            <td>${grp?.name||'—'}</td>
            <td style="text-align:left">${x.credit_limit>0?mdFmt(x.credit_limit):'—'}</td>
            <td style="text-align:left;font-weight:700;color:${bal>0?'#DC2626':'#059669'}">${mdFmt(bal)}</td>
            <td><button class="cc-edit" onclick="custOpenEdit('${x.id}')">✏️</button></td>
        </tr>`;
    }).join('');
}
window.custMgSearch = function(v) { _mgCustSearch = v; custRenderRows(); };

window.custOpenAdd = function() { _mgCustEditingId = null; custOpenModal(null); };
window.custOpenEdit = function(id) { const x = _mgCustList.find(c=>c.id===id); if (x) { _mgCustEditingId = id; custOpenModal(x); } };

function custOpenModal(x) {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'custMgModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:520px">
            <div class="mod-modal-header"><h3>${x?'✏️ تعديل عميل':'👥 إضافة عميل جديد'}</h3>
                <button class="mod-modal-close" onclick="document.getElementById('custMgModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>اسم العميل *</label>
                    <input type="text" id="custName" class="mod-form-input" value="${x?.name||''}" placeholder="اسم العميل / المحل"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>الهاتف</label>
                        <input type="text" id="custPhone" class="mod-form-input" value="${x?.phone||''}" dir="ltr"></div>
                    <div class="mod-form-group"><label>الكود</label>
                        <input type="text" id="custCode" class="mod-form-input" value="${x?.code||''}" dir="ltr" placeholder="اختياري"></div>
                </div>
                <div class="mod-form-group"><label>العنوان</label>
                    <input type="text" id="custAddress" class="mod-form-input" value="${x?.address||''}"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>المنطقة</label>
                        <select id="custRegion" class="mod-form-input">
                            <option value="">بدون منطقة</option>
                            ${_mgCustRegions.map(r=>`<option value="${r.id}" ${x?.region_id===r.id?'selected':''}>${r.name}</option>`).join('')}
                        </select></div>
                    <div class="mod-form-group"><label>التصنيف (نوع النشاط)</label>
                        <select id="custClassification" class="mod-form-input">
                            <option value="">بدون تصنيف</option>
                            ${_mgCustClassifications.map(cl=>`<option value="${cl.id}" ${x?.classification_id===cl.id?'selected':''}>${cl.name}</option>`).join('')}
                        </select></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>المجموعة (نوع التعامل والسعر)</label>
                        <select id="custGroup" class="mod-form-input">
                            <option value="">بدون مجموعة</option>
                            ${_mgCustGroups.map(g=>`<option value="${g.id}" ${x?.group_id===g.id?'selected':''}>${g.name}</option>`).join('')}
                        </select></div>
                    <div class="mod-form-group"><label>يوم الزيارة</label>
                        <select id="custVisitDay" class="mod-form-input">
                            <option value="">غير محدد</option>
                            ${[['sunday','الأحد'],['monday','الإثنين'],['tuesday','الثلاثاء'],['wednesday','الأربعاء'],['thursday','الخميس'],['friday','الجمعة'],['saturday','السبت']]
                                .map(([v,l])=>`<option value="${v}" ${x?.visit_day===v?'selected':''}>${l}</option>`).join('')}
                        </select></div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>الحد الائتماني (ج.م)</label>
                        <input type="number" id="custCreditLimit" class="mod-form-input" value="${x?.credit_limit||0}" min="0" step="0.01"></div>
                    <div class="mod-form-group"><label>طريقة الدفع المفضلة</label>
                        <select id="custPayMethod" class="mod-form-input">
                            <option value="">غير محدد</option>
                            <option value="cash" ${x?.preferred_payment_method==='cash'?'selected':''}>نقدي</option>
                            <option value="credit" ${x?.preferred_payment_method==='credit'?'selected':''}>آجل</option>
                            <option value="check" ${x?.preferred_payment_method==='check'?'selected':''}>شيك</option>
                        </select></div>
                </div>
                ${x ? `<div style="background:#F8FAFC;border-radius:8px;padding:10px 14px;font-size:12.5px;color:#64748B;margin-top:6px">
                    💡 الرصيد الحالي (${mdFmt(x.balance||0)} ج.م) لا يُعدَّل من هنا — يتغيّر تلقائياً من الفواتير والتحصيل فقط.
                </div>` : ''}
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('custMgModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="custSave()">💾 ${x?'حفظ التعديلات':'إضافة العميل'}</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    setTimeout(()=>document.getElementById('custName')?.focus(), 50);
}

window.custSave = async function() {
    const name = document.getElementById('custName').value.trim();
    if (!name) return alert('اسم العميل مطلوب');

    const payload = {
        name,
        phone: document.getElementById('custPhone').value.trim() || null,
        code: document.getElementById('custCode').value.trim() || null,
        address: document.getElementById('custAddress').value.trim() || null,
        region_id: document.getElementById('custRegion').value || null,
        classification_id: document.getElementById('custClassification').value || null,
        group_id: document.getElementById('custGroup').value || null,
        visit_day: document.getElementById('custVisitDay').value || null,
        credit_limit: parseFloat(document.getElementById('custCreditLimit').value) || 0,
        preferred_payment_method: document.getElementById('custPayMethod').value || null,
    };

    const btn = document.querySelector('#custMgModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        if (_mgCustEditingId) {
            const { error } = await sb.from('customers').update(payload).eq('id', _mgCustEditingId);
            if (error) throw error;
        } else {
            const { error } = await sb.from('customers').insert({ ...payload, balance: 0, created_by: currentUser?.id || null });
            if (error) throw error;
        }
        document.getElementById('custMgModal').remove();
        renderCustomersManage(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ: ' + err.message);
        btn.innerText = '💾 حفظ'; btn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════
// ██ الموردون ██ (نفس النمط بالضبط)
// ════════════════════════════════════════════════════════════
let _mgSuppList = [];
let _mgSuppSearch = '';
let _mgSuppEditingId = null;

async function renderSuppliersManage(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل الموردين...</div>';
    try {
        const { data: suppliers } = await sb.from('suppliers').select('*').order('name');
        _mgSuppList = suppliers || [];
        suppRenderPage(c);

        if (window._pendingSupplierEdit) {
            const pendId = window._pendingSupplierEdit;
            window._pendingSupplierEdit = null;
            suppOpenEdit(pendId);
        }
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function suppRenderPage(c) {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
            <div><h2 style="font-size:22px;font-weight:800">🏭 إدارة الموردين</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">إضافة وتعديل بيانات الموردين</p></div>
            <button class="mod-btn mod-btn-primary" onclick="suppOpenAdd()">+ إضافة مورد</button>
        </div>
        <div class="mod-card" style="margin-bottom:16px">
            <input type="text" id="suppMgSearch" class="mod-form-input" style="margin:0" placeholder="🔍 بحث بالاسم أو الهاتف..." oninput="suppMgSearch(this.value)">
        </div>
        <div class="mod-table-wrap">
            <table class="mod-table"><thead><tr>
                <th>المورد</th><th>الهاتف</th><th>الكود</th><th style="text-align:left">المستحق عليه لنا</th><th></th>
            </tr></thead><tbody id="suppMgTbody"></tbody></table>
        </div>`;
    suppRenderRows();
}

function suppRenderRows() {
    const tbody = document.getElementById('suppMgTbody');
    if (!tbody) return;
    let rows = _mgSuppList;
    if (_mgSuppSearch) {
        const q = _mgSuppSearch.toLowerCase();
        rows = rows.filter(x => (x.name||'').toLowerCase().includes(q) || (x.phone||'').includes(q));
    }
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="5" class="empty-state"><span>🏭</span>لا يوجد موردون بعد — ابدأ بإضافة أول مورد</td></tr>`; return; }

    tbody.innerHTML = rows.map(x => `<tr>
        <td><strong>${x.name}</strong></td>
        <td dir="ltr" style="text-align:right">${x.phone||'—'}</td>
        <td>${x.code||'—'}</td>
        <td style="text-align:left;font-weight:700;color:${Number(x.balance)>0?'#DC2626':'#059669'}">${mdFmt(x.balance)}</td>
        <td><button class="cc-edit" onclick="suppOpenEdit('${x.id}')">✏️</button></td>
    </tr>`).join('');
}
window.suppMgSearch = function(v) { _mgSuppSearch = v; suppRenderRows(); };

window.suppOpenAdd = function() { _mgSuppEditingId = null; suppOpenModal(null); };
window.suppOpenEdit = function(id) { const x = _mgSuppList.find(s=>s.id===id); if (x) { _mgSuppEditingId = id; suppOpenModal(x); } };

function suppOpenModal(x) {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'suppMgModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:460px">
            <div class="mod-modal-header"><h3>${x?'✏️ تعديل مورد':'🏭 إضافة مورد جديد'}</h3>
                <button class="mod-modal-close" onclick="document.getElementById('suppMgModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>اسم المورد *</label>
                    <input type="text" id="suppName" class="mod-form-input" value="${x?.name||''}"></div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div class="mod-form-group"><label>الهاتف</label>
                        <input type="text" id="suppPhone" class="mod-form-input" value="${x?.phone||''}" dir="ltr"></div>
                    <div class="mod-form-group"><label>الكود</label>
                        <input type="text" id="suppCode" class="mod-form-input" value="${x?.code||''}" dir="ltr" placeholder="اختياري"></div>
                </div>
                <div class="mod-form-group"><label>العنوان</label>
                    <input type="text" id="suppAddress" class="mod-form-input" value="${x?.address||''}"></div>
                ${x ? `<div style="background:#F8FAFC;border-radius:8px;padding:10px 14px;font-size:12.5px;color:#64748B;margin-top:6px">
                    💡 المستحق الحالي (${mdFmt(x.balance||0)} ج.م) لا يُعدَّل من هنا — يتغيّر تلقائياً من فواتير الشراء والدفع فقط.
                </div>` : ''}
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('suppMgModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="suppSave()">💾 ${x?'حفظ التعديلات':'إضافة المورد'}</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    setTimeout(()=>document.getElementById('suppName')?.focus(), 50);
}

window.suppSave = async function() {
    const name = document.getElementById('suppName').value.trim();
    if (!name) return alert('اسم المورد مطلوب');

    const payload = {
        name,
        phone: document.getElementById('suppPhone').value.trim() || null,
        code: document.getElementById('suppCode').value.trim() || null,
        address: document.getElementById('suppAddress').value.trim() || null,
    };

    const btn = document.querySelector('#suppMgModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        if (_mgSuppEditingId) {
            const { error } = await sb.from('suppliers').update(payload).eq('id', _mgSuppEditingId);
            if (error) throw error;
        } else {
            const { error } = await sb.from('suppliers').insert({ ...payload, balance: 0, created_by: currentUser?.id || null });
            if (error) throw error;
        }
        document.getElementById('suppMgModal').remove();
        renderSuppliersManage(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ: ' + err.message);
        btn.innerText = '💾 حفظ'; btn.disabled = false;
    }
};

// ════════════════════════════════════════════════════════════
// ██ مدير المناطق/التصنيفات/المجموعات (Lookup Manager) ██
// ════════════════════════════════════════════════════════════
window.mdOpenLookupManager = function(type) {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'lookupModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:480px">
            <div class="mod-modal-header"><h3>⚙️ إدارة المناطق والتصنيفات والمجموعات</h3>
                <button class="mod-modal-close" onclick="document.getElementById('lookupModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="ob-tabs" style="margin-bottom:14px">
                    <button class="ob-tab active" data-lk="region" onclick="mdSwitchLookup('region')">🗺️ المناطق</button>
                    <button class="ob-tab" data-lk="classification" onclick="mdSwitchLookup('classification')">🏪 التصنيفات</button>
                    <button class="ob-tab" data-lk="group" onclick="mdSwitchLookup('group')">💼 المجموعات</button>
                </div>
                <div id="lookupContent"></div>
            </div>
        </div>`;
    document.body.appendChild(modal);
    mdRenderLookup('region');
};

window.mdSwitchLookup = function(type) {
    document.querySelectorAll('#lookupModal .ob-tab').forEach(b => b.classList.toggle('active', b.dataset.lk === type));
    mdRenderLookup(type);
};

async function mdRenderLookup(type) {
    const content = document.getElementById('lookupContent');
    content.innerHTML = '⏳ جاري التحميل...';

    if (type === 'region') {
        const { data } = await sb.from('customer_regions').select('*').order('name');
        content.innerHTML = mdLookupListHTML(data||[], 'region', 'اسم المنطقة');
    } else if (type === 'classification') {
        const { data } = await sb.from('customer_classifications').select('*').order('name');
        content.innerHTML = mdLookupListHTML(data||[], 'classification', 'اسم التصنيف');
    } else if (type === 'group') {
        const [{ data: groups }, { data: levels }] = await Promise.all([
            sb.from('customer_groups').select('*').order('name'),
            sb.from('price_levels').select('*').order('sort_order'),
        ]);
        content.innerHTML = `
            <div style="display:flex;gap:8px;margin-bottom:12px">
                <input type="text" id="newGroupName" class="mod-form-input" style="margin:0" placeholder="اسم مجموعة جديدة...">
                <select id="newGroupLevel" class="mod-form-input" style="margin:0;width:140px">
                    ${(levels||[]).map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}
                </select>
                <button class="mod-btn mod-btn-primary" onclick="mdAddGroup()">+</button>
            </div>
            ${(groups||[]).map(g=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #F1F5F9">
                <span>${g.name}</span></div>`).join('') || '<p style="color:#94A3B8;text-align:center;padding:16px">لا توجد مجموعات بعد</p>'}`;
    }
}

function mdLookupListHTML(items, type, placeholder) {
    return `
        <div style="display:flex;gap:8px;margin-bottom:12px">
            <input type="text" id="newLookupName" class="mod-form-input" style="margin:0" placeholder="${placeholder}...">
            <button class="mod-btn mod-btn-primary" onclick="mdAddLookup('${type}')">+</button>
        </div>
        ${items.map(i=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #F1F5F9">
            <span>${i.name}</span></div>`).join('') || '<p style="color:#94A3B8;text-align:center;padding:16px">لا توجد عناصر بعد</p>'}`;
}

window.mdAddLookup = async function(type) {
    const name = document.getElementById('newLookupName').value.trim();
    if (!name) return;
    const table = type === 'region' ? 'customer_regions' : 'customer_classifications';
    try {
        const { error } = await sb.from(table).insert({ name });
        if (error) throw error;
        mdRenderLookup(type);
    } catch(e) { alert('خطأ: ' + e.message); }
};

window.mdAddGroup = async function() {
    const name = document.getElementById('newGroupName').value.trim();
    const levelId = document.getElementById('newGroupLevel').value;
    if (!name) return;
    try {
        const { error } = await sb.from('customer_groups').insert({ name, default_price_level_id: levelId || null });
        if (error) throw error;
        mdRenderLookup('group');
    } catch(e) { alert('خطأ: ' + e.message); }
};

Object.assign(window, {
    renderCustomersManage, custMgSearch, custOpenAdd, custOpenEdit, custSave,
    renderSuppliersManage, suppMgSearch, suppOpenAdd, suppOpenEdit, suppSave,
    mdOpenLookupManager, mdSwitchLookup, mdAddLookup, mdAddGroup,
});
