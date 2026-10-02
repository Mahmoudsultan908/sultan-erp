const test = require('node:test'); const assert = require('node:assert');
const { makeSb, makeEnv } = require('./helpers');

const FILES = ['js/modules/features.js', 'js/modules/cheques.js'];
const settingOn = (v) => ({ app_settings: [{ key: 'feature_cheques', value: v }] });

test('ftOn: بيفهم on/true/1 حتى لو متشفّرة JSON، والباقي مقفول', async () => {
    for (const [v, exp] of [['on', true], ['"on"', true], ['true', true], ['1', true], ['off', false], ['', false], [null, false]]) {
        const { run } = makeEnv({ files: FILES, sb: makeSb({ tables: { app_settings: { data: { value: v }, error: null } } }) });
        assert.equal(await run("ftOn('feature_cheques')"), exp, `value=${v}`);
    }
});

test('شاشة الشيكات: مقفولة لو الميزة off', async () => {
    const sb = makeSb({ tables: { app_settings: { data: { value: 'off' }, error: null } } });
    const { w, run, text } = makeEnv({ files: FILES, sb });
    await run("renderCheques(document.getElementById('app-content'))");
    assert.match(text('#app-content'), /مقفولة/);
    assert.equal(sb.calls.queries.filter(q => q.table === 'cheques').length, 0, 'مايحمّلش الشيكات وهي مقفولة');
});

function chequeEnv() {
    const sb = makeSb({
        tables: {
            app_settings: { data: { value: 'on' }, error: null },
            cheques: [
                { id: '1', direction: 'received', cheque_no: '111', bank_name: 'NBE', amount: 300, due_date: '2020-01-01', status: 'pending', customers: { name: 'عميل' }, suppliers: null, treasuries: null },
                { id: '2', direction: 'issued', cheque_no: '222', amount: 200, due_date: '2099-01-01', status: 'pending', customers: null, suppliers: { name: 'مورد' }, treasuries: null },
            ],
            customers: [{ id: 'c', name: 'عميل' }], suppliers: [{ id: 's', name: 'مورد' }],
            treasuries: [{ id: 't1', name: 'نقدي', kind: 'cash' }, { id: 't2', name: 'بنك مصر', kind: 'bank' }],
        },
    });
    return { sb, ...makeEnv({ files: FILES, sb }) };
}

test('شاشة الشيكات: بتعرض الأرقام والمتأخر', async () => {
    const { run, text } = chequeEnv();
    await run("renderCheques(document.getElementById('app-content'))");
    const t = text('#app-content');
    assert.match(t, /300\.00/); assert.match(t, /200\.00/);
    assert.match(t, /متأخر/);
});

test('تحصيل شيك: البنوك أول القائمة وبينادي fn_cheque_clear بالخزنة المختارة', async () => {
    const { w, sb, run } = chequeEnv();
    await run("renderCheques(document.getElementById('app-content'))");
    run("chqOpenClear('1')");
    const opts = [...w.document.querySelectorAll('#chqTr option')].map(o => o.textContent);
    assert.match(opts[0], /بنك مصر/);
    w.document.getElementById('chqTr').value = 't2';
    await run("chqDoClear('1')");
    assert.deepEqual(sb.calls.rpcs.find(r => r[0] === 'fn_cheque_clear'), ['fn_cheque_clear', { p_id: '1', p_treasury_id: 't2' }]);
});

test('ارتداد وإلغاء بينادوا الدوال الصح', async () => {
    const { w, sb, run } = chequeEnv();
    w.prompt = () => 'رصيد غير كاف';
    await run("renderCheques(document.getElementById('app-content'))");
    await run("chqBounce('1')"); await run("chqCancel('2')");
    assert.ok(sb.calls.rpcs.some(r => r[0] === 'fn_cheque_bounce' && r[1].p_id === '1' && r[1].p_reason === 'رصيد غير كاف'));
    assert.ok(sb.calls.rpcs.some(r => r[0] === 'fn_cheque_cancel' && r[1].p_id === '2'));
});

test('كارت المميزات: التفعيل بيحفظ on/off وبيرجّع الصندوق لو فشل الحفظ', async () => {
    let fail = false; const saved = [];
    const sb = makeSb({ tables: { app_settings: (q) => { const up = q.ops.find(o => o[0] === 'upsert'); if (up) { saved.push(up[1][0]); return { data: null, error: fail ? { message: 'x' } : null }; } return { data: [], error: null }; }, customers: { count: 0, data: [], error: null } } });
    const { w, run, tick } = makeEnv({ files: FILES, sb, globals: { _currentUserRole: 'admin' } });
    await run("ftRenderCard(document.getElementById('app-content'))"); await tick();
    const box = w.document.querySelector('input[type=checkbox]');
    box.checked = true; await run("ftToggle('feature_expiry', document.querySelector('input[type=checkbox]'))");
    assert.equal(saved[0].key, 'feature_expiry'); assert.equal(saved[0].value, 'on');
    fail = true; box.checked = false; await run("ftToggle('feature_expiry', document.querySelector('input[type=checkbox]'))");
    assert.equal(box.checked, true, 'بيرجّع الحالة القديمة عند الفشل'); assert.ok(w.alerts.length >= 1);
});
