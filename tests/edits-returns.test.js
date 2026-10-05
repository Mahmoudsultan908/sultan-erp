// تصليحات 5 أكتوبر: أقصى كمية للمرتجع = الباقي بعد المرتجعات السابقة، رفض الفاتورة الملغاة،
// والتعديل (فاتورة/مشتريات/مرتجع) بنداء واحد ذرّي fn_edit_* بدل عكس + تسجيل منفصلين.
const test = require('node:test');
const assert = require('node:assert');
const { makeSb, makeEnv } = require('./helpers');

const RET_HTML = '<input id="retInvNo" value="INV-0001"><div id="app-content"></div>';
const stubRet = (run) => run(`
    var __toasts = [];
    retToast = (m, t) => __toasts.push([m, t]);
    retRenderItems = () => {}; retUpdateSummary = () => {}; retUpdateEntityChip = () => {}; retDocInfoCardHTML = () => '';
`);
const sale = (status) => ({
    data: { id: 's1', invoice_no: 'INV-0001', status, customer_id: 'c1', rep_id: null, warehouse_id: 'w1',
        sale_items: [
            { id: 'i1', product_id: 'p1', qty: 2, unit_price: 10, discount_pct: 0, products: { name: 'سكر' } },
            { id: 'i2', product_id: 'p1', qty: 5, unit_price: 10, discount_pct: 0, products: { name: 'سكر' } },
            { id: 'i3', product_id: 'p2', qty: 1, unit_price: 7, discount_pct: 0, products: { name: 'رز' } },
        ] },
    error: null,
});

test('المرتجع: المرتجعات المؤكدة السابقة بتتجمع لكل صنف', async () => {
    const sb = makeSb({ tables: { sales_returns: [
        { id: 'r1', sale_return_items: [{ product_id: 'p1', qty: 3 }, { product_id: 'p2', qty: 1 }] },
        { id: 'r2', sale_return_items: [{ product_id: 'p1', qty: 1.5 }] },
    ] } });
    const { run } = makeEnv({ files: ['js/modules/returns.js'], sb });
    const map = await run("retLoadReturnedQty('sales', 's1')");
    assert.deepEqual(JSON.parse(JSON.stringify(map)), { p1: 4.5, p2: 1 });
    const q = sb.calls.queries.find(x => x.table === 'sales_returns');
    assert.deepEqual(q.ops.filter(o => o[0] === 'eq').map(o => o[1]), [['sale_id', 's1'], ['status', 'confirmed']]);
});

test('المرتجع: الكمية اللي اترجعت قبل كده بتتخصم من أقصى كمية حتى لو الصنف في أكتر من سطر', () => {
    const { run } = makeEnv({ files: ['js/modules/returns.js'], sb: makeSb() });
    run("var __it = [{pid:'p1',qty:2,maxQty:2},{pid:'p1',qty:5,maxQty:5},{pid:'p2',qty:1,maxQty:1},{pid:'p3',qty:2,maxQty:2}]");
    assert.equal(run("retApplyReturnedQty(__it, { p1: 4, p2: 1 })"), true);
    const it = JSON.parse(run('JSON.stringify(__it)'));
    assert.deepEqual(it.map(x => [x.maxQty, x.qty, x.prevReturned ?? 0]), [[0, 0, 2], [3, 3, 2], [0, 0, 1], [2, 2, 0]]);
    run("var __none = [{pid:'p1',qty:2,maxQty:2}]");
    assert.equal(run('retApplyReturnedQty(__none, {})'), false);
});

