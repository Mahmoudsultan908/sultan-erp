# Sultan ERP - Initial Read-Only Audit Memo

**Audit date:** 2026-08-25
**Scope:** live Supabase data, with the operational review starting after the corrected closing point on 1 August 2026, plus the two connected client applications.
**Safety:** no INSERT, UPDATE, DELETE, migration, or code fix was executed during this review.

## 1. Confirmed answer about the 95,500 figure

There is no journal line with an amount of exactly `95,500.00`, and there are no July capital-partner transactions for that amount.

The amount `95,500.00` is the current `capital_balance` of the owner record:

- Partner: محمود سلطان (`owner`)
- Partner row created: `2026-07-31 17:26:40.947389+00`
- Capital balance: `95,500.00`
- Current cumulative deficit: `95,029.95`

Therefore, `95,500.00` must not be treated as the loss entry without another source document.  It is recorded as owner capital in the partner profile.

## 2. Exact July closing and correction timeline

| Entry ref | Accounting date | Created at | Debit/Credit | Meaning |
|---|---:|---:|---|---|
| `ADJ-CAPITAL-2026-07-31` | 2026-07-01 | 2026-07-31 17:26:26 | 2001 Dr 110,500; 3003 Cr 60,500; 3004 Cr 50,000 | Reclassified owner/investor capital from suppliers to equity. |
| `ADJ-OWNER-DEBT-JUL2026` | **2026-07-31** | 2026-08-01 10:24:21 | 1002 Dr 45,060.25; 3002 Cr 45,060.25 | July deficit posted as receivable from the owner. |
| `ADJ-SUPP-OWNERPAID-2026-08-01` | 2026-08-01 | 2026-08-01 11:11:34 | 1002 Cr 1,110.00 | Owner paid supplier balances personally. |
| `ADJ-OWNER-DEBT-LIFETIME-2026-08-01` | 2026-08-01 | 2026-08-01 11:15:47 | 1002 Dr 61,429.44; 3002 Cr 61,429.44 | April-June cumulative deficit before investor entry. |
| `REV-ADJ-OWNER-DEBT-WRONG-METHOD` | 2026-08-01 | 2026-08-01 12:25:28 | 1002 Cr 106,429.69; 3002 Dr 106,429.69 | Reversed the first calculation method because DEXEF transfer dates made the journal accumulation unreliable. |
| `REV-ADJ-OWNER-DEBT-WRONG-METHOD-FIX` | 2026-08-01 | 2026-08-01 12:27:51 | 1002 Cr 60.00 | Corrected a 60.00 data-entry difference in the reversal. |
| `ADJ-OWNER-DEBT-CORRECTED-2026-08-01` | 2026-08-01 | 2026-08-01 12:30:03 | 1002 Dr 96,139.95; 3002 Cr 96,139.95 | Reposted the owner deficit from current real assets/liabilities, not journal accumulation. |
| `SYNC-OWNER-DEFICIT-...` | 2026-08-01 | 2026-08-01 15:03:30 / 15:04:38 | 1002 Dr 1.00 then Cr 1.00 | Automatic synchronization test; net zero. |

The exact current balance of account `1002` (ذمم مدينة من المالك) is:

`45,060.25 - 1,110.00 + 61,429.44 - 106,429.69 - 60.00 + 96,139.95 = 95,029.95`

This equals the owner partner field `cumulative_deficit`.  The first July-specific closing entry is dated **31 July**, but was entered on **1 August at 10:24:21**.  The final corrected amount was entered on **1 August at 12:30:03**.

## 3. Connected applications

### Mandob

