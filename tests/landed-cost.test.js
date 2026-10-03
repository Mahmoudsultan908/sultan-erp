const test = require('node:test'); const assert = require('node:assert');
const { makeSb, makeEnv } = require('./helpers');

const FILES = ['js/modules/features.js', 'js/modules/landed-cost.js'];
const eff = [
    { purchase_item_id: 'i1', product_id: 'a', product_name: 'صنف أ', qty: 10, unit_price: 5, line_total: 50, allocated: 10, effective_unit_cost: 6, master_price: 5 },
    { purchase_item_id: 'i2', product_id: 'b', product_name: 'صنف ب', qty: 5, unit_price: 20, line_total: 100, allocated: 0, effective_unit_cost: 20, master_price: 20 },
];
function env(flag) {
    const sb = makeSb({
        tables: {
            app_settings: { data: { value: flag }, error: null },
            purchases: [{ id: 'p1', invoice_no: 'PUR-1', total: 150, created_at: '2026-10-01T00:00:00Z', suppliers: { name: 'مورد' } }],
            treasuries: [{ id: 't1', name: 'نقدي', kind: 'cash' }],
            purchase_landed_costs: [{ id: 'l1', purchase_id: 'p1', kind: 'freight', amount: 30, method: 'value', paid_via: 'supplier', status: 'confirmed', created_at: '2026-10-02T00:00:00Z', notes: null, treasuries: null }],
        },
        rpc: { fn_purchase_effective_cost: () => ({ data: eff, error: null }), fn_landed_cost_apply_prices: () => ({ data: 1, error: null }) },
    });
    return { sb, ...makeEnv({ files: FILES, sb }) };
}

test('تكلفة الشحن: مقفولة لو الميزة off', async () => {
    const { sb, run, text } = env('off');
    await run("renderLandedCost(document.getElementById('app-content'))");
    assert.match(text('#app-content'), /مقفولة/); assert.equal(sb.calls.queries.filter(q => q.table === 'purchases').length, 0);
});

test('تكلفة الشحن: القائمة بتعرض إجمالي التكاليف، والتفاصيل بتعرض التكلفة الفعلية', async () => {
    const { run, text } = env('on');
    await run("renderLandedCost(document.getElementById('app-content'))");
    assert.match(text('#app-content'), /PUR-1/); assert.match(text('#app-content'), /30\.00/);
    await run("lcOpen('p1')");
    const t = text('#lcModal'); assert.match(t, /6\.00/); assert.match(t, /على حساب المورد/); assert.match(t, /تحديث سعر الشراء/);
});

test('إضافة تكلفة: بتتحقق من المبلغ وبتنادي fn_add_landed_cost بالمعاملات الصح', async () => {
    const { w, sb, run } = env('on'); w.confirm = () => true;
    await run("renderLandedCost(document.getElementById('app-content'))"); await run("lcOpen('p1')");
    run('lcOpenAdd()');
    await run('lcSave()');
    assert.equal(sb.calls.rpcs.filter(r => r[0] === 'fn_add_landed_cost').length, 0);
    w.document.getElementById('lcAmt').value = '25'; w.document.getElementById('lcKind').value = 'customs'; w.document.getElementById('lcMethod').value = 'qty';
    await run('lcSave()');
    assert.deepEqual(sb.calls.rpcs.find(r => r[0] === 'fn_add_landed_cost'),
        ['fn_add_landed_cost', { p_purchase_id: 'p1', p_kind: 'customs', p_amount: 25, p_method: 'qty', p_paid_via: 'treasury', p_treasury_id: 't1', p_notes: null }]);
});

test('إلغاء تكلفة وتحديث الأسعار بينادوا الدوال الصح', async () => {
    const { w, sb, run } = env('on'); w.confirm = () => true;
    await run("renderLandedCost(document.getElementById('app-content'))"); await run("lcOpen('p1')");
    await run("lcCancel('l1')"); await run('lcApplyPrices()');
    assert.ok(sb.calls.rpcs.some(r => r[0] === 'fn_cancel_landed_cost' && r[1].p_id === 'l1'));
    assert.ok(sb.calls.rpcs.some(r => r[0] === 'fn_landed_cost_apply_prices' && r[1].p_purchase_id === 'p1'));
});
