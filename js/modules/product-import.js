/* ════════════════════════════════════════════════════════════
   استيراد الأصناف من Excel — product-import.js
   يقرأ ملف Excel، يطابق/ينشئ المجموعات والشركات تلقائياً،
   ويعمل UPSERT للأصناف + مستويات الأسعار الخمسة
   يصدّر: renderProductImport(container)
   يستخدم مكتبة XLSX (SheetJS) المحمّلة بالفعل في index.html
   ════════════════════════════════════════════════════════════ */

let _piParsedRows = [];
let _piPriceLevels = [];
let _piCategories = [];
let _piCompanies = [];
let _piMainWarehouseId = null;
let _piExistingBalanceProductIds = new Set();

const PI_HEADERS = ['الكود','اسم الصنف','المجموعة','الشركة','الوحدة','سعر الشراء','جملة','نص جملة','قطاعي','مميز','خاص','حد الطلب','الباركود','الرصيد الافتتاحي'];
const PI_LEVEL_CODES = { 'جملة':'WHOLESALE', 'نص جملة':'HALF', 'قطاعي':'RETAIL', 'مميز':'SPECIAL', 'خاص':'VIP' };

function piFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ════════════════════════════════════════════════════════════
// 1) العرض الرئيسي
// ════════════════════════════════════════════════════════════
async function renderProductImport(c) {
    _piParsedRows = [];
    c.innerHTML = `
        <div style="margin-bottom:20px"><h2 style="font-size:22px;font-weight:800">📥 استيراد الأصناف من Excel</h2>
        <p style="font-size:13px;color:#64748B;margin-top:4px">استيراد جماعي للأصناف مع كل الأسعار والمجموعات والشركات دفعة واحدة</p></div>

        <div class="dash-card" style="padding:24px;margin-bottom:16px">
            <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="piDownloadTemplate()">📄 تنزيل القالب الفارغ</button>
                <div style="flex:1;min-width:220px">
                    <input type="file" id="piFileInput" accept=".xlsx,.xls" style="display:none" onchange="piHandleFile(this.files[0])">
                    <button class="mod-btn mod-btn-primary" onclick="document.getElementById('piFileInput').click()">📂 اختر ملف Excel</button>
                    <span id="piFileName" style="font-size:12.5px;color:#64748B;margin-right:10px"></span>
                </div>
            </div>
            <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px 14px;font-size:12.5px;color:#1E40AF;margin-top:14px">
                💡 نزّل القالب الأول، املأه، احذف صف المثال، ثم ارفعه هنا. لو الكود موجود بالفعل سيُحدَّث، ولو جديد سيُضاف.
            </div>
        </div>

        <div id="piPreviewArea"></div>`;
}

window.piDownloadTemplate = function() {
    const wb = XLSX.utils.book_new();
    const wsData = [
        PI_HEADERS,
        ['P-001', 'بسكويت تايجر', 'سناكس', 'شركة الوطنية للأغذية', 'قطعة', 5, 6, 6.5, 7, 7.5, 8, 50, '6221031012345', 100]
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = [{wch:10},{wch:26},{wch:16},{wch:22},{wch:10},{wch:11},{wch:9},{wch:10},{wch:9},{wch:9},{wch:9},{wch:11},{wch:16},{wch:14}];
    XLSX.utils.book_append_sheet(wb, ws, 'استيراد الأصناف');
    XLSX.writeFile(wb, 'قالب_استيراد_الأصناف.xlsx');
};

// ════════════════════════════════════════════════════════════
// 2) قراءة الملف وعرض المعاينة
// ════════════════════════════════════════════════════════════
window.piHandleFile = async function(file) {
    if (!file) return;
    document.getElementById('piFileName').textContent = '📄 ' + file.name;

    try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

        if (!rows.length) { alert('⚠️ الملف فارغ'); return; }

        // تحميل المجموعات/الشركات/مستويات الأسعار/المخزن الرئيسي/الأرصدة الموجودة (للحماية من التكرار)
        const [{ data: cats }, { data: comps }, { data: levels }, { data: warehouses }, { data: existingBalances }] = await Promise.all([
            sb.from('product_categories').select('*'),
            sb.from('product_companies').select('*'),
            sb.from('price_levels').select('*'),
            sb.from('warehouses').select('*'),
            sb.from('opening_balances').select('product_id').eq('balance_type','inventory').eq('status','confirmed'),
        ]);
        _piCategories = cats || [];
        _piCompanies = comps || [];
        _piPriceLevels = levels || [];
        _piMainWarehouseId = (warehouses||[]).find(w=>w.is_main)?.id || warehouses?.[0]?.id || null;
        _piExistingBalanceProductIds = new Set((existingBalances||[]).map(b=>b.product_id));

        _piParsedRows = rows.map((r, idx) => {
            const code = String(r['الكود'] || '').trim();
            const name = String(r['اسم الصنف'] || '').trim();
            const purchase_price = parseFloat(r['سعر الشراء']) || 0;
            const errors = [];
            if (!code) errors.push('الكود فارغ');
            if (!name) errors.push('اسم الصنف فارغ');
            if (purchase_price <= 0) errors.push('سعر الشراء غير صحيح');

            return {
                rowNum: idx + 2,
                code, name,
                category: String(r['المجموعة'] || '').trim(),
                company: String(r['الشركة'] || '').trim(),
                unit: String(r['الوحدة'] || 'قطعة').trim(),
                purchase_price,
                prices: {
                    'جملة': parseFloat(r['جملة']) || 0,
                    'نص جملة': parseFloat(r['نص جملة']) || 0,
                    'قطاعي': parseFloat(r['قطاعي']) || 0,
                    'مميز': parseFloat(r['مميز']) || 0,
                    'خاص': parseFloat(r['خاص']) || 0,
                },
                reorder_point: parseFloat(r['حد الطلب']) || 0,
                barcode: String(r['الباركود'] || '').trim(),
                opening_qty: parseFloat(r['الرصيد الافتتاحي']) || 0,
                errors,
            };
        });

        piRenderPreview();
    } catch (err) {
        alert('❌ خطأ في قراءة الملف: ' + err.message);
    }
};

