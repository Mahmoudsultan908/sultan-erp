/* ════════════════════════════════════════════════════════════
   مركز الطباعة — print-center.js
   يصدّر: renderPrintCenter(container)

   تصاميم طباعة A4 إضافية للفواتير والسندات — بجانب طباعة الكاشير
   الحرارية 80mm الموجودة أصلاً من كل شاشة (thermal-print.js).
   "حفظ PDF" بيتم عن طريق نافذة الطباعة الأصلية للمتصفح (Save as PDF)
   — مفيش مكتبة PDF خارجية مُضافة، عشان نتفادى إضافة تبعية جديدة
   للمشروع من غير داعي؛ نفس فلسفة thermal-print.js (نافذة popup + print()).
   بيعيد استخدام tpGetCompanyInfo() الموجودة فعلاً في thermal-print.js
   (لازم يتحمّل هذا الملف بعده — راجع index.html).
   ════════════════════════════════════════════════════════════ */

const PC_DOC_TYPES = [
    ['sale', '🧾 فاتورة مبيعات'],
    ['purchase', '📥 فاتورة مشتريات'],
    ['sale_return', '↩️ مرتجع مبيعات'],
    ['purchase_return', '↩️ مرتجع مشتريات'],
    ['collection', '💵 سند قبض'],
    ['payment', '💸 سند صرف'],
];
const PC_PLACEHOLDERS = { sale: 'INV-0001', purchase: 'PUR-0001', sale_return: 'RS-0001', purchase_return: 'RP-0001', collection: 'COL-...', payment: 'PAY-...' };

let _pcDocType = 'sale';
let _pcFoundDoc = null;

