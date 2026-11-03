// Only reads the isolated legacy archive. No operational order writes or automatic paid-state changes.
export async function readLegacyArchive(env) {
 const r=await env.DB.prepare(`SELECT s.source_page_id,s.source_id,s.source_revision,s.snapshot_json,
 (SELECT COUNT(*) FROM legacy_source_snapshots c WHERE c.source_page_id=s.source_page_id AND c.source_revision=s.source_revision) AS revision_variants
 FROM legacy_source_snapshots s
 WHERE s.snapshot_id=(SELECT x.snapshot_id FROM legacy_source_snapshots x WHERE x.source_page_id=s.source_page_id ORDER BY x.source_revision DESC,x.snapshot_id DESC LIMIT 1)
 ORDER BY s.source_id LIMIT 500`).all();
 const orders=(r.results||[]).map(x=>{
  const data=JSON.parse(x.snapshot_json);
  if(x.revision_variants>1){data.disposition='review';data.issues=[...new Set([...data.issues,'SOURCE_REVISION_CONFLICT'])];}
  return data;
 });
 return {ok:true,mode:'isolated_source_archive',safe_to_import:false,orders,
 counts:{orders:orders.length,excluded:orders.filter(x=>x.disposition==='excluded').length,
 review:orders.filter(x=>x.disposition==='review').length,ready_for_review:orders.filter(x=>x.disposition==='ready_for_review').length}};
}
