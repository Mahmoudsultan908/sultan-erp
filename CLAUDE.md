# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Sultan ERP — a single-page ERP/accounting web app (Arabic, RTL) for a wholesale food company: sales, purchases, inventory, customers/suppliers, accounting (chart of accounts, journal, trial balance, balance sheet), expenses, returns, and reporting. Installable as a PWA.

Backend is entirely Supabase (Postgres + Auth + RLS). There is no application server and no API layer of its own — the browser talks to Supabase directly.

## Running / testing

There is no build tooling, no `package.json`, no bundler, no test suite, and no linter. This is plain HTML/CSS/JS served as static files.

- To run it, serve the directory root with any static file server and open `index.html` (or just open `index.html` directly in a browser). Login requires a valid Supabase user (auth is `sb.auth.signInWithPassword`).
- There is no automated way to verify changes — check correctness by opening the relevant module in a browser and exercising it manually.
- `sw.js` is a service worker registered by `js/app.js` purely so the app is installable as a PWA. It intentionally does **not** cache anything (fetches always hit network) because the app is 100% live Supabase data.

## Architecture

### Script loading is the whole module system

There's no bundler and no `import`/`export`. Every module is a plain `<script src="js/modules/*.js">` tag loaded in sequence in `index.html`, followed by `js/app.js` last (except `users-management.js`, loaded after `app.js`). Order is called out in `index.html` with the comment "الترتيب ده أهم سطر في الصفحة" (this order is the most important line on the page) — modules are expected to define globals independently, so in practice order rarely matters, but keep new `<script>` tags grouped with related modules and add them before `js/app.js`.

Top-level `function` declarations in these scripts become implicit globals (`window.fnName`). Functions created *inside* another function (closures, e.g. filter/refresh callbacks built at render time) are **not** implicit globals and must be explicitly assigned, e.g. `window.accApplyTbFilter = () => {...}`, so that inline `onclick="..."` HTML attributes can find them. Follow this pattern for any new callback wired up via inline `onclick`/`oninput`/etc.

### Router: `js/app.js`

`js/app.js` owns login/logout, the sidebar/layout shell (`buildLayout()`), and a single router `window.loadMod(el, modName)`. It:
1. Looks up a display title for `modName` in a hardcoded `titles` object.
2. Runs a long list of `if (modName === 'x' && typeof renderX === 'function') await renderX(c)` checks against `#app-content`.

**To add a new module/page**, you must touch three places:
1. Add a `<script src="js/modules/your-module.js">` tag in `index.html` (before `js/app.js`).
2. Add a `<div class="nav-item" data-mod="your-mod" onclick="loadMod(this, 'your-mod')">` entry in the sidebar markup in `buildLayout()` in `js/app.js`.
3. Add a title entry and an `if (modName === 'your-mod' && typeof renderYourModule === 'function') await renderYourModule(c);` line in `loadMod()` in `js/app.js`.

Modules under the "🔜 قريباً" (coming soon) nav group are stubbed out in `js/modules/coming-soon.js`, which just renders a placeholder — real implementations replace those `renderX` functions when built out.

### Module contract

Every module in `js/modules/` exports one or more `async function renderX(container)` entry points that fully own rendering into the passed container element (usually `#app-content`, but modals render into `document.body`). Within a render function the pattern is consistently:
```js
async function renderX(c) {
    c.innerHTML = '<div class="empty-state"><span>⏳</span>جاري تحميل...</div>';
    try {
        const { data } = await sb.from('table').select('*')...;
        c.innerHTML = `...template literal markup using inline styles + shared mod-*/dash-* classes...`;
    } catch (err) {
        c.innerHTML = `<div style="background:#FEF2F2;color:#991B1B;padding:20px;border-radius:12px">خطأ: ${err.message}</div>`;
    }
}
```
Multi-query loads use `Promise.all([...])` for parallel Supabase fetches. Modals are plain `document.createElement('div')` with `.mod-modal-bg.active`, appended to `document.body`, and removed by their own close handler — there's no modal manager.

Each module uses a short lowercase prefix for its private globals/functions to avoid collisions across the ~30 files sharing one global scope (e.g. `inv*` in `sales.js`, `acc*` in `accounting.js`, `cust*`/`_mgCust*` in `customers.js`/`master-data.js`, `md*` in `master-data.js`, `ob*` in `opening-balances.js`, `csi*` in `customer-supplier-import.js`). Follow this convention for any new module rather than generic names, since there is no namespacing or bundler to prevent collisions.

Functions called from inline HTML (`onclick`, `oninput`, etc.) are attached with `window.fnName = ...` (or `Object.assign(window, {...})` at the bottom of the file, see `accounting.js`) even when they'd already be implicit globals, since this is the file's public surface used by generated markup.

### Data layer: Supabase

`js/supabase.js` creates a single global `sb` client (`SUPABASE_URL`/`SUPABASE_KEY` are hardcoded — the key is the public/anon key, protection is via RLS policies, not secrecy). All modules call `sb.from(...)`, `sb.rpc(...)`, `sb.auth...` directly — there is no repository/service abstraction layer.

**Financial correctness lives in Postgres, not in JS.** Stock quantities, customer/supplier balances, and journal entries are updated by database triggers (`SECURITY DEFINER` functions), not by application code — see `returns_migration.sql` for the pattern (`fn_sale_return_item_stock`, `fn_sales_return_balance`, etc.) and the comment header of `js/modules/accounting.js`: the journal/ledger views are **read-only by design**; the app must never write `journal_entries`/`journal_entry_lines` directly. When adding a feature that affects stock, balances, or the ledger, the trigger/RPC lives in Supabase (not checked into this repo except `returns_migration.sql`), and the JS side should only insert the "root" row (e.g. an invoice or a payment) and let triggers cascade the rest. Only `returns_migration.sql` is version-controlled here; treat the live Supabase schema as authoritative and out-of-repo — check with the user before assuming a table/column/trigger exists or is missing.

### Styling

RTL Arabic UI (`dir="rtl" lang="ar"`, Cairo font). Two style sources:
- Inline `<style>` block in `index.html`: base layout (sidebar/topbar/login), the shared `.mod-*` component classes (cards, tables, modals, buttons) used by most modules, and the two-column sales/purchase invoice UI (`.inv-*` classes, navy/gold theme).
- `css/claude-modules.css`: a second shared class set (`.dash-*`) used by dashboard/inventory/opening-balances/reports/settings.

Most per-row/per-value styling is done with inline `style="..."` on generated elements rather than new CSS classes — this is the established convention, not an oversight. Reuse existing `.mod-*`/`.dash-*`/`.inv-*` classes before adding new global CSS.

### Number/date formatting

Every module defines its own tiny formatter rather than sharing one, e.g. `custFmt`, `accFmt`, `mdFmt` — all `(Number(n)||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`. Match this pattern (`<prefix>Fmt`) in new modules instead of introducing a shared util.
