// أدوات مشتركة للاختبارات: بيئة متصفح وهمية (jsdom) + عميل Supabase وهمي بيسجّل كل النداءات
const { JSDOM } = require('jsdom');
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

// sb وهمي: tables = { اسم_الجدول: مصفوفة | function(query) => {data,error} }، rpc = { اسم: function(args) => {data,error} }
function makeSb({ tables = {}, rpc = {} } = {}) {
    const calls = { queries: [], rpcs: [] };
    const make = (table) => {
        const q = { table, ops: [], single: false };
        calls.queries.push(q);
        const proxy = new Proxy({}, {
            get(_, name) {
                if (name === 'then') {
                    return (res, rej) => {
                        let r = tables[table];
                        if (typeof r === 'function') r = r(q);
                        if (r && !Array.isArray(r) && ('data' in r || 'error' in r || 'count' in r)) { /* جاهز */ }
                        else r = { data: r ?? [], error: null };
                        if (q.single && Array.isArray(r.data)) r = { ...r, data: r.data[0] ?? null };
                        return Promise.resolve(r).then(res, rej);
                    };
                }
                return (...args) => { q.ops.push([name, args]); if (name === 'maybeSingle' || name === 'single') q.single = true; return proxy; };
            },
        });
        return proxy;
    };
    return {
        calls,
        from: make,
        rpc: async (name, args) => {
            calls.rpcs.push([name, args]);
            const f = rpc[name];
            const r = typeof f === 'function' ? f(args) : f;
            return r && ('data' in r || 'error' in r) ? r : { data: r ?? null, error: null };
        },
        storage: { from: () => ({ createSignedUrl: async (p) => ({ data: { signedUrl: 'signed://' + p }, error: null }) }) },
    };
}

// بيئة جديدة: files = مسارات ملفات الموديولات (نسبةً لجذر المشروع) بتتحمّل كسكربتات عادية بالترتيب
function makeEnv({ files = [], sb, html = '<div id="app-content"></div>', globals = {} } = {}) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { runScripts: 'outside-only', url: 'http://localhost/' });
    const w = dom.window;
    const ctx = dom.getInternalVMContext();
    w.sb = sb;
    w.alerts = [];
    w.alert = (m) => w.alerts.push(String(m));
    w.confirm = () => true;
    w.prompt = () => '';
    w.localStorage.clear();
    Object.assign(w, globals);
    for (const f of files) new vm.Script(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f }).runInContext(ctx);
    const run = (code) => new vm.Script(code).runInContext(ctx);
    const text = (sel) => (w.document.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
    const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
    return { w, run, text, tick, dom };
}

module.exports = { makeSb, makeEnv };
