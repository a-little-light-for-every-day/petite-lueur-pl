# PL 3.0 operational implementation — 2026-11-04

Status: deployed isolated operational backend; production storefront cutover has not been performed.

Implemented: group editing and closure; quoted order items; first and second invoices; payment reports versus confirmed receipts; allocations, credit and evidenced refunds; exact-version owner-approved mail delivery; official purchase recording and card budget; explicit item holds; warehouse quantities and shipment records; product variant editing and private catalog migration; authenticated customer checkout directly into the operating ledger; customer order lookup; owner snapshot export; derived live progress; persistent navigation.

Actual live verification:
- 52 legacy orders imported and persisted after browser reload, with no mail queued or sent.
- 90 existing Aikatsu product variants imported privately into their exact operating group.
- Existing public catalog source returned 94 approved products, with 92 exact group matches and 2 unresolved matches. The 92 matched products were subsequently imported, and both unresolved products were retained in an explicit draft-only group. Live UI verifies 184 product rows total; none were published.
- Gmail OAuth refresh succeeded, with no customer delivery attempted.
- Apps Script project list is accessible as the official owner. This does not establish production operations synchronization.

Automated validation: 97 tests passing before release; includes actual SQLite transactions, CAS, replay, payment reconciliation, immutable approval, unknown-mail outcomes, COD split shipments, checkout pricing and identity, closed-group retries, official-image publication guards, exact catalog matching and Ensky hold preservation.

Remaining cutover requirements:
- Resolve source catalog differences and verify currently available public offerings. Imported drafts remain private; expired groups remain closed.
- Connect operating entities to the existing Notion/Sheets receiver. Existing formal sync handles an isolated synthetic cohort and must not be represented as synchronization of these new financial records.
- Connect all production entry points, including service inquiries. Existing GitHub Pages storefront still uses PL2.
- Verify long-term Gmail authorization and a review-approved delivery using a designated test recipient, without sending real customer drafts.
- Reconcile historical orders with missing structured items, group assignments, or receipt evidence. Source-verified invoices without receipts are unknown pending reconciliation, not new unpaid debts.
- Exercise backup restoration and physical mobile acceptance before making a full replacement claim.

Source identity and financial history are preserved. Ensky's 2026-11-04 deferral never auto-releases on the date; explicit evidence of restored card capacity is required. No bank transfer, purchase, customer notification, or production redirect was performed by the agent.
