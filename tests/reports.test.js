const test = require('node:test'); const assert = require('node:assert');
const { makeSb, makeEnv } = require('./helpers');

test('تبويب الصلاحية: بيعرض المنتهي والقريب ويستدعي fn_expiry_report بالأيام والفرع', async () => {
    const rows = [
        { product_name: 'لبن', product_code: 'L1', warehouse_name: 'الرئيسي', batch_no: 'A1', expiry_date: '2026-09-20', days_left: -12, qty_remaining: 24, value_at_cost: 120 },
        { product_name: 'جبن', product_code: 'C1', warehouse_name: 'الرئيسي', batch_no: null, expiry_date: '2026-10-20', days_left: 18, qty_remaining: 10, value_at_cost: 50 },
    ];
    const sb = makeSb({ tables: { app_settings: { data: { value: 'on' }, error: null }, warehouses: [], products: [], inventory_stock: [] }, rpc: { fn_expiry_report: rows } });
    const { w, run, text, tick } = makeEnv({ files: ['js/modules/branches.js', 'js/modules/warehouse-reports.js'], sb });
    await run("renderWarehouseReports(document.getElementById('app-content'))");
    run("wrSwitchTab('expiry')"); await tick(50);
    const t = text('#wr-body');
    assert.match(t, /منتهي من 12/); assert.match(t, /170\.00/);
    assert.deepEqual(sb.calls.rpcs[0], ['fn_expiry_report', { p_days: 60, p_branch: null }]);
});

test('تقييم الموردين: النسب والتقدير (🟢 < 2%، 🔴 ≥ 5%)', async () => {
    const sb = makeSb({ tables: {
        purchases: [{ supplier_id: 's1', total: 1000 }, { supplier_id: 's1', total: 500 }, { supplier_id: 's2', total: 200 }],
        purchase_returns: [{ supplier_id: 's1', total: 20 }, { supplier_id: 's2', total: 30 }],
    } });
    const { run, text, tick } = makeEnv({ files: ['js/modules/branches.js', 'js/modules/performance-reports.js'], sb, html: '<div id="app-content"><div id="prf-body"></div></div>' });
    run("_perfSuppliers = [{id:'s1',name:'مورد 1'},{id:'s2',name:'مورد 2'}]; prfRenderSuppliersForm()");
    await tick(60);
    const t = text('#prf-result');
    assert.match(t, /مورد 1.*88\.2%.*1\.3%.*🟢/); assert.match(t, /مورد 2.*11\.8%.*15\.0%.*🔴/);
});

test('الميزانيات: الفعلي والنسب، والحفظ تحديث/إضافة/حذف بدون مسح جماعي', async () => {
    const ops = [];
    const sb = makeSb({
        tables: {
            app_settings: { data: { value: 'on' }, error: null },
            expense_categories: [{ id: 'k1', name: 'إيجار' }, { id: 'k2', name: 'كهرباء' }],
            budgets: (q) => {
                const o = q.ops.find(x => ['upsert', 'insert', 'delete'].includes(x[0]));
                if (o) { ops.push([o[0], o[1][0]]); return { data: null, error: null }; }
                return { data: [{ id: 'b1', kind: 'sales', category_id: null, amount: 1000 }, { id: 'b2', kind: 'expense', category_id: 'k1', amount: 100 }], error: null };
            },
            expenses: [{ category_id: 'k1', amount: 90 }, { category_id: 'k2', amount: 30 }],
        },
        rpc: { fn_report_totals: { sales: 900, returns: 100 } },
    });
    const { w, run, text } = makeEnv({ files: ['js/modules/branches.js', 'js/modules/features.js', 'js/modules/budgets.js'], sb });
    await run("renderBudgets(document.getElementById('app-content'))");
    const t = text('#app-content');
    assert.match(t, /800\.00/); assert.match(t, /10\.00 متبقي/); assert.match(t, /لا توجد ميزانية/);
    w.document.getElementById('bgCat1').value = '50'; w.document.getElementById('bgCat0').value = '';
    await run('bgSave()');
    assert.deepEqual(ops.map(o => o[0]), ['upsert', 'insert', 'delete']);
    assert.equal(ops[0][1][0].id, 'b1'); assert.equal(ops[1][1][0].category_id, 'k2');
});