function pcFmt(n) { return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function pcNumberLabel() { return ['collection', 'payment'].includes(_pcDocType) ? 'رقم السند' : 'رقم المستند'; }
function pcNumberPlaceholder() { return PC_PLACEHOLDERS[_pcDocType] || ''; }

// ════════════════════════════════════════════════════════════
// 1) التقديم الرئيسي
// ════════════════════════════════════════════════════════════
async function renderPrintCenter(c) {
    c.innerHTML = `
    <div style="margin-bottom:20px"><h2 style="font-size:22px;font-weight:800">🖨️ مركز الطباعة</h2>
    <p style="font-size:13px;color:#64748B;margin-top:4px">تصاميم طباعة A4 إضافية للفواتير والسندات — بجانب طباعة الكاشير الحرارية 80mm الموجودة من كل شاشة</p></div>
    <div style="background:#EFF6FF;border:1px solid #BFDBFE;color:#1E40AF;padding:10px 14px;border-radius:8px;font-size:12px;margin-bottom:16px">
        💡 "حفظ PDF" بيتم من نافذة الطباعة نفسها — اختار "Save as PDF" بدل اسم الطابعة في نافذة الطباعة اللي هتفتح من المتصفح.
    </div>
    <div class="dash-card" style="padding:20px;margin-bottom:16px">
        <label class="ob-label" style="margin-top:0">نوع المستند</label>
        <div class="exp-tabs" style="margin-bottom:14px">
            ${PC_DOC_TYPES.map(([v, l]) => `<button class="exp-tab ${v === _pcDocType ? 'active' : ''}" onclick="pcSwitchType('${v}')">${l}</button>`).join('')}
        </div>
        <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
            <div style="flex:1;min-width:220px"><label class="ob-label">${pcNumberLabel()}</label>
                <input type="text" id="pcDocNo" class="ob-input" style="margin:0" dir="ltr" placeholder="${pcNumberPlaceholder()}" onkeydown="if(event.key==='Enter'){event.preventDefault();pcSearch();}"></div>
            <button class="ob-add-btn" onclick="pcSearch()">🔍 بحث</button>
        </div>
    </div>
    <div id="pc-result"></div>`;
    setTimeout(() => document.getElementById('pcDocNo')?.focus(), 50);
}

window.pcSwitchType = function (type) {
    _pcDocType = type;
    _pcFoundDoc = null;
    window._pcPrintHTML = null;
    renderPrintCenter(document.getElementById('app-content'));
};

function pcNotFoundHTML() {
    return `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:10px;text-align:center">❌ لا يوجد مستند بهذا الرقم</div>`;
}

// ════════════════════════════════════════════════════════════
// 2) البحث عن المستند وتجهيز معاينة الطباعة
// ════════════════════════════════════════════════════════════
window.pcSearch = async function () {
    const no = document.getElementById('pcDocNo')?.value.trim();
    if (!no) { alert('أدخل رقم المستند'); return; }
    const resultEl = document.getElementById('pc-result');
    resultEl.innerHTML = '<div style="text-align:center;padding:30px;color:#64748B">⏳ جاري البحث...</div>';

    try {
        let html;
        const company = await tpGetCompanyInfo();

        if (_pcDocType === 'sale' || _pcDocType === 'purchase') {
            const isSale = _pcDocType === 'sale';
            const table = isSale ? 'sales' : 'purchases';
            const itemsTable = isSale ? 'sale_items' : 'purchase_items';
            const entityJoin = isSale ? 'customers(name)' : 'suppliers(name)';
            const { data, error } = await sb.from(table)
                .select(`*, ${itemsTable}(*, products(name,code,unit)), ${entityJoin}`)
                .eq('invoice_no', no).maybeSingle();
            if (error) throw error;
            if (!data) { resultEl.innerHTML = pcNotFoundHTML(); return; }

            const items = (data[itemsTable] || []).map(it => ({
                name: it.products?.name || '—', code: it.products?.code || '',
                unit: it.products?.unit || it.unit_name || '', qty: Number(it.qty) || 0,
                unit_price: Number(it.unit_price) || 0, disc: Number(it.discount_pct) || 0,
                line_total: Number(it.line_total) || 0,
            }));
            const entityName = isSale ? data.customers?.name : data.suppliers?.name;
            html = pcBuildInvoiceHTML(company, _pcDocType, {
                docNo: data.invoice_no, entityLabel: isSale ? 'العميل' : 'المورد', entityName: entityName || 'نقدي',
                date: new Date(data.created_at).toLocaleDateString('ar-EG'),
                items, hasDisc: isSale, subtotal: Number(data.subtotal) || 0,
                discount: Number(data.discount) || 0, total: Number(data.total) || 0, paymentType: data.payment_type,
            });
            _pcFoundDoc = { title: (isSale ? 'فاتورة مبيعات ' : 'فاتورة مشتريات ') + data.invoice_no, summary: `${entityName || 'نقدي'} — ${pcFmt(data.total)} ج.م — ${items.length} صنف` };

        } else if (_pcDocType === 'sale_return' || _pcDocType === 'purchase_return') {
            const isSale = _pcDocType === 'sale_return';
            const table = isSale ? 'sales_returns' : 'purchase_returns';
            const itemsTable = isSale ? 'sale_return_items' : 'purchase_return_items';
            const entityJoin = isSale ? 'customers(name)' : 'suppliers(name)';
            const { data, error } = await sb.from(table)
                .select(`*, ${itemsTable}(*, products(name,code,unit)), ${entityJoin}`)
                .eq('return_no', no).maybeSingle();
            if (error) throw error;
            if (!data) { resultEl.innerHTML = pcNotFoundHTML(); return; }

            const items = (data[itemsTable] || []).map(it => ({
                name: it.products?.name || '—', code: it.products?.code || '',
                unit: it.products?.unit || it.unit_name || '', qty: Number(it.qty) || 0,
                unit_price: Number(it.unit_price) || 0, disc: Number(it.discount_pct) || 0,
                line_total: Number(it.line_total) || 0,
            }));
            const entityName = isSale ? data.customers?.name : data.suppliers?.name;
            html = pcBuildInvoiceHTML(company, _pcDocType, {
                docNo: data.return_no, entityLabel: isSale ? 'العميل' : 'المورد', entityName: entityName || 'نقدي',
                date: new Date(data.created_at).toLocaleDateString('ar-EG'),
                items, hasDisc: isSale, subtotal: Number(data.subtotal) || 0,
                discount: 0, total: Number(data.total) || 0, paymentType: data.payment_type,
            });
            _pcFoundDoc = { title: (isSale ? 'مرتجع مبيعات ' : 'مرتجع مشتريات ') + data.return_no, summary: `${entityName || 'نقدي'} — ${pcFmt(data.total)} ج.م — ${items.length} صنف` };

        } else {
            const isCollection = _pcDocType === 'collection';
            const table = isCollection ? 'customer_payments' : 'supplier_payments';
            const entityJoin = isCollection ? 'customers(name)' : 'suppliers(name)';
            const { data, error } = await sb.from(table).select(`*, ${entityJoin}`).eq('ref', no).maybeSingle();
            if (error) throw error;
            if (!data) { resultEl.innerHTML = pcNotFoundHTML(); return; }

            const entity = isCollection ? data.customers : data.suppliers;
            html = pcBuildVoucherHTML(company, _pcDocType, {
                ref: data.ref, entityName: entity?.name || '—',
                date: new Date(data.created_at).toLocaleDateString('ar-EG'), amount: Number(data.amount) || 0,
            });
            _pcFoundDoc = { title: (isCollection ? 'سند قبض ' : 'سند صرف ') + data.ref, summary: `${entity?.name || '—'} — ${pcFmt(data.amount)} ج.م` };
        }

        window._pcPrintHTML = html;
        resultEl.innerHTML = `
        <div class="dash-card" style="padding:20px">
            <div style="font-weight:800;font-size:15px;margin-bottom:6px">✅ ${_pcFoundDoc.title}</div>
            <div style="font-size:13px;color:#64748B;margin-bottom:16px">${_pcFoundDoc.summary}</div>
            <button class="mod-btn mod-btn-primary" onclick="pcPrintFound()">🖨️ طباعة A4 / حفظ PDF</button>
        </div>`;
    } catch (err) {
        resultEl.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:16px;border-radius:10px">خطأ: ${err.message}</div>`;
    }
};

window.pcPrintFound = function () {
    if (!window._pcPrintHTML) return;
    pcOpenPrint(window._pcPrintHTML);
};

function pcOpenPrint(html) {
    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) { alert('⚠️ المتصفح منع فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة لهذا الموقع'); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 300);
}

