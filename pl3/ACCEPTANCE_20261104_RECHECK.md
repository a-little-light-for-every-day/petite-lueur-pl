# PL3 2026-11-04｜團次、訂單及舊同步退役複核

> This is an evidence-based **draft release gate**, not production cutover approval. All times below are Asia/Taipei. No live bank/payment status, customer order, Gmail notice or PL2 trigger was changed in this pass.

## 1. Groups and products (read-only owner UI)

- PL3 has 62 group records: 52 closed/history, 5 open with 84 public products, 2 overdue open, 1 product-incomplete group, and 2 unpublished draft groups.
- 227 PL3 product/variant records in total. Public items: 84; drafts: 143.
- The legacy catalog preview listed 94 owner-approved products, of which 92 matched a group precisely and 2 were assigned to a non-public unassigned group. All 94 legacy product identifiers are present in PL3. Ten are still drafts (5 CS.FRONT variants, 2 Tamon badge boxes, 1 1/8 figure with unverified shipping units, and 2 unassigned items).
- Codes labeled `來源代碼` must **not** be presented as manufacturer-confirmed SKU numbers.
- Split-group quantities were **not yet a live availability control**. The review implementation adds a distinct per-variant `claim_capacity` and `manual_claims`, subtracts non-cancelled orders, re-checks capacity on checkout and manual edits, and rejects exceeding the limit. Existing products have no invented caps; the owner must confirm split allocations before publishing them.

## 2. Isolated operational acceptance

`pl3/tests/isolated-acceptance.mjs` runs entirely against an in-memory SQLite DB and fake signed Sheets/Notion transport. It:

1. Seeds a fake 10-minute OTP; verifies successful login and one-time use. **No Gmail send/request-code endpoint is called.**
2. Creates a fake group/product, places a customer order, tests idempotent replay, and checks that shared split capacity cannot be exceeded.
3. Closes the group to create the first invoice and a **draft** notification; checks that the future notification points to the canonical `a-little-light-for-every-day` PL3 address, not staging.
4. Submits a payment report; confirms that a report alone does not settle the invoice.
5. Records fake, separately authorized first and second receipts; checks balance/allocations and a second-stage shipping bill.
6. Sends fake HMAC envelopes to both `sheets` and `notion`, verifies exact acknowledgments and no duplicate retries. **This does not prove production destination availability or conflict-free remote writes.**
7. Queries fake customer orders and tests that unauthenticated lookup is denied; all fake mail remains unapproved/unsent.

Validation: `node --test pl3/tests/*.mjs` **136/136 pass**; `npm --prefix pl3/console run build` successful. A **live** owner-reviewed OTP/Notion/email delivery test remains a release gate.

## 3. Legacy conflict classification (official Google Sheet)

Source: `同步衝突` and `🧭 差異分類設定` of PL official spreadsheet (`1Ts9N_UCnn5YITrT6M3CmliKswB78q6gtoxQR9zNkEPI`).

- Total 201 conflicts: 53 previously resolved; **148 unresolved** (102 `待主購確認`, 46 `待處理`).
- Added **46 missing classification settings**: 43 `同步基準缺失`, two date-format discrepancies, one real timestamp conflict.
- Reclassified **38 existing `新差異待分類` settings** based on their already-recorded reason and field, without modifying either source value.
- Readback verified **148/148 unresolved rows now have actionable classifications**, with none remaining labeled `新差異待分類`:

| Classification | Rows | Required handling |
|---|---:|---|
| 格式／轉碼差異 | 37 | Confirm normalized equivalents; never infer protected financial values |
| 內容增補／描述差異 | 28 | Owner compare meaning and keep provenance |
| 欄位型態／結構差異 | 1 | Validate type and source before rewrite |
| 受保護業務欄位 | 8 | No automatic overwrite; owner evidence needed |
| 雙側修改／待核對 | 13 | Preserve both versions; owner choice |
| 雙側修改／時間衝突 | 6 | Compare edit provenance and timezones |
| 首次同步／來源差異 | 12 | Establish authoritative version |
| 同步基準缺失 | 43 | Reconstruct baseline or flag unresolvable without inference |
| **Total** | **148** | **No source-data override or conflict-status closure** |

The original source conflict counts are unchanged. Resolving the 102 owner-review rows requires the owner's decision on competing business facts; classification is not resolution.

## 4. Why PL2 Apps Script must stay alive

Read-only production log inspection on Nov 4 found:

- `22:37:04`: `自動／手動同步` completed with 46 conflicts.
- `22:37:08` and `22:37:46`: `PLX 全營運同步` still completed scheduled cycles.

The original GitHub Pages `index.html`, `admin/index.html`, `tools/refresh-public-catalog.mjs` and `pl3/catalog-source.js` still point to the PL2 Apps Script web app. In particular, the old owner admin HTML retains an Apps Script iframe and an operational fallback. The present code/last-run logs establish a **live dependency**; access to the Apps Script trigger inventory itself was not proved, so no trigger was disabled.

**Retirement gate**: snapshot and reconcile all historical orders, payments and notices; point any remaining old public/LINE/social/owner fallbacks to the approved canonical PL3 site; confirm inbound OTP, public lookups, server-side async writes and schedule dependencies after migration; only then explicitly retire each known legacy trigger and monitor for errors. Keep the old site reachable for lookup until historic order links are addressed.

## 5. Publication status

- Proposed fixes and tests are for review; **not deployed to production**, and no old service was turned off.
- Official URL policy: `https://a-little-light-for-every-day.petitelueur-pl.workers.dev/`.
- Do not publish the remaining ten legacy-catalog drafts or assign split-slot capacities until source evidence is approved.
- No customer-facing mail or social announcements were sent during this pass.
