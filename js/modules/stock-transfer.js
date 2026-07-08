async function renderStockTransfer(container) {
    try {
        const { data: warehouses } = await sb.from('warehouses').select('*');
        const { data: products } = await sb.from('products').select('*').limit(100);
        
        container.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px">
                <div><h2 style="font-size:22px;font-weight:800;">تحويل مخزون</h2><p style="font-size:13px;color:#64748B;margin-top:4px">نقل البضاعة بين المخازن دون تأثير مالي</p></div>
            </div>
            <div class="mod-card" style="max-width:600px;margin-bottom:24px;border-right:4px solid #10B981">
                <div class="mod-card-icon" style="background:#D1FAE5;color:#059669">🔄</div>
                <div style="font-size:14px;color:#64748B;margin-bottom:16px">تحويل المخزون لا يخصم أو يزيد من رصيد الخزنة أو يضيف قيود محاسبية، هو مجرد نقل فيزيائي.</div>
            </div>
            
            <div class="mod-modal-bg" id="transferModal" style="display:flex">
                <div class="mod-modal">
                    <div class="mod-modal-header"><h3>تحويل بضاعة</h3><button class="mod-modal-close" onclick="document.getElementById('transferModal').style.display='none'">&times;</button></div>
                    <div class="mod-modal-body">
                        <div class="mod-form-group"><label>الصنف</label><select id="trProduct" class="mod-form-input"><option value="">-- اختر الصنف --</option>${products.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
                        <div class="mod-form-group"><label>من مخزن</label><select id="trFrom" class="mod-form-input">${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}</select></div>
                        <div class="mod-form-group"><label>إلى مخزن</label><select id="trTo" class="mod-form-input">${warehouses.map(w => `<option value="${w.id}">${w.name}</option>`).join('')}</select></div>
                        <div class="mod-form-group"><label="الكمية (قطع)</label><input type="number" id="trQty" class="mod-form-input" placeholder="0" min="1" dir="ltr"></div>
                    </div>
                    <div class="mod-modal-footer">
                        <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="document.getElementById('transferModal').style.display='none'">إلغاء</button>
                        <button class="mod-btn mod-btn-success" onclick="executeTransfer()">تنفيذ التحويل</button>
                    </div>
                </div>
            </div>

            <div class="mod-table-wrap">
                <table class="mod-table"><thead><tr><th>التاريخ</th><th>الصنف</th><th>من</th><th>إلى</th><th style="text-align:left">الكمية</th></tr></thead>
                <tbody id="transfersTableBody">
                    <tr><td colspan="6" class="empty-state"><span>📦</span>لا توجد تحويلات حتى الآن.</td></tr>
                </tbody>
            </div>`;
    } catch (err) {
        container.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}

async function executeTransfer() {
    const productId = document.getElementById('trProduct').value;
    const fromId = document.getElementById('trFrom').value;
    const toId = document.getElementById('trTo').value;
    const qty = parseInt(document.getElementById('trQty').value);
    
    if (!productId || !fromId || !toId || !qty || fromId === toId) return alert('يرجى ملء البيانات وتأكد أن المخازن مختلفة');
    
    const btn = document.querySelector('#transferModal .mod-btn-success');
    btn.innerText = 'جاري النقل...'; btn.disabled = true;

    try {
        const { data: fromStock } = await sb.from('inventory_stock').select('qty').eq('warehouse_id', fromId).eq('product_id', productId).single();
        if (!fromStock || fromStock.qty < qty) { alert('الكمية المطلوبة أكبر من المتاح في المخزن المصدر!'); return; }

        // خصم من المخزن المصدر
        await sb.from('inventory_stock').update({ qty: fromStock.qty - qty }).eq('warehouse_id', fromId).eq('product_id', productId);
        // إضافة للمخزن الهدف (UPSERT)
        const { data: toStock } = await sb.from('inventory_stock').select('qty').eq('warehouse_id', toId).eq('product_id', productId).single();
        if (toStock) await sb.from('inventory_stock').update({ qty: toStock.qty + qty }).eq('id', toStock.id);
        else await sb.from('inventory_stock').insert({ warehouse_id: toId, product_id: productId, qty: qty });

        document.getElementById('transferModal').style.display = 'none';
        alert('تم تحويل المخزون بنجاح!');
        renderStockTransfer(document.getElementById('app-content'));
    } catch (err) { alert('خطأ: ' + err.message); }
    finally { btn.innerText = 'تنفيذ التحويل'; btn.disabled = false; }
}