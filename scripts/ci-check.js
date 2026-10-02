#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════
   ci-check.js — فحوصات آلية للمشروع (بتشتغل في GitHub Actions وتقدر تشغّلها محلياً: node scripts/ci-check.js)
   مفيش أي مكتبات خارجية. بتفشل (exit 1) لو حصل أي من:
   1) ملف JS فيه خطأ كتابة (syntax)
   2) سكربت في index.html أو ملف في sw.js مش موجود فعلاً
   3) وجود مفتاح سري (service_role) أو سلسلة سر معروفة في أي ملف
   4) (لو فيه BASE_REF) ملف JS اتعدّل من غير ما نرفع ?v بتاعه في index.html، أو من غير ما نرفع SHELL_CACHE في sw.js
   ════════════════════════════════════════════════════════════ */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const errors = [];
const fail = (m) => errors.push(m);

// ── 1) syntax كل ملفات js ──
const jsFiles = [];
(function walk(dir) {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = path.posix.join(dir, e.name);
        if (e.isDirectory()) { if (!['node_modules', '.git', 'archive'].includes(e.name)) walk(rel); }
        else if (e.name.endsWith('.js')) jsFiles.push(rel);
    }
})('js');
jsFiles.push('sw.js');
for (const f of jsFiles) {
    try { new vm.Script(read(f), { filename: f }); }
    catch (e) { fail(`خطأ كتابة في ${f}: ${e.message}`); }
}

// ── 2) مراجع index.html و sw.js ──
const html = read('index.html');
const sw = read('sw.js');
const htmlRefs = [...html.matchAll(/<script[^>]*\bsrc="([^"?]+)(\?v=([^"]*))?"/g)].map(m => ({ file: m[1], v: m[3] || null }));
for (const r of htmlRefs) if (!r.file.startsWith('http') && !fs.existsSync(path.join(root, r.file))) fail(`index.html بيحمّل ملف مش موجود: ${r.file}`);
const swRefs = [...sw.matchAll(/'\.\/([^']+\.(?:js|css|html|json|png))'/g)].map(m => m[1]);
for (const f of swRefs) if (!fs.existsSync(path.join(root, f))) fail(`sw.js بيعدّد ملف مش موجود: ${f}`);

// ── 3) أسرار ──
const textExt = /\.(js|html|css|json|md|sql|txt|yml|yaml)$/i;
const scanFiles = [];
(function walk(dir) {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (['node_modules', '.git'].includes(e.name)) continue;
        const rel = dir ? path.posix.join(dir, e.name) : e.name;
        if (e.isDirectory()) walk(rel); else if (textExt.test(e.name)) scanFiles.push(rel);
    }
})('');
for (const f of scanFiles) {
    const t = read(f);
    for (const m of t.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g)) {
        try {
            const claims = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
            if (claims.role === 'service_role') fail(`مفتاح service_role ظاهر في ${f} — امسحه فوراً وغيّر المفتاح من Supabase`);
        } catch { /* مش JWT حقيقي */ }
    }
    if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(t)) fail(`مفتاح سري (sb_secret_) ظاهر في ${f}`);
    if (/postgres(ql)?:\/\/[^:\s/]+:[^@\s]{4,}@/.test(t)) fail(`رابط اتصال بالقاعدة بكلمة سر ظاهر في ${f}`);
}

// ── 4) قاعدة رفع النسخة (فقط لو BASE_REF متحدد) ──
const base = process.env.BASE_REF;
if (base) {
    let changed = [];
    try { changed = execSync(`git diff --name-only ${base}...HEAD`, { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean); }
    catch (e) { console.log(`(تعذّر مقارنة ${base} — تخطّيت فحص رفع النسخة)`); }
    const changedShell = changed.filter(f => /^js\/.*\.js$/.test(f) && htmlRefs.some(r => r.file === f));
    if (changedShell.length) {
        let oldHtml = '', oldSw = '';
        try { oldHtml = execSync(`git show ${base}:index.html`, { cwd: root, encoding: 'utf8' }); oldSw = execSync(`git show ${base}:sw.js`, { cwd: root, encoding: 'utf8' }); } catch { /* */ }
        const oldV = (f) => { const m = oldHtml.match(new RegExp(`src="${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\?v=([^"]*)"`)); return m ? m[1] : null; };
        for (const f of changedShell) {
            const now = htmlRefs.find(r => r.file === f).v;
            if (oldV(f) !== null && oldV(f) === now) fail(`${f} اتعدّل بس ?v في index.html لسه زي ما هو (${now}) — ارفعه عشان الأجهزة تاخد التحديث`);
        }
        const cacheOf = (s) => (s.match(/SHELL_CACHE\s*=\s*'([^']+)'/) || [])[1];
        if (oldSw && cacheOf(oldSw) === cacheOf(sw)) fail(`ملفات JS اتعدّلت لكن SHELL_CACHE في sw.js لسه ${cacheOf(sw)} — ارفعه`);
    }
}

if (errors.length) {
    console.error('❌ فشلت الفحوصات:\n' + errors.map(e => ' - ' + e).join('\n'));
    process.exit(1);
}
console.log(`✅ كل الفحوصات نجحت (${jsFiles.length} ملف JS، ${htmlRefs.length} سكربت في index.html، ${swRefs.length} ملف في sw.js)`);
