const test = require('node:test'); const assert = require('node:assert');
const { makeSb, makeEnv } = require('./helpers');

test('واتساب: تنسيق الرقم المصري وملء القالب ورابط التذكير', async () => {
    const sb = makeSb({ tables: {
        app_settings: { data: { value: null }, error: null },
        customers: [
            { id: '1', name: 'أحمد', phone: '01012345678', balance: 500, payment_due_date: '2026-09-01' },
            { id: '2', name: 'سمير', phone: '', balance: 90, payment_due_date: null },
        ],
    } });
    const { w, run } = makeEnv({ files: ['js/modules/whatsapp.js'], sb });
    assert.equal(run("waPhone('01012345678')"), '201012345678');
    assert.equal(run("waPhone('+201012345678')"), '201012345678');
    assert.equal(run("waPhone('0020 101 234 5678')"), '201012345678');
    assert.equal(run("waPhone('')"), '');
    assert.equal(run("waFill('هلا {name} {x}', {name:'علي'})"), 'هلا علي ');
    await run("renderWhatsAppIntegration(document.getElementById('app-content'))");
    const href = decodeURIComponent(w.document.querySelector('a.cc-edit').href);
    assert.match(href, /^https:\/\/wa\.me\/201012345678\?text=/); assert.match(href, /500\.00/);
    assert.equal(w.document.querySelectorAll('tbody tr').length, 1, 'المتأخرين بس (اللي عنده تاريخ استحقاق فات)');
});

test('إعدادات سلطانو: بتحفظ مستوى السعر الافتراضي (قبل ما الصفحة تتبدّل بـ"جارٍ الحفظ")', async () => {
    const calls = [];
    const sb = makeSb({ tables: {
        app_settings: (q) => {
            const up = q.ops.find(o => o[0] === 'upsert'); const upd = q.ops.find(o => o[0] === 'update');
            if (up) { calls.push(['upsert', up[1][0].key, up[1][0].value]); return { data: null, error: null }; }
            if (upd) { calls.push(['update', upd[1][0].value]); return { data: null, error: null }; }
            return { data: [{ key: 'category_display_mode', value: 'sub' }, { key: 'sultanoo_default_price_level', value: 'RETAIL' }], error: null };
        },
        price_levels: [{ code: 'SPECIAL', name: 'مميز' }, { code: 'RETAIL', name: 'قطاعي' }],
    } });
    const { w, run } = makeEnv({ files: ['js/modules/sultanoo-settings.js'], sb, globals: { sultanooToast() {} } });
    await run("renderSultanooSettings(document.getElementById('app-content'))");
    const sel = w.document.getElementById('sultanooDefaultLevel');
    assert.equal(sel.value, 'RETAIL');
    sel.value = 'SPECIAL'; await run('sultanooSaveSettings()');
    assert.deepEqual(calls[0], ['upsert', 'sultanoo_default_price_level', 'SPECIAL']);
    assert.equal(calls.filter(c => c[0] === 'update').length, 3);
});

test('فتح ملف الأرشيف: رابط مؤقت من مسار الملف', async () => {
    const sb = makeSb();
    const { w, run } = makeEnv({ files: ['js/modules/archive.js'], sb });
    const opened = []; const fake = { location: { href: '' }, close() { opened.push('closed'); } };
    w.open = (u) => { opened.push(u); return fake; };
    await run("arcOpenFile('123_a.png', '')");
    assert.equal(fake.location.href, 'signed://123_a.png');
    assert.equal(opened[0], 'about:blank');
});
