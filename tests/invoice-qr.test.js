const test = require('node:test'); const assert = require('node:assert');
const { makeSb, makeEnv } = require('./helpers');

const FILES = ['js/modules/features.js', 'js/modules/thermal-print.js'];
const fakeQr = () => ({ addData(t) { this.t = t; }, make() {}, createDataURL() { return 'data:image/gif;base64,QR:' + encodeURIComponent(this.t).slice(0, 20); } });

function envFor(flag, withLib = true) {
    const sb = makeSb({ tables: { app_settings: (q) => ({ data: q.ops.some(o => JSON.stringify(o).includes('feature_invoice_qr')) ? { value: flag } : [{ key: 'company_name', value: 'شركة' }], error: null }) } });
    const e = makeEnv({ files: FILES, sb, globals: withLib ? { qrcode: fakeQr } : {} });
    let html = '';
    e.w.open = () => ({ document: { write: (h) => { html = h; }, close() {}, images: [] }, focus() {}, requestAnimationFrame() {}, print() {}, resizeTo() {} });
    return { ...e, getHtml: () => html };
}
const payload = { invoiceNo: 'INV-0009', customerName: 'عميل', paymentType: 'cash', items: [{ name: 'صنف', qty: 1, unit_price: 5, line_total: 5 }], subtotal: 5, discount: 0, total: 5, previousBalance: 0, paidAmount: 5 };

test('QR: الإيصال فيه صورة QR لما الميزة on', async () => {
    const { run, getHtml, w } = envFor('on');
    w.__p = payload;
    await run("printThermalReceipt('sale', __p)");
    assert.match(getHtml(), /alt="QR"/);
});

test('QR: مفيش QR لما الميزة off', async () => {
    const { run, getHtml, w } = envFor('off');
    w.__p = payload;
    await run("printThermalReceipt('sale', __p)");
    assert.doesNotMatch(getHtml(), /alt="QR"/);
    assert.match(getHtml(), /INV-0009/);
});

test('QR: لو المكتبة مش متحمّلة الطباعة بتكمل من غير QR', async () => {
    const { run, getHtml, w } = envFor('on', false);
    w.__p = payload;
    await run("printThermalReceipt('sale', __p)");
    assert.match(getHtml(), /INV-0009/); assert.doesNotMatch(getHtml(), /alt="QR"/);
});
