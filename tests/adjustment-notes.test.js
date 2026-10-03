const test = require('node:test'); const assert = require('node:assert');
const { makeSb, makeEnv } = require('./helpers');

const FILES = ['js/modules/features.js', 'js/modules/adjustment-notes.js'];

function notesEnv(flag = 'on') {
    const sb = makeSb({
        tables: {
            app_settings: { data: { value: flag }, error: null },
            adjustment_notes: [
                { id: 'n1', note_no: 'CN-0001', kind: 'customer_credit', amount: 100, reason: 'تصحيح سعر', ref_doc: 'INV-1', status: 'confirmed', created_at: '2026-10-03T10:00:00Z', customers: { name: 'عميل' }, suppliers: null },
                { id: 'n2', note_no: 'SDN-0002', kind: 'supplier_debit', amount: 30, reason: 'فرق سعر', ref_doc: null, status: 'cancelled', created_at: '2026-10-03T11:00:00Z', customers: null, suppliers: { name: 'مورد' } },
            ],
            customers: [{ id: 'c1', name: 'عميل' }], suppliers: [{ id: 's1', name: 'مورد' }],
        },
    });
    return { sb, ...makeEnv({ files: FILES, sb }) };
}

test('شاشة الإشعارات: مقفولة لو الميزة off ومبتحمّلش الجدول', async () => {
    const { sb, run, text } = notesEnv('off');
    await run("renderAdjustmentNotes(document.getElementById('app-content'))");
    assert.match(text('#app-content'), /مقفولة/);
    assert.equal(sb.calls.queries.filter(q => q.table === 'adjustment_notes').length, 0);
});

test('شاشة الإشعارات: بتعرض السارية بس افتراضياً والملغية بالفلتر', async () => {
    const { run, text } = notesEnv();
    await run("renderAdjustmentNotes(document.getElementById('app-content'))");
    assert.match(text('#app-content'), /CN-0001/); assert.doesNotMatch(text('#app-content'), /SDN-0002/);
    await run("adnSetFilter('all')");
    assert.match(text('#app-content'), /SDN-0002/);
});

test('إشعار جديد: بيتحقق من المدخلات وبينادي fn_create_adjustment_note', async () => {
    const { w, sb, run } = notesEnv();
    w.confirm = () => true;
    await run("renderAdjustmentNotes(document.getElementById('app-content'))");
    run('adnOpenAdd()');
    await run('adnSave()');                       // مبلغ فاضي
    assert.equal(sb.calls.rpcs.filter(r => r[0] === 'fn_create_adjustment_note').length, 0);
    w.document.getElementById('adnKind').value = 'supplier_credit'; run('adnKindChanged()');
    w.document.getElementById('adnParty').value = 's1';
    w.document.getElementById('adnAmt').value = '80';
    w.document.getElementById('adnReason').value = 'خصم كمية';
    await run('adnSave()');
    assert.deepEqual(sb.calls.rpcs.find(r => r[0] === 'fn_create_adjustment_note'),
        ['fn_create_adjustment_note', { p_kind: 'supplier_credit', p_party_id: 's1', p_amount: 80, p_reason: 'خصم كمية', p_ref_doc: null }]);
});

test('إلغاء إشعار: بينادي fn_cancel_adjustment_note', async () => {
    const { w, sb, run } = notesEnv();
    w.confirm = () => true;
    await run("renderAdjustmentNotes(document.getElementById('app-content'))");
    await run("adnCancel('n1')");
    assert.deepEqual(sb.calls.rpcs.find(r => r[0] === 'fn_cancel_adjustment_note'), ['fn_cancel_adjustment_note', { p_id: 'n1' }]);
});

test('الإشعارات مسجّلة في كارت المميزات', async () => {
    const { run } = notesEnv();
    assert.equal(await run("FT_LIST.some(f => f.key === 'feature_notes')"), true);
});