test('المرتجع المرتبط بفاتورة: بيعرض الباقي بس ويقول إن فيه مرتجع قبل كده', async () => {
    const sb = makeSb({ tables: { sales: () => sale('confirmed'), sales_returns: [{ id: 'r1', sale_return_items: [{ product_id: 'p1', qty: 3 }] }] } });
    const { run } = makeEnv({ files: ['js/modules/returns.js'], sb, html: RET_HTML });
    stubRet(run);
    await run('retSearchInvoice()');
    assert.deepEqual(JSON.parse(run('JSON.stringify(retItems.map(i => i.maxQty))')), [0, 4, 1]);
    const toasts = JSON.parse(run('JSON.stringify(__toasts)'));
    assert.match(toasts.at(-1)[0], /الكمية الظاهرة هي الباقي/);
});

test('المرتجع المرتبط بفاتورة: الفاتورة اللي اترجعت كلها بتقول مفيش حاجة تترجع', async () => {
    const sb = makeSb({ tables: { sales: () => sale('confirmed'), sales_returns: [{ id: 'r1', sale_return_items: [{ product_id: 'p1', qty: 7 }, { product_id: 'p2', qty: 1 }] }] } });
    const { run } = makeEnv({ files: ['js/modules/returns.js'], sb, html: RET_HTML });
    stubRet(run);
    await run('retSearchInvoice()');
    const toasts = JSON.parse(run('JSON.stringify(__toasts)'));
    assert.match(toasts.at(-1)[0], /اترجعت كلها/);
    assert.equal(toasts.at(-1)[1], 'error');
});

test('المرتجع: فاتورة ملغاة أو اتعدّلت بترفض ومش بتحمّل بنود', async () => {
    const sb = makeSb({ tables: { sales: () => sale('cancelled'), sales_returns: [] } });
    const { run } = makeEnv({ files: ['js/modules/returns.js'], sb, html: RET_HTML });
    stubRet(run);
    await run('retSearchInvoice()');
    assert.equal(run('retItems.length'), 0);
    assert.equal(run('retLinkedDoc'), null);
    assert.match(JSON.parse(run('JSON.stringify(__toasts)')).at(-1)[0], /ملغاة أو اتعدّلت/);
    assert.equal(sb.calls.queries.some(q => q.table === 'sales_returns'), false);
});

test('الأصناف: retail_price و wholesale_price بيتحفظوا حسب كود المستوى مش ترتيبه', () => {
    // الكود نفسه جوه prodSave — بنتأكد إنه مبقاش بيعتمد على أول مستويين بالترتيب
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js/modules/products.js'), 'utf8');
    assert.doesNotMatch(src, /_prodPriceLevels\[0\]|_prodPriceLevels\[1\]/);
    assert.match(src, /prodLevelPrice\('RETAIL'\)/);
    assert.match(src, /prodLevelPrice\('WHOLESALE'\)/);
});

test('التعديل بقى نداء واحد ذرّي: مفيش نداءات fn_reverse_*_for_edit منفصلة من الشاشات', () => {
    const fs = require('fs'), path = require('path');
    const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const sales = read('js/modules/sales.js'), pur = read('js/modules/purchases.js'), ret = read('js/modules/returns.js');
    assert.doesNotMatch(sales, /rpc\('fn_reverse_sale_for_edit'/);
    assert.doesNotMatch(pur, /rpc\('fn_reverse_purchase_for_edit'/);
    assert.doesNotMatch(ret, /'fn_reverse_(sales|purchase)_return_for_edit'/);
    assert.match(sales, /rpc\('fn_edit_sale', \{ p_sale_id: invEditingId, \.\.\.saleArgs \}\)/);
    assert.match(pur, /rpc\('fn_edit_purchase', \{ p_purchase_id: purEditingId, p_created_at: null, \.\.\.purchaseArgs \}\)/);
    assert.match(ret, /rpc\('fn_edit_sales_return', \{ p_return_id: retEditingId, \.\.\.returnArgs \}\)/);
    assert.match(ret, /rpc\('fn_edit_purchase_return', \{ p_return_id: retEditingId, \.\.\.returnArgs \}\)/);
    assert.doesNotMatch(sales + pur + ret, /p_replaces_id/);
});
