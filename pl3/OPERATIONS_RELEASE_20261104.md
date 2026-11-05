# PL 3.0 formal operating cutover — 2026-11-04

Status: the official GitHub Pages storefront and original owner entry now use PL3 operations. The live owner console identifies itself as formal operations. The operating source version is 25.

## Verified publication

- Official Pages commit: 488f1055f51aee1d07820fca51c185383b5058e5, successfully deployed.
- Formal backend marker: c8105cb480ba5bc013bfebc00f724731f212b35e, successfully deployed. Follow-up commit 5221f10216c2c8e80445f5467a8c5dccf17263e6 passed Workers Builds and both GitHub checks.
- The branded homepage retains its six service cards and official image assets. Approved catalog: 84 products across five open groups. Unapproved products and closed groups remain unavailable.
- Official-site checkout transfers only product identifiers and quantities to PL3, where price, inventory, group and identity are revalidated. Legacy identity fields are hidden. If the entry adapter cannot load, submission fails closed rather than falling back to PL2.
- Live UI handoff verified the same product, quantity and price at PL3 checkout, without submitting a test customer order. The test cart was cleared through the UI. Service routing reaches PL3 authenticated intake. Customer lookup reaches its Email verification screen. The original admin path redirects to the private PL3 owner console and retains the valid owner session.

## Historical and financial integrity

- Fifty-two original orders remain present. Eleven source-verified historical orders received 24 previously missing item rows and five private, closed historical customer groupings. Existing groupings were used where supported by the source. No new customer was invented.
- Historical unit prices that cannot be established remain null. Original order totals are unchanged. Per-order reconciliation notes preserve missing fees, COD approval, historical price/receipt evidence and shipment uncertainties. The lack of receipt evidence is not converted into a fresh unpaid debt.
- Independent Notion readback confirmed all 52 mirrored records and 11 reconciliation records. All 104 invoices, 18 receipts and 18 allocations matched the pre-completion baseline on every compared financial field. Original customer identities, sent notices and fund allocations were preserved.
- Ensky's earlier card deferral remains preserved, with an explicit subsequent completed-purchase record and customer-versus-PL-reserve allocation evidence. Final card settlement is unknown until a statement confirms it; purchasing is not treated as customer payment or restored global card capacity.
- All 104 Notion/Sheets destination deliveries are acknowledged. Pending, retry, processing, conflict and blocked counts are zero at operating source version 25. Independent original Sheets readback confirms 52 unique orders, including all 11 reconciliation records.

## Gmail and delivery

- The official Gmail OAuth project is now In production. Its declared scope is only gmail.send. The homepage, owned GitHub Pages domain and factual application privacy disclosure were saved.
- Google sensitive-scope application verification remains pending; the official owner is the OAuth authorizing user. Customer Email verification does not request access to customer mailboxes. No credentials were copied to source or chat.
- The exact owner-approved acceptance mail was sent once and verified via official Gmail readback. No customer notification was sent during this cutover. Customer notices still require exact-version owner approval; ambiguous delivery results cannot be blindly resent.

## Validation and known limits

- 119 automated tests pass. Relevant cases include CAS and replay, confirmed versus reported funds, COD settlement, immutable notice approval, unknown-mail outcomes, historical stale-source/total/fulfillment guards, nullable amount normalization and fail-closed production handoff.
- Receiver v8 handles native Sheets blank normalization. Old blank hashes are accepted only when the unchanged embedded document proves the amount is unknown. Removing a known amount or an explicit zero still triggers conflict protection.
- Live isolated backup restore verification passed at version 25: 52 orders, 184 products and zero stored attachments. Delivery replay remained disabled and active operating data was not overwritten.
- Bank API reconciliation and carrier-label issuance are not connected. The backend supports owner-confirmed evidence and tracking records; these external actions are not represented as automated.
- Physical-phone acceptance and a fresh real customer checkout were not performed during the cutover. The customer handoff and authentication screens were verified without creating fictitious customer data or sending additional mail.
