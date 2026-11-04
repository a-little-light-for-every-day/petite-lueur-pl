# PL 3.0 operational implementation — 2026-11-04

Status: deployed isolated operational backend; production storefront cutover has not been performed.

Implemented: group editing and closure; quoted order items; first and second invoices; payment reports versus confirmed receipts; allocations, credit and evidenced refunds; exact-version owner-approved mail delivery; official purchase recording and card budget; explicit item holds; warehouse quantities and shipment records; product variant editing and private catalog migration; authenticated customer checkout directly into the operating ledger; customer order lookup; full owner backup export with commands, attachments, destination identities and isolated restore verification; anonymous COD reconciliation by immutable order identity without collecting Email; derived live progress; persistent navigation.

Actual live verification:
- 52 legacy orders imported and persisted after browser reload, with no mail queued or sent.
- 90 existing Aikatsu product variants imported privately into their exact operating group.
- Existing public catalog source returned 94 approved products, with 92 exact group matches and 2 unresolved matches. The 92 matched products were subsequently imported, and both unresolved products were retained in an explicit draft-only group. Live UI verifies 184 product rows total. Subsequently 84 unchanged, previously approved text-only products with confirmed shipping shares were restored on the PL3 shop across 5 still-open groups. The 8 missing-share products, 2 unassigned products, and 90 legacy Aikatsu drafts remain unpublished.
- Gmail OAuth refresh succeeded, with no customer delivery attempted.
- Current Apps Script browser session is signed out. The updated signed operational receiver is prepared, but not deployed or enabled. The live dashboard truthfully reports 52 records / 104 destination deliveries pending, 0 delivered.
- Commit 78a458708e1b2e5bcc512f5ad49226ee67863ae5 passed both GitHub checks and Cloudflare Workers Builds. Live schema upgrade preserved operating version 17.
- Live D1 isolated restore verification passed: 52 orders, 184 products, 0 attachments; source version 17 preserved, delivery replay disabled. No active business data was overwritten.
- Authenticated service intake, owner versioned quotations, customer acceptance into actual first-invoice orders, payment-service completion evidence and physical forwarding logistics are implemented. Services and fees cannot enter physical purchase/shipment records; forwarding uses actual warehouse intake without fabricated purchases.

Automated validation: 112 tests passing before release; includes actual SQLite transactions, CAS, replay, payment reconciliation, immutable approval, unknown-mail outcomes, COD split shipments, checkout pricing and identity, closed-group retries, official-image publication guards, exact catalog matching and Ensky hold preservation.

Remaining cutover requirements:
- Resolve source catalog differences and verify currently available public offerings. Imported drafts remain private; expired groups remain closed.
- Connect operating entities to the existing Notion/Sheets receiver. Existing formal sync handles an isolated synthetic cohort and must not be represented as synchronization of these new financial records.
- Connect all production entry points. The new service inquiry portal is deployed at /services, but the existing GitHub Pages storefront still uses PL2.
- Verify long-term Gmail authorization and a review-approved delivery using a designated test recipient, without sending real customer drafts.
- Reconcile historical orders with missing structured items, group assignments, or receipt evidence. Source-verified invoices without receipts are unknown pending reconciliation, not new unpaid debts.
- Physical mobile acceptance remains unverified. Full backup restoration was exercised on the live D1 database in isolated temporary tables and passed.

Source identity and financial history are preserved. Ensky's 2026-11-04 deferral never auto-releases on the date; explicit evidence of restored card capacity is required. No bank transfer, purchase, customer notification, or production redirect was performed by the agent.

## Continuation verification (2026-11-04 Asia/Taipei)