function piRenderPreview() {
    const validRows = _piParsedRows.filter(r => r.errors.length === 0);
    const errorRows = _piParsedRows.filter(r => r.errors.length > 0);
    const newCategories = [...new Set(_piParsedRows.map(r=>r.category).filter(c=>c && !_piCategories.find(x=>x.name===c)))];
    const newCompanies = [...new Set(_piParsedRows.map(r=>r.company).filter(c=>c && !_piCompanies.find(x=>x.name===c)))];

    document.getElementById('piPreviewArea').innerHTML = `
        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">📋</div><div class="mod-card-val">${_piParsedRows.length}</div><div class="mod-card-lbl">إجمالي الصفوف</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#F0FDF4;color:#059669">✅</div><div class="mod-card-val">${validRows.length}</div><div class="mod-card-lbl">صفوف سليمة</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FEE2E2;color:#DC2626">⚠️</div><div class="mod-card-val">${errorRows.length}</div><div class="mod-card-lbl">صفوف بها أخطاء</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#F5F3FF;color:#7C3AED">🆕</div><div class="mod-card-val">${newCategories.length + newCompanies.length}</div><div class="mod-card-lbl">مجموعات/شركات جديدة</div></div>
        </div>

        ${errorRows.length ? `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px 16px;margin-bottom:16px">
            <strong style="color:#991B1B;font-size:13px">⚠️ صفوف بها أخطاء (لن تُستورد):</strong>
            <ul style="margin:8px 0 0;padding-right:20px;font-size:12px;color:#991B1B">
                ${errorRows.map(r=>`<li>صف ${r.rowNum}: ${r.errors.join('، ')}</li>`).join('')}
            </ul>
        </div>` : ''}

        ${(newCategories.length || newCompanies.length) ? `<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:12.5px;color:#1E40AF">
            🆕 سيتم إنشاء تلقائياً: ${newCategories.map(c=>`مجموعة "${c}"`).join('، ')}${newCategories.length&&newCompanies.length?'، ':''}${newCompanies.map(c=>`شركة "${c}"`).join('، ')}
        </div>` : ''}

        <div class="mod-table-wrap" style="margin-bottom:16px">
            <table class="mod-table"><thead><tr>
                <th>#</th><th>الكود</th><th>الصنف</th><th>المجموعة</th><th>الشركة</th>
                <th style="text-align:left">سعر الشراء</th><th style="text-align:left">جملة</th><th></th>
            </tr></thead><tbody>
                ${_piParsedRows.slice(0, 50).map(r => `<tr style="${r.errors.length?'background:#FEF2F2':''}">
                    <td>${r.rowNum}</td>
                    <td dir="ltr" style="text-align:right">${r.code||'—'}</td>
                    <td>${r.name||'—'}</td>
                    <td>${r.category||'—'}</td>
                    <td>${r.company||'—'}</td>
                    <td style="text-align:left">${piFmt(r.purchase_price)}</td>
                    <td style="text-align:left">${piFmt(r.prices['جملة'])}</td>
                    <td>${r.errors.length ? '❌' : '✅'}</td>
                </tr>`).join('')}
            </tbody></table>
            ${_piParsedRows.length > 50 ? `<p style="text-align:center;padding:10px;color:#94A3B8;font-size:12px">... و${_piParsedRows.length-50} صف آخر</p>` : ''}
        </div>

        <button class="mod-btn mod-btn-primary" style="padding:14px 32px;font-size:14px" onclick="piExecuteImport()" ${!validRows.length?'disabled':''}>
            💾 استيراد ${validRows.length} صنف الآن
        </button>
        <span id="piImportProgress" style="margin-right:14px;font-size:13px;color:#64748B"></span>`;
}

