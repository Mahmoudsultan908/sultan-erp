// ════════════════════════════════════════════════════════════
// opening-balances.js — الأرصدة الافتتاحية
// يصدّر: renderOpeningBalances(container)
// ════════════════════════════════════════════════════════════

async function renderOpeningBalances(container) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:#64748B"><div style="font-size:32px">⏳</div>جاري التحميل...</div>`;
    try {
        const [
            { data: existing },
            { data: customers },
            { data: suppliers },
            { data: products },
            { data: warehouses },
            { data: treasuries },
        ] = await Promise.all([
            sb.from('opening_balances').select('*').eq('status','confirmed').order('created_at'),
            sb.from('customers').select('id, name, balance').order('name'),
            sb.from('suppliers').select('id, name, balance').order('name'),
            sb.from('products').select('id, name, code, unit').order('name'),
            sb.from('warehouses').select('id, name, is_main'),
            sb.from('treasuries').select('id, name, is_default').eq('is_active', true).order('is_default', { ascending: false }),
        ]);

        const fmt = n => Number(n||0).toLocaleString('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2});
        let activeTab = 'cash';

        const tabs = [
            { id:'cash', label:'💰 خزنة', icon:'💰' },
            { id:'customer', label:'👥 عملاء', icon:'👥' },
            { id:'supplier', label:'🏭 موردين', icon:'🏭' },
            { id:'inventory', label:'📦 مخزون', icon:'📦' },
            { id:'prior_profit_loss', label:'📊 أرباح/خسائر سابقة', icon:'📊' },
        ];

        const byType = (type) => (existing||[]).filter(r => r.balance_type === type);

        container.innerHTML = `
        <div class="ob-wrap">
            <div class="dash-header">
                <div><h2 class="dash-title">📋 الأرصدة الافتتاحية</h2>
                <p class="dash-sub">أدخل الأرصدة قبل بداية استخدام النظام</p></div>
            </div>

            <div class="ob-warning">
                ⚠️ <strong>مهم:</strong> أدخل الأرصدة الافتتاحية مرة واحدة فقط قبل تسجيل أي معاملات حقيقية.
                بعد الاعتماد لا يمكن التعديل إلا بصلاحية المدير.
            </div>

            <!-- تابز -->
            <div class="ob-tabs">
                ${tabs.map(t => `<button class="ob-tab ${t.id===activeTab?'active':''}" onclick="obSwitchTab('${t.id}')">${t.label}</button>`).join('')}
            </div>

            <!-- محتوى التابز -->
            <div id="ob-content"></div>
        </div>`;

        window.obSwitchTab = (tab) => {
            activeTab = tab;
            document.querySelectorAll('.ob-tab').forEach(b => b.classList.toggle('active', b.textContent.includes(tabs.find(t=>t.id===tab)?.icon)));
            renderObTab(tab);
        };

        const renderObTab = (tab) => {
            const c = document.getElementById('ob-content');
            const recs = byType(tab);

            if (tab === 'cash') {
                // رصيد افتتاحي مستقل لكل خزنة (لو فيه أكتر من خزنة) — قبل كده كان بيسجّل
                // رصيد واحد بس بيروح للخزنة الافتراضية دايماً، من غير ما تقدر تختار
                c.innerHTML = `
                <div class="dash-card" style="padding:24px;max-width:560px">
                    <h3 style="margin:0 0 20px;font-size:15px;color:#1E293B">💰 رصيد الخزنة الافتتاحي</h3>
                    ${recs.length ? `<div style="margin-bottom:16px">
                        ${recs.map(r => {
                            const t = (treasuries||[]).find(x=>x.id===r.treasury_id);
                            return `<div class="ob-existing" style="margin-bottom:8px">
                                <div class="ob-ex-label">✅ ${t?.name || 'الخزنة الافتراضية'}</div>
                                <div class="ob-ex-val">${fmt(r.amount)} ج.م</div>
                                <div class="ob-ex-date">${new Date(r.as_of_date).toLocaleDateString('ar-EG')}</div>
                            </div>`;
                        }).join('')}
                    </div>` : ''}
                    <div class="ob-form">
                        ${(treasuries||[]).length > 1 ? `
                        <label class="ob-label">الخزنة</label>
                        <select id="ob-cash-treasury" class="ob-input">
                            ${treasuries.map(t=>`<option value="${t.id}" ${t.is_default?'selected':''}>${t.name}</option>`).join('')}
                        </select>` : ''}
                        <label class="ob-label">المبلغ (ج.م)</label>
                        <input type="number" id="ob-cash-amount" class="ob-input" placeholder="0.00" min="0" step="0.01">
                        <label class="ob-label">تاريخ الإثبات</label>
                        <input type="date" id="ob-cash-date" class="ob-input" value="${new Date().toISOString().slice(0,10)}">
                        <label class="ob-label">ملاحظات</label>
                        <input type="text" id="ob-cash-notes" class="ob-input" placeholder="اختياري">
                        <button class="ob-save-btn" onclick="obSaveCash()">💾 حفظ رصيد الخزنة</button>
                    </div>
                </div>`;

                window.obSaveCash = async () => {
                    const amount = parseFloat(document.getElementById('ob-cash-amount').value);
                    const as_of_date = document.getElementById('ob-cash-date').value;
                    const notes = document.getElementById('ob-cash-notes').value;
                    const treasury_id = document.getElementById('ob-cash-treasury')?.value || (treasuries||[]).find(t=>t.is_default)?.id || null;
                    if (!amount || amount <= 0) { alert('أدخل مبلغاً صحيحاً'); return; }
                    if (!as_of_date) { alert('أدخل التاريخ'); return; }
                    if ((recs||[]).some(r => r.treasury_id === treasury_id)) { alert('تم إدخال رصيد افتتاحي لهذه الخزنة من قبل'); return; }
                    try {
                        const { error } = await sb.from('opening_balances').insert({
                            balance_type: 'cash', amount, as_of_date, notes, treasury_id,
                            created_by: currentUser?.id
                        });
                        if (error) throw error;
                        alert('✅ تم حفظ رصيد الخزنة بنجاح');
                        renderOpeningBalances(container);
                    } catch(e) { alert('❌ خطأ: ' + e.message); }
                };

            } else if (tab === 'customer') {
                c.innerHTML = `
                <div class="dash-card" style="padding:0;overflow:hidden">
                    <div style="padding:16px 20px;border-bottom:1px solid #F1F5F9;display:flex;gap:12px;align-items:center">
                        <h3 style="margin:0;font-size:15px;flex:1">👥 أرصدة العملاء الافتتاحية</h3>
                        <button class="ob-add-btn" onclick="obAddCustomerRow()">+ إضافة</button>
                    </div>
                    <table class="dash-table" style="margin:0">
                        <thead><tr><th>العميل</th><th>الرصيد المستحق (ج.م)</th><th>التاريخ</th><th></th></tr></thead>
                        <tbody id="ob-cust-tbody">
                            ${recs.map(r => {
                                const cust = (customers||[]).find(c=>c.id===r.customer_id);
                                return `<tr><td>${cust?.name||'—'}</td><td class="dash-amount">${fmt(r.amount)}</td><td class="dash-muted">${new Date(r.as_of_date).toLocaleDateString('ar-EG')}</td><td>✅</td></tr>`;
                            }).join('') || '<tr><td colspan="4" style="text-align:center;padding:20px;color:#94A3B8">لم يُدخل أي رصيد بعد</td></tr>'}
                        </tbody>
                    </table>
                    <div id="ob-cust-form" style="display:none;padding:16px;background:#F8FAFC;border-top:1px solid #F1F5F9">
                        <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:10px;align-items:end">
                            <div><label class="ob-label">العميل</label>
                            <select id="ob-cust-id" class="ob-input" style="margin:0">
                                <option value="">اختر عميلاً...</option>
                                ${(customers||[]).map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}
                            </select></div>
                            <div><label class="ob-label">الرصيد المستحق</label>
                            <input type="number" id="ob-cust-amount" class="ob-input" style="margin:0" placeholder="0.00" min="0" step="0.01"></div>
                            <div><label class="ob-label">التاريخ</label>
                            <input type="date" id="ob-cust-date" class="ob-input" style="margin:0" value="${new Date().toISOString().slice(0,10)}"></div>
                            <button class="ob-save-btn" style="margin:0" onclick="obSaveCustomer()">حفظ</button>
                        </div>
                    </div>
                </div>`;

                window.obAddCustomerRow = () => {
                    document.getElementById('ob-cust-form').style.display = 'block';
                };
                window.obSaveCustomer = async () => {
                    const customer_id = document.getElementById('ob-cust-id').value;
                    const amount = parseFloat(document.getElementById('ob-cust-amount').value);
                    const as_of_date = document.getElementById('ob-cust-date').value;
                    if (!customer_id) { alert('اختر عميلاً'); return; }
                    if (!amount || amount <= 0) { alert('أدخل مبلغاً صحيحاً'); return; }
                    try {
                        const { error } = await sb.from('opening_balances').insert({
                            balance_type: 'customer', customer_id, amount, as_of_date,
                            created_by: currentUser?.id
                        });
                        if (error) throw error;
                        renderOpeningBalances(container);
                    } catch(e) { alert('❌ خطأ: ' + e.message); }
                };

            } else if (tab === 'supplier') {
                c.innerHTML = `
                <div class="dash-card" style="padding:0;overflow:hidden">
                    <div style="padding:16px 20px;border-bottom:1px solid #F1F5F9;display:flex;gap:12px;align-items:center">
                        <h3 style="margin:0;font-size:15px;flex:1">🏭 أرصدة الموردين الافتتاحية</h3>
                        <button class="ob-add-btn" onclick="obAddSupplierRow()">+ إضافة</button>
                    </div>
                    <table class="dash-table" style="margin:0">
                        <thead><tr><th>المورد</th><th>المديونية (ج.م)</th><th>التاريخ</th><th></th></tr></thead>
                        <tbody>
                            ${recs.map(r => {
                                const sup = (suppliers||[]).find(s=>s.id===r.supplier_id);
                                return `<tr><td>${sup?.name||'—'}</td><td class="dash-amount">${fmt(r.amount)}</td><td class="dash-muted">${new Date(r.as_of_date).toLocaleDateString('ar-EG')}</td><td>✅</td></tr>`;
                            }).join('') || '<tr><td colspan="4" style="text-align:center;padding:20px;color:#94A3B8">لم يُدخل أي رصيد بعد</td></tr>'}
                        </tbody>
                    </table>
                    <div id="ob-sup-form" style="display:none;padding:16px;background:#F8FAFC;border-top:1px solid #F1F5F9">
                        <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:10px;align-items:end">
                            <div><label class="ob-label">المورد</label>
                            <select id="ob-sup-id" class="ob-input" style="margin:0">
                                <option value="">اختر مورداً...</option>
                                ${(suppliers||[]).map(s=>`<option value="${s.id}">${s.name}</option>`).join('')}
                            </select></div>
                            <div><label class="ob-label">المديونية</label>
                            <input type="number" id="ob-sup-amount" class="ob-input" style="margin:0" placeholder="0.00" min="0" step="0.01"></div>
                            <div><label class="ob-label">التاريخ</label>
                            <input type="date" id="ob-sup-date" class="ob-input" style="margin:0" value="${new Date().toISOString().slice(0,10)}"></div>
                            <button class="ob-save-btn" style="margin:0" onclick="obSaveSupplier()">حفظ</button>
                        </div>
                    </div>
                </div>`;

                window.obAddSupplierRow = () => { document.getElementById('ob-sup-form').style.display = 'block'; };
                window.obSaveSupplier = async () => {
                    const supplier_id = document.getElementById('ob-sup-id').value;
                    const amount = parseFloat(document.getElementById('ob-sup-amount').value);
                    const as_of_date = document.getElementById('ob-sup-date').value;
                    if (!supplier_id) { alert('اختر مورداً'); return; }
                    if (!amount || amount <= 0) { alert('أدخل مبلغاً صحيحاً'); return; }
                    try {
                        const { error } = await sb.from('opening_balances').insert({
                            balance_type: 'supplier', supplier_id, amount, as_of_date,
                            created_by: currentUser?.id
                        });
                        if (error) throw error;
                        renderOpeningBalances(container);
                    } catch(e) { alert('❌ خطأ: ' + e.message); }
                };

            } else if (tab === 'inventory') {
                c.innerHTML = `
                <div class="dash-card" style="padding:0;overflow:hidden">
                    <div style="padding:16px 20px;border-bottom:1px solid #F1F5F9;display:flex;gap:12px;align-items:center">
                        <h3 style="margin:0;font-size:15px;flex:1">📦 مخزون افتتاحي</h3>
                        <button class="ob-add-btn" onclick="obAddInventoryRow()">+ إضافة صنف</button>
                    </div>
                    <table class="dash-table" style="margin:0">
                        <thead><tr><th>الصنف</th><th>المخزن</th><th>الكمية</th><th>تكلفة الوحدة</th><th>القيمة</th><th></th></tr></thead>
                        <tbody>
                            ${recs.map(r => {
                                const prod = (products||[]).find(p=>p.id===r.product_id);
                                const wh = (warehouses||[]).find(w=>w.id===r.warehouse_id);
                                return `<tr><td>${prod?.name||'—'}</td><td>${wh?.name||'—'}</td><td>${r.qty} ${prod?.unit||''}</td><td>${fmt(r.unit_cost)}</td><td class="dash-amount">${fmt(r.amount)}</td><td>✅</td></tr>`;
                            }).join('') || '<tr><td colspan="6" style="text-align:center;padding:20px;color:#94A3B8">لم يُدخل مخزون بعد</td></tr>'}
                        </tbody>
                    </table>
                    <div id="ob-inv-form" style="display:none;padding:16px;background:#F8FAFC;border-top:1px solid #F1F5F9">
                        <div style="display:grid;grid-template-columns:repeat(5,1fr) auto;gap:10px;align-items:end">
                            <div><label class="ob-label">الصنف</label>
                            <select id="ob-inv-prod" class="ob-input" style="margin:0">
                                <option value="">اختر صنفاً...</option>
                                ${(products||[]).map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
                            </select></div>
                            <div><label class="ob-label">المخزن</label>
                            <select id="ob-inv-wh" class="ob-input" style="margin:0">
                                ${(warehouses||[]).map(w=>`<option value="${w.id}">${w.name}</option>`).join('')}
                            </select></div>
                            <div><label class="ob-label">الكمية</label>
                            <input type="number" id="ob-inv-qty" class="ob-input" style="margin:0" placeholder="0" min="0.001" step="0.001" oninput="obCalcInvAmount()"></div>
                            <div><label class="ob-label">تكلفة الوحدة</label>
                            <input type="number" id="ob-inv-cost" class="ob-input" style="margin:0" placeholder="0.00" min="0" step="0.01" oninput="obCalcInvAmount()"></div>
                            <div><label class="ob-label">القيمة الإجمالية</label>
                            <input type="number" id="ob-inv-amount" class="ob-input" style="margin:0;background:#F1F5F9" placeholder="0.00" readonly></div>
                            <button class="ob-save-btn" style="margin:0" onclick="obSaveInventory()">حفظ</button>
                        </div>
                    </div>
                </div>`;

                window.obCalcInvAmount = () => {
                    const qty = parseFloat(document.getElementById('ob-inv-qty')?.value) || 0;
                    const cost = parseFloat(document.getElementById('ob-inv-cost')?.value) || 0;
                    const amountEl = document.getElementById('ob-inv-amount');
                    if (amountEl) amountEl.value = (qty * cost).toFixed(2);
                };
                window.obAddInventoryRow = () => { document.getElementById('ob-inv-form').style.display = 'block'; };
                window.obSaveInventory = async () => {
                    const product_id = document.getElementById('ob-inv-prod').value;
                    const warehouse_id = document.getElementById('ob-inv-wh').value;
                    const qty = parseFloat(document.getElementById('ob-inv-qty').value);
                    const unit_cost = parseFloat(document.getElementById('ob-inv-cost').value);
                    const amount = qty * unit_cost;
                    const as_of_date = new Date().toISOString().slice(0,10);
                    if (!product_id) { alert('اختر صنفاً'); return; }
                    if (!qty || qty <= 0) { alert('أدخل كمية صحيحة'); return; }
                    if (!unit_cost || unit_cost < 0) { alert('أدخل تكلفة الوحدة'); return; }
                    try {
                        const { error } = await sb.from('opening_balances').insert({
                            balance_type: 'inventory', product_id, warehouse_id, qty, unit_cost, amount, as_of_date,
                            created_by: currentUser?.id
                        });
                        if (error) throw error;
                        renderOpeningBalances(container);
                    } catch(e) { alert('❌ خطأ: ' + e.message); }
                };

            } else if (tab === 'prior_profit_loss') {
                const rec = recs[0];
                c.innerHTML = `
                <div class="dash-card" style="padding:24px;max-width:500px">
                    <h3 style="margin:0 0 20px;font-size:15px;color:#1E293B">📊 أرباح / خسائر سابقة</h3>
                    <p style="font-size:13px;color:#64748B;margin-bottom:20px">أدخل صافي الأرباح أو الخسائر المتراكمة قبل بداية النظام. القيمة السالبة = خسارة.</p>
                    ${rec ? `<div class="ob-existing"><div class="ob-ex-label">✅ تم الإدخال</div>
                        <div class="ob-ex-val ${Number(rec.amount)>=0?'dash-s-green':'dash-s-red'}">${fmt(Math.abs(rec.amount))} ج.م ${Number(rec.amount)>=0?'(ربح)':'(خسارة)'}</div></div>` : ''}
                    <div class="ob-form">
                        <label class="ob-label">المبلغ (ج.م) — أدخل سالباً لو خسارة</label>
                        <input type="number" id="ob-pl-amount" class="ob-input" placeholder="مثلاً: -5000 أو 12000" step="0.01" value="${rec?.amount||''}">
                        <label class="ob-label">تاريخ الإثبات</label>
                        <input type="date" id="ob-pl-date" class="ob-input" value="${rec?.as_of_date || new Date().toISOString().slice(0,10)}">
                        <button class="ob-save-btn" onclick="obSavePL()">💾 حفظ</button>
                    </div>
                </div>`;

                window.obSavePL = async () => {
                    const amount = parseFloat(document.getElementById('ob-pl-amount').value);
                    const as_of_date = document.getElementById('ob-pl-date').value;
                    if (isNaN(amount)) { alert('أدخل مبلغاً'); return; }
                    try {
                        const { error } = await sb.from('opening_balances').insert({
                            balance_type: 'prior_profit_loss', amount, as_of_date,
                            created_by: currentUser?.id
                        });
                        if (error) throw error;
                        alert('✅ تم الحفظ');
                        renderOpeningBalances(container);
                    } catch(e) { alert('❌ خطأ: ' + e.message); }
                };
            }
        };

        renderObTab(activeTab);

    } catch(err) {
        container.innerHTML = `<div class="dash-error"><div style="font-size:32px">⚠️</div><div>خطأ: ${err.message}</div></div>`;
    }
}