The public repository [mandob-sultan](https://github.com/Mahmoudsultan908/mandob-sultan) points to the same Supabase project and uses the same live ERP data.  It submits sales, collections, expenses, returns, and daily closings.  Its daily close writes to `rep_day_closings`; its confirmed sales use the ERP `sales` flow.

### Customer orders

The public repository [sultanoo](https://github.com/Mahmoudsultan908/sultanoo) is configured with `DATA_PROVIDER: 'erp'`.  Its ERP provider calls the live RPCs `fn_sultano_submit_order`, `fn_sultano_get_orders`, and related functions.  `fn_sultano_submit_order` calculates prices on the server and writes `customer_orders` and `customer_order_items`; it does not write journal entries directly.

The live database shows six Sultano orders around the cutoff window (29-30 July), with one cancelled order and the delivered orders linked to ERP sales.  The post-cutoff integration review is complete; accepted manual invoice/customer edits are recorded as operational behavior.

The first representative-close check found one close on 29 July with `1,571.00` sales (all cash), one close on 30 July with zero sales, and no `rep_day_closings` row returned for 31 July.  This is a reconciliation item only; it is not yet classified as an error until the underlying invoices, returns, and the intended close date are matched.

### Post-cutoff application reconciliation

- After the cutoff, `59` Sultano orders have a linked ERP sale and none is missing its linked sale.
- `20` of those orders have a total different from the linked sale; the absolute total difference is `3,145.00`.
- `25` orders have a different customer ID on the linked sale than on the original Sultano order.
- The owner confirmed that these differences are expected operational behavior because invoices and customer assignments are corrected manually according to the actual delivery.  They are therefore retained as an integration traceability note, not classified as accounting errors or correction candidates.

For Mandob, five post-cutoff day-closing rows were found.  Four match the `rep_van` sales for the same representative/date.  The 3 August close includes an additional `709.00` ERP sale assigned to the representative, while the other close dates exclude ERP sales assigned to the same representative.  There are also representative sales on dates without a closing row.  This is a closing-coverage and source-app rule to document, not a live-data correction.

## 4. Historical items to retain with the opening memory

1. Obtain the exact asset/liability snapshot that produced `96,139.95` (inventory, customer receivables, cash/treasuries, deferred expenses, suppliers, and accrued liabilities).
2. Reconcile the DEXEF transfer/opening-balance date with the July 31 accounting date; do not rebuild July profit from the journal alone until this is documented.
3. The post-cutoff Sultano and Mandob links were matched.  Sultano amount/customer differences are accepted manual edits; Mandob closing figures are retained as historical references.
4. Confirm whether the July closing was intended to include the manually accrued investor amount of `1,800.00` and the deferred expenses of `11,400.00`.
5. No adjustment is proposed from these historical items.  The current evidence does not justify replacing `95,029.95` with `95,500.00`.

## 5. Post-cutoff review (starting after the corrected 1 August entry)

For the operating review, the cutoff is `2026-08-01 12:30:03` (the creation time of `ADJ-OWNER-DEBT-CORRECTED-2026-08-01`).  The correction itself is treated as the opening entry; operating movements after it are reviewed separately.

### Accounting integrity

- `4,444` journal entries and `8,890` lines after 1 August are balanced: total debits and credits are both `2,627,396.31`.
- No entry without lines and no unbalanced entry was found in that period.
- The owner-deficit account has only a net-zero synchronization pair after the cutoff (`1.00` debit and `1.00` credit).
- Transaction-level checks found no missing or amount-mismatched journal link for `393` confirmed sales, `32` confirmed sales returns, `26` confirmed credit purchases, `34` supplier payments, or `4` purchase returns.

### Customers

- Confirmed credit sales: `276,746.60`.
- Confirmed credit sales returns: `14,945.75`.
- Confirmed customer payments: `209,911.35` plus payment discounts of `150.50`.
- The resulting customer-account movement is `51,739.00`, exactly matching account `1003` in the journal once the `150.50` payment discount is included.
- The existing `customers_balance_drift` view is not reliable for this period: it reads `customer_collections`, while the actual confirmed collections are in `customer_payments`. It therefore reports large apparent customer differences that are partly a report-source defect, not automatically customer errors.
- `72` customers had post-cutoff activity and `18` suppliers had post-cutoff credit/payments activity; these are the populations for the next per-party reconciliation.
- The `opening_balances` table does not contain a customer, supplier, treasury, or 1 August opening snapshot.  Its only confirmed data is inventory as of 17 July 2026.  Therefore the current cached balance on an individual customer or supplier cannot be certified or called an error from post-cutoff movements alone; the missing 1 August opening listing is an input required for the next reconciliation.

### Suppliers

- Confirmed credit purchases: `343,703.02`.
- Confirmed purchase returns: `45,361.89`.
- Confirmed supplier payments: `273,505.13`.
- Ordinary supplier movement is `24,836.00` credit. Three post-cutoff supplier balance refunds/transfers add `65,000.00` credit, giving `89,836.00`, exactly matching the journal movement on account `2001`.
- The existing `suppliers_balance_drift` view does not include those balance transfers, so its reported total drift of `365,686.75` must not be treated as a confirmed error until the transfer movements are included.

At transaction-link level, all `26` post-cutoff confirmed credit purchases, all `34` confirmed supplier payments, and all `4` confirmed purchase returns have matching journal entries with matching supplier-side amounts.  All `313` confirmed customer payments also have matching journal entries; the journal uses `amount + discount`, which explains the `150.50` difference if only the cash amount is compared.

The current supplier cache has two small negative balances (`ميرو مؤمن -15.87` and `رينجو -0.06`).  Neither supplier has any confirmed purchase or payment activity after the 1 August cutoff, so these values are retained as opening/history items and are not corrected from this period's data.

### Expenses and liabilities

- Confirmed expense records after the cutoff total `36,757.07` across `96` records.
- The corresponding expense journal activity is balanced; the July deferred-liability settlement entries are kept in account `2002` and should be reviewed separately from August operating expenses.
- All `96` confirmed expense records have a matching journal line for their configured expense account and exact amount.

### Data constraints and calculation checks

- The live schema enforces the key relationships and guardrails for this period: foreign keys for customers, suppliers, products, warehouses, treasuries, and journal accounts; unique invoice/reference numbers; valid status/payment-type values; positive payment/expense amounts; and journal lines cannot carry debit and credit on the same line.
- Post-cutoff confirmed sales passed the arithmetic check `total = subtotal + VAT - discount` for all `393` rows.  The `68` Sultano orders also passed both order-total and line-total arithmetic checks; no order line had a quantity/price calculation difference.
- The `8,870` post-cutoff journal lines checked had no negative values, no zero-value lines, and no line with both debit and credit populated.  This is a structural check only; it does not approve the business meaning of every entry.
- The owner approved the `خصم1` settlement for customer **ام كريم** on 16 August: cash amount `0.75` and discount `50.00`.  The journal records customer credit of `50.75` and discount expense of `50.00`; this is accepted and is not a correction candidate.
- `REP-COL-1787253637616` for customer **ام وعد** on 20 August has a blank `treasury_id` in `customer_payments`, but it is not missing from cash.  The payment trigger calls `post_cash`, which defaults a blank treasury to the database default; a matching `cash_transactions` row exists for `250.00` inbound in the **main treasury** with the same reference.  Across all `263` post-cutoff confirmed `REP-COL-*` collections, this is the only blank-treasury record and every collection has a matching cash-in transaction.  This is a metadata/source-record inconsistency only, not a cash shortage.
- Treasury assignment is present on all `34` confirmed supplier payments, all `96` confirmed expenses, and all `229` confirmed cash sales in the same period.  The single customer-payment metadata exception above is therefore isolated.

### Inventory

- Before the approved correction, the inventory control view reported ledger account `1004` at `139,364.77` versus physical stock valued at `136,444.93`, a difference of `2,919.84`.
- After the approved correction, the main warehouse has `1,707` units in `594` product rows, valued by the view at `129,135.98`; no main-warehouse row is negative.  The previously negative rows were `رينجو جمبرى حار 5ج` (-1) and `ويندوز جبنه 5جنيه` (-1), and both are now zero by the documented stock count.
- Van stock is stored separately from `inventory_stock`: `49` units valued at `4,293.50` are currently with **فتحى السيد**; the other listed reps have zero.  If van stock is part of the inventory asset, total physical stock by current purchase prices is `140,738.43`, which is `1,373.66` above ledger account `1004`.  The existing `inventory_ledger_check` excludes van stock and therefore its `2,919.84` drift is not a complete company-wide comparison.
- Before the correction, one active legacy item, `منتج محذوف من DEXEF` (`OLD-DELETED-ITEM`), held `507` units in the main warehouse with wholesale, retail, and purchase prices all `0.00`.  It had no sales or purchases after the 1 August cutoff, so it was an opening/migration valuation gap, not an August movement.  It is now inactive/hidden with zero stock; its historical invoices remain intact.
- Before the approved correction there were `41` stock-count sessions covering `61` item rows.  Every recorded row had a nonzero physical difference; the net recorded difference was `+10` units and the absolute difference was `126` units.  `fn_apply_stock_count` overwrites `inventory_stock` and writes the count audit rows, so these counts explain part of the stock-vs-ledger difference by design.  They must be treated as physical-count evidence, not posted again as an accounting correction.
- No warehouse-to-warehouse transfer was recorded after the cutoff.  There were `24` van loads and `11` van returns.  For فتحى السيد, loads `2,151` minus returns `1,040` minus rep-van sales `1,062` equals the current `49` van units; this movement identity reconciles.  عبد الرحمن has a one-unit residual that should be explained by the opening van quantity or a return path before final stock certification.
- The post-cutoff sale, sale-return, and purchase-return item calculations are exact.  Fourteen purchase-item lines differ from the raw `qty × unit_price` calculation only because of line rounding; their aggregate difference is `0.76` and absolute difference `1.04`, which is not a material stock quantity error.

The عبد الرحمن residual is now explained: product code `188` (كيلوجز نودلز سجق جامبو 40كيس) has a sale of one unit on 27 July, before the 1 August operating cutoff.  The later loads and returns net to zero, and current van stock is zero.  This is an opening-period sale, not a missing unit and not a correction candidate.

#### Approved inventory correction executed

The owner approved a documented stock count on 25 August 2026 for the main warehouse:

- `OLD-DELETED-ITEM`: `507` to `0`.
- `رينجو جمبرى حار 5ج` (code `340`): `-1` to `0`.
- `ويندوز جبنه 5جنيه` (code `264`): `-1` to `0`.

The correction is recorded under stock-count ID `1ea4e6f0-dc68-49f2-811e-b6dca14779f0`.  The old DEXEF product row was not physically deleted because historical sales/purchases reference it; it was instead set inactive/hidden and its stock was set to zero, preserving historical invoices.  No van stock or Abdulrahman data was changed.

After the correction, the main warehouse has `1,707` units valued at `129,135.98`; van stock remains `49` units valued at `4,293.50`.  The current ledger view reads `1004 = 131,961.07` versus main-warehouse physical value `129,135.98`.  The ledger also includes the normal COGS posting for invoice `INV-0634` created earlier on 25 August; no new journal was created by this stock correction.  A company-wide comparison including van stock is `133,429.48` physical value; this must be read separately because the existing view excludes van stock.

#### Focused check: company شمعدان

The apparent difference between the stock balance and the item movement is explained by two pieces that a raw document movement list does not show: the approved opening quantity and physical-count adjustments.

- Product `228` (شمعدان ميجا أحمر): document movement `-8`; physical count adjustment `+8`; current stock `0`.  Reconciled.
- Product `229` (شمعدان ميجا أخضر): document movement `+6`; physical count adjustment `-4`; current stock `2`.  Reconciled.
- Product `230` (شمعدان ميجا أصفر): document movement `+6`; physical count adjustment `+3`; current stock `9`.  Reconciled.
- Product `231` (تيبو شيكولاته 10 جنيه): document movement `+1`; current stock `1`.  Reconciled.
- Product `319` (تيبو شيكولاته 5 جنيه): post-cutoff document movement `-2`; current stock `2`; implied opening balance on 1 August is `4`.  The inventory-opening record was `6` units on 17 July and the transactions before the cutoff reduced it by `2`, which proves the `4` opening units.
- The remaining active شمعدان products reconcile to their current stock after the same calculation.  The legacy `شمعدان - صنف عام` has zero current stock and is not an unresolved current balance.

Therefore, the stock balance is not supposed to equal the sum of August documents alone.  The correct check is: `opening balance + purchases - purchase returns - sales + sales returns + approved stock-count adjustments = current stock`.

### Treasury

- Cash transaction inflows after the cutoff: `872,129.72`.
- Cash transaction outflows after the cutoff: `846,697.82`.
- Net cash movement: `25,431.90`, exactly matching the post-cutoff journal movement on account `1001`.
- Current treasury balances returned by the database are: main treasury `6,078.90`, cash treasury `2,453.00`, machine treasury `300.00`; the other listed treasuries are zero. These are current balances and still need a dated opening-to-current reconciliation.

### Investor capital movements (confirmed issue before publishing)

- The live `capital_partner_transactions` trigger updates only `capital_partners.capital_balance` for `contribution`/`withdrawal` and `accrued_profit_balance` for `profit_payout`. It does not call `post_cash` and does not call `post_journal`.
- The investor movement modal in `js/modules/investors.js` has no treasury selector. Saving a movement therefore cannot identify the treasury that received or paid the money.
- The live table contained one movement: owner **محمود سلطان**, `35,000.00`, type `contribution`, dated `2026-08-16`, note `باقى الدهب بعد البيع`. The owner clarified that, because the investor screen had no treasury posting, he temporarily created a supplier and used a `supplier_to_treasury` balance transfer. The matching `35,000.00` cash-in exists in **خزنة تقفيل** under balance transfer `4dc97606-5229-46cc-8c43-45707dc113e8`; its original journal was Dr `1001` / Cr `2001`.
- The existing `50,000.00` investor capital and `60,500.00` owner capital in `ADJ-CAPITAL-2026-07-31` are opening/reclassification figures from the DEXEF transfer, not proof of a new post-cutoff cash deposit. They must not be duplicated as cash movements without source evidence.
- This is a confirmed financial-integrity gap, not a display issue. The migration `investor_movements_treasury_atomic` has added the treasury field, required the atomic posting RPC for new movements, and removed direct authenticated inserts. The historical movement was then corrected without another cash entry: it is linked to **خزنة تقفيل**, the temporary supplier is zeroed and deactivated, and the balancing reclassification `RECLASS-OWNER-CAPITAL-35000-2026-08-16` posts Dr `2001` / Cr `3003` for `35,000.00` dated `2026-08-16`. The original supplier-to-treasury cash entry remains preserved once only.

### Mandob closing cash reference

- The stored `diff` field is mathematically consistent with `actual_cash - expected_cash` for all five post-cutoff closings.
- **عبد الرحمن** closed 3 and 4 August with zero difference (`actual_cash` equals `expected_cash`).
- **فتحى السيد** closed 11 August with zero difference, while the 12 August row records `expected_cash = 11,372.60` and `actual_cash = 0`, and the 16 August row records `expected_cash = 6,086.50` and `actual_cash = 0`.
- The owner confirmed these rows were reference figures at the time and are not considered a problem.  They remain historical closing inputs only; no balance correction is proposed.

### Initial conclusion

The post-cutoff journal, customer movement, supplier movement, and cash movement reconcile at the aggregate level after accounting for payment discounts and supplier balance transfers. The large customer/supplier drift figures currently shown by the database views are not yet evidence of data errors because those views omit the actual payment/transfer sources. Inventory is not yet certifiable as one company-wide value because the current view excludes van stock and includes a 507-unit zero-cost DEXEF placeholder; the two negative rows and the opening van residual also need operational confirmation.

## 6. Status

## 7. Decisions recorded from the owner

- The corrected closing entry on 1 August 2026 is the approved opening point for this operating period.
- Sultano invoice/customer differences are accepted as manual operational corrections, not accounting errors.
- The `ام كريم` discount settlement is approved.
- The `ام وعد` collection is confirmed as present in the main treasury through the generated cash transaction; only the blank source `treasury_id` is noted.
- Mandob closing rows for 12 and 16 August are accepted as historical reference figures, not variances requiring correction.
- The inventory screen now shows a company-wide stock-value summary (main warehouse plus van stock), while preserving the warehouse filter for row-level details.
- The ERP collections screen now refuses to save when no treasury is available and falls back to the configured default treasury before submitting a payment.
- Investor capital movements now require treasury linkage and atomic cash/journal posting. The historical `35,000.00` owner contribution is reconciled to **خزنة تقفيل** with no duplicate cash movement; its temporary supplier record is inactive with zero balance.

This memo is a temporary audit memory, not an approval to alter unrelated historical balances. The investor movement schema/RPC guard and the explicitly matched `35,000.00` reclassification were deployed after approval. Remaining work is limited to any future per-customer/per-supplier opening listing and any explicitly approved data correction.