// ════════════════════════════════════════════════════════════
// 3) التنفيذ الفعلي — إنشاء مجموعات/شركات، ثم UPSERT الأصناف والأسعار
// ════════════════════════════════════════════════════════════
window.piExecuteImport = async function() {
    const validRows = _piParsedRows.filter(r => r.errors.length === 0);
    if (!validRows.length) return;
    if (!confirm(`سيتم استيراد ${validRows.length} صنف. متابعة؟`)) return;

    const btn = document.querySelector('#piPreviewArea .mod-btn-primary');
    const progress = document.getElementById('piImportProgress');
    btn.disabled = true;

    try {
        // 1) إنشاء المجموعات الجديدة
        const catMap = {};
        _piCategories.forEach(c => catMap[c.name] = c.id);
        const neededCats = [...new Set(validRows.map(r=>r.category).filter(Boolean))].filter(c=>!catMap[c]);
        for (const name of neededCats) {
            const { data, error } = await sb.from('product_categories').insert({ name }).select().single();
            if (!error) catMap[name] = data.id;
        }

        // 2) إنشاء الشركات الجديدة
        const compMap = {};
        _piCompanies.forEach(c => compMap[c.name] = c.id);
        const neededComps = [...new Set(validRows.map(r=>r.company).filter(Boolean))].filter(c=>!compMap[c]);
        for (const name of neededComps) {
            const { data, error } = await sb.from('product_companies').insert({ name }).select().single();
            if (!error) compMap[name] = data.id;
        }

        // 3) خريطة مستويات الأسعار (بالاسم العربي → id)
        const levelMap = {};
        _piPriceLevels.forEach(l => {
            const arabicName = Object.keys(PI_LEVEL_CODES).find(k => PI_LEVEL_CODES[k] === l.code);
            if (arabicName) levelMap[arabicName] = l.id;
        });

        // 4) UPSERT الأصناف واحداً تلو الآخر (مع تحديث progress)
        let done = 0, failed = 0, balancesCreated = 0;
        for (const r of validRows) {
            progress.textContent = `⏳ جاري الاستيراد... ${done + failed}/${validRows.length}`;
            try {
                const payload = {
                    code: r.code, name: r.name,
                    category_id: r.category ? catMap[r.category] : null,
                    company_id: r.company ? compMap[r.company] : null,
                    unit: r.unit, sale_unit: r.unit,
                    purchase_price: r.purchase_price,
                    reorder_point: r.reorder_point,
                    barcode: r.barcode || null,
                };
                const { data: prod, error: prodErr } = await sb.from('products')
                    .upsert(payload, { onConflict: 'code' }).select().single();
                if (prodErr) throw prodErr;

                // مستويات الأسعار
                for (const [levelName, price] of Object.entries(r.prices)) {
                    if (price <= 0) continue;
                    const levelId = levelMap[levelName];
                    if (!levelId) continue;
                    await sb.from('product_prices').upsert({
                        product_id: prod.id, price_level_id: levelId, price
                    }, { onConflict: 'product_id,price_level_id' });
                }
                // مزامنة wholesale/retail (للتوافق مع شاشة المبيعات)
                await sb.from('products').update({
                    wholesale_price: r.prices['جملة'] || 0,
                    retail_price: r.prices['قطاعي'] || 0,
                }).eq('id', prod.id);

                // رصيد افتتاحي للمخزون (لو الصنف بيه رصيد بداية ومفيش رصيد افتتاحي مسجّل له من قبل)
                if (r.opening_qty > 0 && _piMainWarehouseId && !_piExistingBalanceProductIds.has(prod.id)) {
                    await sb.from('opening_balances').insert({
                        balance_type: 'inventory',
                        product_id: prod.id,
                        warehouse_id: _piMainWarehouseId,
                        qty: r.opening_qty,
                        unit_cost: r.purchase_price,
                        amount: r.opening_qty * r.purchase_price,
                        as_of_date: new Date().toISOString().slice(0,10),
                        status: 'confirmed',
                        created_by: currentUser?.id || null,
                    });
                    _piExistingBalanceProductIds.add(prod.id); // منع تكرار في نفس عملية الاستيراد لو تكرر الكود بالخطأ
                    balancesCreated++;
                }

                done++;
            } catch (e) { failed++; }
        }

        progress.textContent = '';
        alert(`✅ اكتمل الاستيراد\nنجح: ${done}\nفشل: ${failed}\nأرصدة افتتاحية جديدة: ${balancesCreated}`);
        renderProductImport(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ عام أثناء الاستيراد: ' + err.message);
        btn.disabled = false;
    }
};

Object.assign(window, { renderProductImport, piDownloadTemplate, piHandleFile, piExecuteImport });
