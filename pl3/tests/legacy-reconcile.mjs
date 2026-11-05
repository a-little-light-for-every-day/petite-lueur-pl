import test from "node:test";
import assert from "node:assert/strict";
import {reconcileLegacySnapshots} from "../legacy-reconcile.mjs";
const row={source_system:"PL2",source_id:"legacy-001",source_revision:"r1",amount_twd:350,
  payment_phase:"first_verified",status:"ordered",items:[{sku:"A",variant:"",quantity:1,unit_price_twd:350}]};
test("legacy snapshot exact match is a read-only report, never an import",()=>{
 const r=reconcileLegacySnapshots([row],[{...row}]);
 assert.deepEqual([r.matched_count,r.discrepancy_count,r.legacy_total_twd],[1,0,350]);
 assert.equal(r.safe_to_import,false);
});
test("source identity, amount, status and line mismatches are quarantined",()=>{
 const r=reconcileLegacySnapshots([row],[{...row,payment_phase:"unknown",status:"pending",items:[{sku:"B",variant:"",quantity:1,unit_price_twd:350}]}]);
 assert.equal(r.discrepancy_count,1);
 assert.deepEqual(r.findings[0].fields,["payment_phase","status","items"]);
});
test("missing, extra, duplicates and amounts are not silently merged",()=>{
 const missing=reconcileLegacySnapshots([row],[]);
 assert.equal(missing.findings[0].reason,"missing_staged");
 const extra=reconcileLegacySnapshots([],[row]);
 assert.equal(extra.findings[0].reason,"unexpected_staged");
 assert.throws(()=>reconcileLegacySnapshots([row,row],[]),/duplicate source identity/);
 assert.throws(()=>reconcileLegacySnapshots([{...row,amount_twd:351}],[]),/amount\/lines mismatch/);
});

test("stale source revision is blocked even when totals and status happen to match",()=>{
 const r=reconcileLegacySnapshots([row],[{...row,source_revision:"older"}]);
 assert.deepEqual(r.findings[0].fields,["source_revision"]);
 assert.equal(r.safe_to_import,false);
});
