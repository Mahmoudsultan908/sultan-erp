/* ════════════════════════════════════════════════════════════
   استيراد العملاء والموردين بالديون — customer-supplier-import.js
   يصدّر: renderCustomerImport(container), renderSupplierImport(container)
   يستخدم مكتبة XLSX (SheetJS) المحمّلة بالفعل في index.html
   ════════════════════════════════════════════════════════════ */

let _csiParsedRows = [];
let _csiRegions = [];
let _csiClassifications = [];
let _csiGroups = [];
let _csiExistingBalanceIds = new Set();
let _csiMode = 'customer'; // 'customer' | 'supplier'

function csiFmt(n) { return (Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const CSI_CUST_HEADERS = ['الاسم','الهاتف','المنطقة','التصنيف','المجموعة','الحد الائتماني','الدين الافتتاحي'];
const CSI_SUPP_HEADERS = ['الاسم','الهاتف','المديونية الافتتاحية'];

// ════════════════════════════════════════════════════════════
// نقاط الدخول
// ════════════════════════════════════════════════════════════
async function renderCustomerImport(c) { _csiMode = 'customer'; await csiRenderPage(c); }
async function renderSupplierImport(c) { _csiMode = 'supplier'; await csiRenderPage(c); }

async function csiRenderPage(c) {
    _csiParsedRows = [];
    const isCust = _csiMode === 'customer';
    c.innerHTML = `
        <div style="margin-bottom:20px"><h2 style="font-size:22px;font-weight:800">${isCust?'👥 استيراد العملاء بالديون':'🏭 استيراد الموردين بالديون'}</h2>
        <p style="font-size:13px;color:#64748B;margin-top:4px">${isCust?'استيراد جماعي للعملاء مع أرصدتهم المستحقة':'استيراد جماعي للموردين مع مديونياتنا لهم'}</p></div>

        <div class="dash-card" style="padding:24px;margin-bottom:16px">
            <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
                <button class="mod-btn" style="background:#F1F5F9;color:#475569" onclick="csiDownloadTemplate()">📄 تنزيل القالب الفارغ</button>
                <div style="flex:1;min-width:220px">
                    <input type="file" id="csiFileInput" accept=".xlsx,.xls" style="display:none" onchange="csiHandleFile(this.files[0])">
                    <button class="mod-btn mod-btn-primary" onclick="document.getElementById('csiFileInput').click()">📂 اختر ملف Excel</button>
                    <span id="csiFileName" style="font-size:12.5px;color:#64748B;margin-right:10px"></span>
                </div>
            </div>
            <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:10px 14px;font-size:12.5px;color:#1E40AF;margin-top:14px">
                💡 الدين/المديونية الافتتاحية اختياري — اتركه فارغاً أو صفر لو العميل/المورد جديد بدون رصيد سابق.
                ${isCust ? ' المنطقة والتصنيف والمجموعة اختيارية أيضاً، وستُنشأ تلقائياً لو غير موجودة.' : ''}
            </div>
        </div>

        <div id="csiPreviewArea"></div>`;
}

window.csiDownloadTemplate = function() {
    const isCust = _csiMode === 'customer';
    const wb = XLSX.utils.book_new();
    const wsData = isCust
        ? [CSI_CUST_HEADERS, ['محمد أحمد', '01012345678', 'منطقة 1', 'بقالة', 'قطاعي', 5000, 1200]]
        : [CSI_SUPP_HEADERS, ['شركة الوطنية للأغذية', '0223456789', 8500]];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = isCust
        ? [{wch:22},{wch:14},{wch:14},{wch:14},{wch:14},{wch:14},{wch:16}]
        : [{wch:26},{wch:14},{wch:18}];
    XLSX.utils.book_append_sheet(wb, ws, isCust ? 'استيراد العملاء' : 'استيراد الموردين');
    XLSX.writeFile(wb, isCust ? 'قالب_استيراد_العملاء.xlsx' : 'قالب_استيراد_الموردين.xlsx');
};

// ════════════════════════════════════════════════════════════
// قراءة الملف
// ════════════════════════════════════════════════════════════
window.csiHandleFile = async function(file) {
    if (!file) return;
    const isCust = _csiMode === 'customer';
    document.getElementById('csiFileName').textContent = '📄 ' + file.name;

    try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (!rows.length) { alert('⚠️ الملف فارغ'); return; }

        if (isCust) {
            const [{ data: regions }, { data: classifications }, { data: groups }, { data: existing }] = await Promise.all([
                sb.from('customer_regions').select('*'),
                sb.from('customer_classifications').select('*'),
                sb.from('customer_groups').select('*'),
                sb.from('opening_balances').select('customer_id').eq('balance_type','customer').eq('status','confirmed'),
            ]);
            _csiRegions = regions || [];
            _csiClassifications = classifications || [];
            _csiGroups = groups || [];
            _csiExistingBalanceIds = new Set((existing||[]).map(b=>b.customer_id));

            _csiParsedRows = rows.map((r, idx) => {
                const name = String(r['الاسم'] || '').trim();
                const errors = [];
                if (!name) errors.push('الاسم فارغ');
                return {
                    rowNum: idx + 2, name,
                    phone: String(r['الهاتف'] || '').trim(),
                    region: String(r['المنطقة'] || '').trim(),
                    classification: String(r['التصنيف'] || '').trim(),
                    group: String(r['المجموعة'] || '').trim(),
                    credit_limit: parseFloat(r['الحد الائتماني']) || 0,
                    opening_debt: parseFloat(r['الدين الافتتاحي']) || 0,
                    errors,
                };
            });
        } else {
            const { data: existing } = await sb.from('opening_balances').select('supplier_id').eq('balance_type','supplier').eq('status','confirmed');
            _csiExistingBalanceIds = new Set((existing||[]).map(b=>b.supplier_id));

            _csiParsedRows = rows.map((r, idx) => {
                const name = String(r['الاسم'] || '').trim();
                const errors = [];
                if (!name) errors.push('الاسم فارغ');
                return {
                    rowNum: idx + 2, name,
                    phone: String(r['الهاتف'] || '').trim(),
                    opening_debt: parseFloat(r['المديونية الافتتاحية']) || 0,
                    errors,
                };
            });
        }

        csiRenderPreview();
    } catch (err) {
        alert('❌ خطأ في قراءة الملف: ' + err.message);
    }
};

function csiRenderPreview() {
    const isCust = _csiMode === 'customer';
    const validRows = _csiParsedRows.filter(r => r.errors.length === 0);
    const errorRows = _csiParsedRows.filter(r => r.errors.length > 0);

    document.getElementById('csiPreviewArea').innerHTML = `
        <div class="mod-grid" style="margin-bottom:16px">
            <div class="mod-card"><div class="mod-card-icon" style="background:#EFF6FF;color:#2563EB">📋</div><div class="mod-card-val">${_csiParsedRows.length}</div><div class="mod-card-lbl">إجمالي الصفوف</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#F0FDF4;color:#059669">✅</div><div class="mod-card-val">${validRows.length}</div><div class="mod-card-lbl">صفوف سليمة</div></div>
            <div class="mod-card"><div class="mod-card-icon" style="background:#FEE2E2;color:#DC2626">⚠️</div><div class="mod-card-val">${errorRows.length}</div><div class="mod-card-lbl">صفوف بها أخطاء</div></div>
        </div>

        ${errorRows.length ? `<div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px 16px;margin-bottom:16px">
            <strong style="color:#991B1B;font-size:13px">⚠️ صفوف بها أخطاء (لن تُستورد):</strong>
            <ul style="margin:8px 0 0;padding-right:20px;font-size:12px;color:#991B1B">
                ${errorRows.map(r=>`<li>صف ${r.rowNum}: ${r.errors.join('، ')}</li>`).join('')}
            </ul>
        </div>` : ''}

        <div class="mod-table-wrap" style="margin-bottom:16px">
            <table class="mod-table"><thead><tr>
                <th>#</th><th>الاسم</th><th>الهاتف</th>${isCust?'<th>المنطقة</th><th>التصنيف</th>':''}
                <th style="text-align:left">${isCust?'الدين الافتتاحي':'المديونية الافتتاحية'}</th><th></th>
            </tr></thead><tbody>
                ${_csiParsedRows.slice(0, 50).map(r => `<tr style="${r.errors.length?'background:#FEF2F2':''}">
                    <td>${r.rowNum}</td>
                    <td>${r.name||'—'}</td>
                    <td dir="ltr" style="text-align:right">${r.phone||'—'}</td>
                    ${isCust?`<td>${r.region||'—'}</td><td>${r.classification||'—'}</td>`:''}
                    <td style="text-align:left">${csiFmt(r.opening_debt)}</td>
                    <td>${r.errors.length ? '❌' : '✅'}</td>
                </tr>`).join('')}
            </tbody></table>
            ${_csiParsedRows.length > 50 ? `<p style="text-align:center;padding:10px;color:#94A3B8;font-size:12px">... و${_csiParsedRows.length-50} صف آخر</p>` : ''}
        </div>

        <button class="mod-btn mod-btn-primary" style="padding:14px 32px;font-size:14px" onclick="csiExecuteImport()" ${!validRows.length?'disabled':''}>
            💾 استيراد ${validRows.length} ${isCust?'عميل':'مورد'} الآن
        </button>
        <span id="csiImportProgress" style="margin-right:14px;font-size:13px;color:#64748B"></span>`;
}

// ════════════════════════════════════════════════════════════
// التنفيذ الفعلي
// ════════════════════════════════════════════════════════════
window.csiExecuteImport = async function() {
    const isCust = _csiMode === 'customer';
    const validRows = _csiParsedRows.filter(r => r.errors.length === 0);
    if (!validRows.length) return;
    if (!confirm(`سيتم استيراد ${validRows.length} ${isCust?'عميل':'مورد'}. متابعة؟`)) return;

    const btn = document.querySelector('#csiPreviewArea .mod-btn-primary');
    const progress = document.getElementById('csiImportProgress');
    btn.disabled = true;

    try {
        let regionMap = {}, classMap = {}, groupMap = {};
        if (isCust) {
            _csiRegions.forEach(r=>regionMap[r.name]=r.id);
            _csiClassifications.forEach(c=>classMap[c.name]=c.id);
            _csiGroups.forEach(g=>groupMap[g.name]=g.id);

            const neededRegions = [...new Set(validRows.map(r=>r.region).filter(Boolean))].filter(r=>!regionMap[r]);
            for (const name of neededRegions) {
                const { data, error } = await sb.from('customer_regions').insert({ name }).select().single();
                if (!error) regionMap[name] = data.id;
            }
            const neededClasses = [...new Set(validRows.map(r=>r.classification).filter(Boolean))].filter(c=>!classMap[c]);
            for (const name of neededClasses) {
                const { data, error } = await sb.from('customer_classifications').insert({ name }).select().single();
                if (!error) classMap[name] = data.id;
            }
        }

        let done = 0, failed = 0, balancesCreated = 0;
        for (const r of validRows) {
            progress.textContent = `⏳ جاري الاستيراد... ${done + failed}/${validRows.length}`;
            try {
                let entityId;
                if (isCust) {
                    const payload = {
                        name: r.name, phone: r.phone || null,
                        region_id: r.region ? regionMap[r.region] : null,
                        classification_id: r.classification ? classMap[r.classification] : null,
                        group_id: r.group ? groupMap[r.group] : null,
                        credit_limit: r.credit_limit,
                    };
                    const { data, error } = await sb.from('customers').insert({ ...payload, balance: 0 }).select().single();
                    if (error) throw error;
                    entityId = data.id;
                } else {
                    const { data, error } = await sb.from('suppliers').insert({ name: r.name, phone: r.phone || null, balance: 0 }).select().single();
                    if (error) throw error;
                    entityId = data.id;
                }

                // رصيد افتتاحي (دين/مديونية) — لو موجود ومفيش رصيد مسجّل من قبل لنفس الكيان
                if (r.opening_debt > 0 && !_csiExistingBalanceIds.has(entityId)) {
                    const payload = isCust
                        ? { balance_type: 'customer', customer_id: entityId, amount: r.opening_debt }
                        : { balance_type: 'supplier', supplier_id: entityId, amount: r.opening_debt };
                    await sb.from('opening_balances').insert({
                        ...payload,
                        as_of_date: new Date().toISOString().slice(0,10),
                        status: 'confirmed',
                        created_by: currentUser?.id || null,
                    });
                    balancesCreated++;
                }
                done++;
            } catch (e) { failed++; }
        }

        progress.textContent = '';
        alert(`✅ اكتمل الاستيراد\nنجح: ${done}\nفشل: ${failed}\nأرصدة افتتاحية جديدة: ${balancesCreated}`);
        csiRenderPage(document.getElementById('app-content'));
    } catch (err) {
        alert('❌ خطأ عام أثناء الاستيراد: ' + err.message);
        btn.disabled = false;
    }
};

Object.assign(window, { renderCustomerImport, renderSupplierImport, csiDownloadTemplate, csiHandleFile, csiExecuteImport });