// ════════════════════════════════════════════════════════════
// 3) قوالب A4 (رأس/تذييل مشترك + فاتورة/مرتجع + سند)
// ════════════════════════════════════════════════════════════
function pcWrapper(company, title, bodyHTML) {
    const now = new Date().toLocaleString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Cairo', 'Tahoma', sans-serif; color: #0F172A; font-size: 13px; }
  .pc-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0F172A; padding-bottom: 14px; margin-bottom: 20px; }
  .pc-company-name { font-size: 22px; font-weight: 800; }
  .pc-company-info { font-size: 11.5px; color: #475569; margin-top: 4px; }
  .pc-doc-title { font-size: 20px; font-weight: 800; text-align: left; }
  .pc-doc-date { font-size: 12px; color: #475569; text-align: left; margin-top: 4px; }
  .pc-meta { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 18px; font-size: 12.5px; flex-wrap: wrap; }
  .pc-meta .lbl { color: #64748B; }
  table.pc-items { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  table.pc-items th { background: #F1F5F9; padding: 8px 10px; text-align: right; font-size: 11.5px; border-bottom: 2px solid #CBD5E1; }
  table.pc-items td { padding: 7px 10px; border-bottom: 1px solid #E2E8F0; font-size: 12px; }
  .pc-totals { width: 300px; margin-right: 0; margin-left: auto; }
  .pc-totals .row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 12.5px; }
  .pc-totals .grand { border-top: 2px solid #0F172A; margin-top: 6px; padding-top: 8px; font-size: 16px; font-weight: 800; }
  .pc-footer { margin-top: 50px; display: flex; justify-content: space-between; }
  .pc-sign { width: 180px; border-top: 1px solid #94A3B8; text-align: center; padding-top: 6px; font-size: 11.5px; color: #64748B; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="pc-header">
    <div>
      <div class="pc-company-name">${company.name}</div>
      ${company.phone ? `<div class="pc-company-info">📞 ${company.phone}</div>` : ''}
      ${company.address ? `<div class="pc-company-info">${company.address}</div>` : ''}
    </div>
    <div>
      <div class="pc-doc-title">${title}</div>
      <div class="pc-doc-date">${now}</div>
    </div>
  </div>
  ${bodyHTML}
  <script>window.onload=function(){}<\/script>
</body>
</html>`;
}

// data = { docNo, entityLabel, entityName, date, items:[{name,code,unit,qty,unit_price,disc,line_total}],
//          hasDisc, subtotal, discount, total, paymentType }
function pcBuildInvoiceHTML(company, kind, data) {
    const title = kind === 'sale' ? 'فاتورة مبيعات'
        : kind === 'purchase' ? 'فاتورة مشتريات'
        : kind === 'sale_return' ? 'مرتجع مبيعات'
        : 'مرتجع مشتريات';

    const body = `
    <div class="pc-meta">
        <div><span class="lbl">${data.entityLabel}:</span> <strong>${data.entityName || '—'}</strong></div>
        <div><span class="lbl">التاريخ:</span> ${data.date}</div>
        <div><span class="lbl">رقم المستند:</span> <strong dir="ltr">${data.docNo}</strong></div>
    </div>
    <table class="pc-items">
        <thead><tr>
            <th>#</th><th>الصنف</th><th>الكود</th><th>الكمية</th><th>السعر</th>${data.hasDisc ? '<th>خصم%</th>' : ''}<th>الإجمالي</th>
        </tr></thead>
        <tbody>
            ${data.items.map((it, i) => `<tr>
                <td>${i + 1}</td><td>${it.name}</td><td dir="ltr">${it.code || ''}</td>
                <td>${it.qty} ${it.unit || ''}</td><td>${pcFmt(it.unit_price)}</td>
                ${data.hasDisc ? `<td>${it.disc || 0}%</td>` : ''}<td>${pcFmt(it.line_total)}</td>
            </tr>`).join('')}
        </tbody>
    </table>
    <div class="pc-totals">
        <div class="row"><span>إجمالي الأصناف</span><span>${pcFmt(data.subtotal)}</span></div>
        ${data.discount ? `<div class="row"><span>الخصم</span><span>-${pcFmt(data.discount)}</span></div>` : ''}
        <div class="row grand"><span>الإجمالي</span><span>${pcFmt(data.total)}</span></div>
        ${data.paymentType ? `<div class="row"><span>نوع الدفع</span><span>${data.paymentType === 'cash' ? 'نقدي' : 'آجل'}</span></div>` : ''}
    </div>
    <div class="pc-footer">
        <div class="pc-sign">توقيع المستلم</div>
        <div class="pc-sign">توقيع المسؤول</div>
    </div>`;
    return pcWrapper(company, title + ' ' + data.docNo, body);
}

// data = { ref, entityName, date, amount }
function pcBuildVoucherHTML(company, kind, data) {
    const isCollection = kind === 'collection';
    const title = isCollection ? 'سند قبض' : 'سند صرف';
    const entityLabel = isCollection ? 'العميل' : 'المورد';

    const body = `
    <div class="pc-meta">
        <div><span class="lbl">${entityLabel}:</span> <strong>${data.entityName}</strong></div>
        <div><span class="lbl">التاريخ:</span> ${data.date}</div>
        <div><span class="lbl">رقم السند:</span> <strong dir="ltr">${data.ref}</strong></div>
    </div>
    <div class="pc-totals" style="width:100%;margin:30px 0">
        <div class="row grand" style="justify-content:center;gap:24px"><span>المبلغ</span><span>${pcFmt(data.amount)} ج.م</span></div>
    </div>
    <div class="pc-footer">
        <div class="pc-sign">توقيع المستلم</div>
        <div class="pc-sign">توقيع المسؤول</div>
    </div>`;
    return pcWrapper(company, title + ' ' + data.ref, body);
}

Object.assign(window, { renderPrintCenter, pcSwitchType, pcSearch, pcPrintFound });
