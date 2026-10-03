const test = require('node:test'); const assert = require('node:assert');
const { makeSb, makeEnv } = require('./helpers');

const rowsSb = (rows, onUpsert) => makeSb({ tables: { app_settings: (q) => {
    const up = q.ops.find(o => o[0] === 'upsert');
    if (up) { onUpsert && onUpsert(up[1][0]); return { data: null, error: null }; }
    return { data: rows, error: null };
} } });

test('الهوية: القيم الافتراضية (سلطان) لو مفيش إعدادات ولا كاش', async () => {
    const { run } = makeEnv({ files: ['js/brand.js'], sb: rowsSb([]) });
    assert.equal(run('BRAND.erp'), 'Sultan ERP'); assert.equal(run('BRAND.short'), 'سلطان'); assert.equal(run('BRAND.customerApp'), 'سلطانو');
});

test('الهوية: brandLoad بيقرا الإعدادات (حتى المشفّرة بعلامات تنصيص) ويحدّث العناصر ويحفظ كاش', async () => {
    const rows = [{ key: 'brand_erp_name', value: '"النور ERP"' }, { key: 'brand_short_ar', value: 'النور' }, { key: 'brand_name_ar', value: '' }];
    const { w, run, tick } = makeEnv({ files: ['js/brand.js'], sb: rowsSb(rows), html: '<h1 data-brand="erp">x</h1><span data-brand-prefix="مندوب " data-brand2="short">y</span>' });
    await run('brandLoad()');
    assert.equal(run('BRAND.erp'), 'النور ERP'); assert.equal(run('BRAND.short'), 'النور');
    assert.equal(run('BRAND.ar'), 'سلطان للمواد الغذائية', 'القيمة الفاضية ما بتمسحش الافتراضي');
    assert.equal(w.document.querySelector('h1').textContent, 'النور ERP');
    assert.equal(w.document.querySelector('span').textContent, 'مندوب النور');
    assert.equal(JSON.parse(w.localStorage.getItem('brand_cache_v1')).short, 'النور');
});

test('الهوية: الكاش بيظهر من أول تحميل (قبل أي نداء للقاعدة)', async () => {
    // أول بيئة بتحفظ الكاش، والتانية بتقراه عند تحميل brand.js
    const { JSDOM } = require('jsdom'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
    const dom = new JSDOM('<body></body>', { runScripts: 'outside-only', url: 'http://localhost/' });
    dom.window.localStorage.setItem('brand_cache_v1', JSON.stringify({ erp: 'كاش ERP', short: 'كاش' }));
    new vm.Script(fs.readFileSync(path.join(__dirname, '..', 'js/brand.js'), 'utf8')).runInContext(dom.getInternalVMContext());
    assert.equal(dom.window.BRAND.erp, 'كاش ERP'); assert.equal(dom.window.BRAND.short, 'كاش'); assert.equal(dom.window.BRAND.ar, 'سلطان للمواد الغذائية');
});

test('الهوية: الحفظ بيكتب الـ5 إعدادات', async () => {
    const saved = [];
    const sb = makeSb({ tables: { app_settings: (q) => { const up = q.ops.find(o => o[0] === 'upsert'); if (up) { saved.push(...up[1][0]); return { data: null, error: null }; } return { data: [], error: null }; } } });
    const { w, run } = makeEnv({ files: ['js/brand.js'], sb });
    run("brandRenderCard(document.getElementById('app-content'))");
    w.document.getElementById('brand-short').value = 'الشركة';
    await run('brandSave()');
    assert.equal(saved.length, 5);
    assert.equal(saved.find(r => r.key === 'brand_short_ar').value, 'الشركة');
    assert.ok(saved.every(r => r.value && r.key.startsWith('brand_')));
});

test('اسم تطبيق العملاء: بيتبدّل في النصوص والخصائص و alert/confirm، ولا يمس الاسم الأصلي', async () => {
    const SRC = 'سلطانو';
    const { JSDOM } = require('jsdom'); const fs = require('fs'); const path = require('path'); const vm = require('vm');
    const mk = (cache) => {
        const dom = new JSDOM(`<body><div id="a"><button title="زرار ${SRC}">📦 طلبات ${SRC}</button><input placeholder="بحث في ${SRC}"><p>🔑 رقم سري ل${SRC}</p></div></body>`, { runScripts: 'outside-only', url: 'http://localhost/' });
        if (cache) dom.window.localStorage.setItem('brand_cache_v1', JSON.stringify(cache));
        const alerts = []; dom.window.alert = (m) => alerts.push(m);
        new vm.Script(fs.readFileSync(path.join(__dirname, '..', 'js/brand.js'), 'utf8')).runInContext(dom.getInternalVMContext());
        return { w: dom.window, alerts };
    };
    // اسم مختلف
    const { w, alerts } = mk({ customerApp: 'النور أونلاين' });
    await new Promise(r => setTimeout(r, 60));
    assert.equal(w.document.querySelector('button').textContent, '📦 طلبات النور أونلاين');
    assert.equal(w.document.querySelector('button').getAttribute('title'), 'زرار النور أونلاين');
    assert.equal(w.document.querySelector('input').getAttribute('placeholder'), 'بحث في النور أونلاين');
    assert.equal(w.document.querySelector('p').textContent, '🔑 رقم سري للنور أونلاين'.replace('للنور', 'للنور'));
    // عناصر بتتضاف بعدين
    const el = w.document.createElement('span'); el.textContent = 'مفيش طلبات ' + SRC; w.document.body.appendChild(el);
    await new Promise(r => setTimeout(r, 60));
    assert.equal(el.textContent, 'مفيش طلبات النور أونلاين');
    w.alert('تأكيد ' + SRC); assert.equal(alerts[0], 'تأكيد النور أونلاين');
    // الاسم الأصلي: مفيش تغيير
    const o = mk(null);
    await new Promise(r => setTimeout(r, 30));
    assert.equal(o.w.document.querySelector('button').textContent, '📦 طلبات ' + SRC);
    o.w.alert('x ' + SRC); assert.equal(o.alerts[0], 'x ' + SRC);
});