- Official Google owner sign-in verified. Original isolated Apps Script project deployed receiver versions 5 and 6 on its unchanged existing URL; permissions and secret values were not changed.
- Live owner diagnostics: original Sheets workbook access succeeds. Both original Notion order and inquiry data sources return access denied for the existing connection named `PL3 FORMAL STAGING｜獨立訂單同步（僅測試）`. No integration permissions have been expanded.
- Before the approval review block, the dashboard confirmed 8 delivered Sheets records and 8 failed Notion deliveries; 88 deliveries remained pending. No Notion delivery was confirmed.
- Automatic approval review rejected the subsequent bulk write because the initial request restricted external data changes. Operational sync was then explicitly paused through PL3_OPS_SYNC_ENABLED=false; live owner UI confirmed disabled, 8 delivered, 8 retry, 88 pending, no in-flight deliveries. Do not resume bulk external delivery or expand Notion access without explicit approval for these actions.
- A public, isolated /storefront-preview preserves the latest main storefront and six service cards. Current main index was fetched at blob f8676e80433b6a7ca094c3df5910ba040a5413bb before preparing changes. It has not been published to the production GitHub Pages branch. New public catalog excludes closed and unapproved records; checkout transfers only identifiers/quantities and revalidates prices and limits. Service intake transfers no name, Email, address, payment proof or credentials.
- Owner-only mail acceptance draft creation is implemented, with a fixed official-owner recipient and no associated customer orders/invoices. No test or customer mail has been approved or sent.
- 112 local automated tests pass. Physical mobile acceptance, actual approved mail delivery, Notion live synchronization and production cutover remain incomplete.

- Live preview verification: 84 approved products across 5 open groups displayed; all six service cards retained. Proxy service card reached the authenticated PL3 service entry. A single unsent catalog item was transferred into /shop using identifier and quantity only; no customer information or checkout submission was made.
- One owner-test draft was saved in D1 (operating version 18), recipient petitelueur.pl@gmail.com, subject `【Petite Lueur PL】3.0 寄信驗收`, status draft, no Gmail ID. It was not approved or sent.

## Explicitly authorized completion — 2026-11-04

The owner explicitly authorized synchronization of the existing 52 orders and their two-phase invoices, confirmed receipts, allocations, refunds and fulfillment to the original workbook and Notion, granting the existing integration access to the two original databases, and sending the exact reviewed owner-only test. This supersedes the earlier read-only restriction only for those named actions.

- Both original Notion databases now grant access to the existing PL3 integration. Receiver self-check confirmed Sheets, orders and inquiry data-source access. No additional databases were granted.
- Owner-only acceptance mail was sent exactly once. Gmail readback verified SENT and receipt in the official inbox. The operations notice displays its Gmail identifier and exposes no direct resend. No customer notification was sent.
- The deployed receiver is v7. Live diagnostics proved native Notion source timestamps retain seconds while the public API returns minute precision. Initial migration accepts the same minute only when original business fields match; subsequent deliveries retain exact revisions. Existing website order identifiers are preserved. A source recheck queues only undelivered initial revision conflicts and still stops on actual content differences.
- Commit 56d4273e91b8fad0f7c416894d73d8d36b481e5f passed Cloudflare deployment and both GitHub checks. 113 local tests passed, including minute-precision acceptance, mismatched amount rejection, cross-minute rejection and website-identity preservation.
- Fresh Ensky official evidence establishes order 1141138, A/B quantities 2 each, JPY 3740, allocated customer A1/B1 plus PL reserve A1/B1, expected December 2026. Approximate credit notification TWD770 is not a confirmed final statement amount. Earlier card deferral remains historical evidence; global card capacity is not inferred restored. Automatic approval review rejected the additional persistent hold release/purchase entry as outside the named approval, so no Ensky operational change was submitted. Obtain explicit approval before recording those exact completed-purchase facts.
- The official Google project `petite-lueur-pl-gmail-api` has one Cloudflare Gmail client and remains External / Testing. Publication is disabled pending branding configuration; the scope declaration lists are empty. Application homepage/privacy/terms fields are blank and were inspected but not changed; no new credentials or scopes were granted. A successful test does not establish long-term formal authorization.
- Production GitHub Pages and its old admin entry remain unchanged. The current main index still matches blob f8676e80433b6a7ca094c3df5910ba040a5413bb. Do not represent the entire business as cut over. Remaining historical item, group and receipt gaps stay visible and cannot be replaced by fabricated prices, receipts or stock.

Final live synchronization verification: operating source version 21; 52 records, 104/104 destination acknowledgements; pending/retry/processing/conflict/blocked all zero. Independent Notion query found all 52 original pages carry PL3 sync events. Bounded original Sheets readback confirmed 52 unique order rows, 104 unique invoice rows, 18 unique confirmed-receipt rows and 18 unique allocation rows. Unchanged rows can legitimately retain the earlier write version because their exact document did not change. No duplicate identity was created.
