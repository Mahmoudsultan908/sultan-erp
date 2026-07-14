/* ════════════════════════════════════════════════════════════
   إدارة المخازن — warehouses.js
   قائمة + إضافة مخزن جديد + تحديد المخزن الرئيسي + ملخص أرصدة
   يصدّر: renderWarehouses(container)
   ════════════════════════════════════════════════════════════ */

let _whList = [];

function whFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function renderWarehouses(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل المخازن...</div>';
    try {
        const [{ data: warehouses }, { data: stock }] = await Promise.all([
            sb.from('warehouses').select('*').order('is_main', { ascending: false }),
            sb.from('inventory_stock').select('warehouse_id, qty, products(purchase_price)'),
        ]);
        _whList = warehouses || [];

        const stockByWh = {};
        (stock||[]).forEach(s => {
            if (!stockByWh[s.warehouse_id]) stockByWh[s.warehouse_id] = { items: 0, qty: 0, value: 0 };
            stockByWh[s.warehouse_id].items += 1;
            stockByWh[s.warehouse_id].qty += Number(s.qty || 0);
            stockByWh[s.warehouse_id].value += Number(s.qty || 0) * Number(s.products?.purchase_price || 0);
        });

        whRenderPage(c, stockByWh);
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

function whRenderPage(c, stockByWh) {
    c.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
            <div><h2 style="font-size:22px;font-weight:800">🏭 إدارة المخازن</h2>
            <p style="font-size:13px;color:#64748B;margin-top:4px">إضافة مخازن جديدة وتحديد المخزن الرئيسي</p></div>
            <button class="mod-btn mod-btn-primary" onclick="whOpenAdd()">+ إضافة مخزن</button>
        </div>

        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">🏭</div><div class="mod-card-val">${_whList.length}</div><div class="mod-card-lbl">إجمالي المخازن</div></div>
        </div>

        <div class="dash-row">
            ${_whList.map(w => {
                const s = stockByWh[w.id] || { items: 0, qty: 0, value: 0 };
                return `<div class="dash-card" style="flex:1;min-width:260px">
                    <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
                        <div>
                            <div style="font-weight:800;font-size:15px">${w.name}</div>
                            ${w.is_main ? '<span class="dash-badge dash-badge-green" style="margin-top:4px;display:inline-block">⭐ المخزن الرئيسي</span>' : ''}
                        </div>
                        <div style="display:flex;gap:4px">
                            <button class="cc-edit" onclick="whOpenEdit('${w.id}')">✏️</button>
                            ${!w.is_main ? `<button class="cc-edit" style="background:#EFF6FF;color:#2563EB" onclick="whSetMain('${w.id}')" title="تعيين كمخزن رئيسي">⭐</button>` : ''}
                        </div>
                    </div>
                    <div class="dash-summary-row"><span>عدد الأصناف</span><span style="font-weight:700">${s.items}</span></div>
                    <div class="dash-summary-row"><span>إجمالي الكمية</span><span style="font-weight:700">${whFmt(s.qty)}</span></div>
                    <div class="dash-summary-divider"></div>
                    <div class="dash-summary-row dash-summary-total"><span>قيمة المخزون</span><span style="color:#2563EB">${whFmt(s.value)}</span></div>
                </div>`;
            }).join('') || '<div class="dash-card" style="text-align:center;padding:40px;color:#94A3B8">لا توجد مخازن بعد — أضف أول مخزن</div>'}
        </div>`;
}

window.whOpenAdd = function() { whOpenModal(null); };
window.whOpenEdit = function(id) { const w = _whList.find(x=>x.id===id); if (w) whOpenModal(w); };

function whOpenModal(w) {
    const modal = document.createElement('div');
    modal.className = 'mod-modal-bg active';
    modal.id = 'whModal';
    modal.innerHTML = `
        <div class="mod-modal" style="max-width:400px">
            <div class="mod-modal-header"><h3>${w?'✏️ تعديل مخزن':'🏭 إضافة مخزن جديد'}</h3>
                <button class="mod-modal-close" onclick="document.getElementById('whModal').remove()">&times;</button></div>
            <div class="mod-modal-body">
                <div class="mod-form-group"><label>اسم المخزن *</label>
                    <input type="text" id="whName" class="mod-form-input" value="${w?.name||''}" placeholder="مثال: المخزن الرئيسي، فرع المهندسين"></div>
                ${!w ? `<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;margin-top:8px">
                    <input type="checkbox" id="whIsMain" style="width:auto"> تعيينه كمخزن رئيسي
                </label>` : ''}
            </div>
            <div class="mod-modal-footer">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('whModal').remove()">إلغاء</button>
                <button class="mod-btn mod-btn-primary" onclick="whSave('${w?.id||''}')">💾 ${w?'حفظ التعديلات':'إضافة'}</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    setTimeout(()=>document.getElementById('whName')?.focus(), 50);
}

window.whSave = async function(editId) {
    const name = document.getElementById('whName').value.trim();
    if (!name) return alert('اسم المخزن مطلوب');

    const btn = document.querySelector('#whModal .mod-btn-primary');
    btn.innerText = '⏳ جاري الحفظ...'; btn.disabled = true;
    try {
        if (editId) {
            const { error } = await sb.from('warehouses').update({ name }).eq('id', editId);
            if (error) throw error;
        } else {
            const isMain = document.getElementById('whIsMain')?.checked || false;
            // لو هيتحدد كرئيسي، نشيل الصفة من المخزن الرئيسي القديم الأول
            if (isMain) await sb.from('warehouses').update({ is_main: false }).eq('is_main', true);
            const { error } = await sb.from('warehouses').insert({ name, is_main: isMain });
            if (error) throw error;
        }
        document.getElementById('whModal').remove();
        renderWarehouses(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ: ' + err.message);
        btn.innerText = '💾 حفظ'; btn.disabled = false;
    }
};

window.whSetMain = async function(id) {
    if (!confirm('تعيين هذا المخزن كرئيسي؟ سيصبح هو المخزن الافتراضي للفواتير الجديدة.')) return;
    try {
        await sb.from('warehouses').update({ is_main: false }).eq('is_main', true);
        const { error } = await sb.from('warehouses').update({ is_main: true }).eq('id', id);
        if (error) throw error;
        renderWarehouses(document.getElementById('app-content'));
    } catch (err) { alert('❌ خطأ: ' + err.message); }
};

Object.assign(window, { renderWarehouses, whOpenAdd, whOpenEdit, whSave, whSetMain });
