const test = require('node:test'); const assert = require('node:assert');
const { makeSb, makeEnv } = require('./helpers');

const sbFor = () => makeSb({ tables: {
    branches: [{ id: 'B1', name: 'فرع 1', is_main: true, is_active: true }, { id: 'B2', name: 'فرع 2', is_main: false, is_active: true }],
    warehouses: (q) => ({ data: q.ops.some(o => o[0] === 'eq' && o[1][1] === 'B2') ? [{ id: 'W2' }] : [{ id: 'W1' }], error: null }),
    treasuries: (q) => ({ data: q.ops.some(o => o[0] === 'eq' && o[1][1] === 'B2') ? [{ id: 'T2' }] : [{ id: 'T1' }], error: null }),
} });

test('brReportFilter: لا فرع مختار → null (كل الفروع)', async () => {
    const { w, run } = makeEnv({ files: ['js/modules/branches.js'], sb: sbFor() });
    assert.equal(await run('brReportFilter()'), null);
});

test('brReportFilter: الفرع الرئيسي بيشمل مستندات من غير مخزن ولا خزنة', async () => {
    const { w, run } = makeEnv({ files: ['js/modules/branches.js'], sb: sbFor() });
    w.localStorage.setItem('dash_branch', 'B1');
    const f = await run('brReportFilter()');
    assert.match(f.docOr, /warehouse_id\.in\.\(W1\)/);
    assert.match(f.docOr, /and\(warehouse_id\.is\.null,treasury_id\.in\.\(T1\)\)/);
    assert.match(f.docOr, /and\(warehouse_id\.is\.null,treasury_id\.is\.null\)/);
    assert.match(f.trOr, /treasury_id\.is\.null/);
});

test('brReportFilter: فرع غير رئيسي مايشملش المستندات الفاضية', async () => {
    const { w, run } = makeEnv({ files: ['js/modules/branches.js'], sb: sbFor() });
    w.localStorage.setItem('dash_branch', 'B2');
    const f = await run('brReportFilter()');
    assert.ok(!/is\.null,treasury_id\.is\.null/.test(f.docOr));
    assert.equal(f.isMain, false);
});

test('brApply: بيمرّر foreignTable للاستعلامات المتداخلة', async () => {
    const { w, run } = makeEnv({ files: ['js/modules/branches.js'], sb: sbFor() });
    const seen = [];
    const q = { or: (e, o) => { seen.push([e, o]); return q; } };
    const f = { docOr: 'D', trOr: 'T' };
    w.__q = q; w.__f = f;
    run("brApply(__q, __f, 'doc'); brApply(__q, __f, 'tr'); brApply(__q, __f, 'doc', 'sales'); brApply(__q, null, 'doc')");
    assert.deepEqual(seen[0], ['D', undefined]);
    assert.deepEqual(seen[1], ['T', undefined]);
    assert.deepEqual(seen[2], ['D', { foreignTable: 'sales', referencedTable: 'sales' }]);
    assert.equal(seen.length, 3);
});
