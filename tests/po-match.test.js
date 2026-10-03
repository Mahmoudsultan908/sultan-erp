const test = require('node:test'); const assert = require('node:assert');
const { makeSb, makeEnv } = require('./helpers');

const FILES = ['js/modules/features.js', 'js/modules/purchase-orders.js'];
const rows = [
    { product_id: 'a', product_name: 'صنف أ', ordered_qty: 10, ordered_price: 5, received_qty: 6, invoiced_price: 5.5, qty_diff: -4, price_diff_pct: 10, qty_status: 'short', price_flag: true },
    { product_id: 'b', product_name: 'صنف ب', ordered_qty: 4, ordered_price: 20, received_qty: 4, invoiced_price: 20, qty_diff: 0, price_diff_pct: 0, qty_status: 'ok', price_flag: false },
];
function env(flag, status = 'partial') {
    const sb = makeSb({
        tables: {
            app_settings: { data: { value: flag }, error: null },
            purchase_orders: [{ id: 'o1', order_no: 'PO-0001', status, total: 100, expected_date: null, supplier_id: 's', suppliers: { name: 'مورد' } }],
            purchase_order_items: [{ id: 'i1', order_id: 'o1', product_id: 'a', qty: 10, unit_price: 5, products: { name: 'صنف أ', code: 'a', unit: 'قطعة', units_per_carton: 1 } }],
        },
        rpc: { fn_po_match: () => ({ data: rows, error: null }) },
    });
    return { sb, ...makeEnv({ files: FILES, sb, globals: { loadMod() {} } }) };
}

test('أوامر الشراء: زرار المطابقة مخفي لو الميزة off، وظاهر لو on', async () => {
    let e = env('off'); await e.run("renderPurchaseOrders(document.getElementById('app-content'))");
    assert.doesNotMatch(e.w.document.body.innerHTML, /poOpenMatch/);
    e = env('on'); await e.run("renderPurchaseOrders(document.getElementById('app-content'))");
    assert.match(e.w.document.body.innerHTML, /poOpenMatch/); assert.match(e.text('#app-content'), /استلام جزئي/);
    assert.match(e.w.document.body.innerHTML, /استلام الباقي/);
});

test('نافذة المطابقة: بتعلّم الناقص والسعر الأعلى', async () => {
    const e = env('on'); await e.run("poOpenMatch('o1')");
    const t = e.text('#poMatchModal');
    assert.match(t, /ناقص/); assert.match(t, /مطابق/); assert.match(t, /\+10%/); assert.match(t, /1<\/b> صنف|1 صنف/);
    assert.deepEqual(e.sb.calls.rpcs[0], ['fn_po_match', { p_order_id: 'o1' }]);
});

test('استلام الباقي: بيحمّل المتبقي بس (المطلوب − اللي وصل)', async () => {
    const e = env('on'); e.w.confirm = () => true;
    await e.run("poConvertToPurchase('o1')");
    const p = e.w._pendingPOConversion;
    assert.equal(p.items.length, 1); assert.equal(p.items[0].pid, 'a'); assert.equal(p.items[0].qty, 4);
});
