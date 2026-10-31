// PL3 staging owner mutations. Never infer bank receipt from a customer report.
const err = (message, status = 400) => Object.assign(new Error(message), { status });
const asText = (v, max = 500) => String(v ?? "").trim().slice(0, max);

export async function reviewPayment(body, actor, env) {
  const reportId = asText(body?.report_id, 100);
  const decision = body?.decision;
  const note = asText(body?.note);
  if (!reportId || !["approve", "reject"].includes(decision)) throw err("Invalid payment review");
  if (decision === "approve" && body?.bank_statement_confirmed !== true) {
    throw err("Manual bank statement confirmation required");
  }
  if (decision === "reject" && !note) throw err("Rejection reason required");

  const row = await env.DB.prepare(
    "SELECT pr.id,pr.order_id,pr.amount_twd,pr.status,o.total_twd,o.payment_status FROM payment_reports pr JOIN orders o ON o.id=pr.order_id WHERE pr.id=?"
  ).bind(reportId).first();
  if (!row) throw err("Payment report not found", 404);
  if (row.status !== "pending_review") throw err("Payment report already reviewed", 409);
  if (decision === "approve" && (
    row.payment_status !== "unpaid" || row.amount_twd !== row.total_twd
  )) throw err("Payment mismatch; manual reconciliation required", 409);

  const nextStatus = decision === "approve" ? "approved" : "rejected";
  const eventId = "pl3:payment-review:" + reportId;
  const payload = { report_id: reportId, order_id: row.order_id,
    decision, actor, note: note || null };
  const statements = [
    env.DB.prepare(
      "UPDATE payment_reports SET status=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending_review'"
    ).bind(nextStatus, reportId)
  ];
  if (decision === "approve") {
    statements.push(env.DB.prepare(
      "UPDATE orders SET payment_status='paid',updated_at=CURRENT_TIMESTAMP WHERE id=? AND payment_status='unpaid'"
    ).bind(row.order_id));
  }
  statements.push(env.DB.prepare(
    "INSERT INTO audit_events(id,actor_type,actor_id,action,object_type,object_id,metadata_json) VALUES(?,'owner',?,'payment.reviewed','payment_report',?,?)"
  ).bind(eventId, actor, reportId, JSON.stringify(payload)));
  statements.push(env.DB.prepare(
    "INSERT INTO sync_outbox(id,entity_type,entity_id,event_type,payload_json) VALUES(?,'order',?,'payment.reviewed',?)"
  ).bind(eventId, row.order_id, JSON.stringify(payload)));

  let results;
  try { results = await env.DB.batch(statements); }
  catch { throw err("Payment review conflicted; refresh the queue", 409); }
  if (results?.[0]?.meta?.changes !== 1 ||
      (decision === "approve" && results?.[1]?.meta?.changes !== 1)) {
    throw err("Concurrent payment review detected; reconcile before continuing", 409);
  }
  return { ok: true, report_id: reportId, order_id: row.order_id, status: nextStatus };
}

// Single-step transitions make it impossible to accidentally jump from pending
// to delivered. Reversals and corrections require a separate owner audit workflow.
const stages = [
  "pending", "ordered", "japan_warehouse", "international_shipping",
  "taiwan_warehouse", "domestic_shipping", "delivered"
];
export async function advanceFulfillment(body, actor, env) {
  const id = asText(body?.fulfillment_id, 100);
  const next = asText(body?.status, 40);
  const note = asText(body?.note);
  if (!id || !stages.includes(next) || body?.confirmed !== true) {
    throw err("Invalid or unconfirmed fulfillment update");
  }
  const row = await env.DB.prepare(
    "SELECT f.id,f.status,oi.order_id FROM fulfillments f JOIN order_items oi ON oi.id=f.order_item_id WHERE f.id=?"
  ).bind(id).first();
  if (!row) throw err("Fulfillment not found", 404);
  const currentIndex = stages.indexOf(row.status);
  if (currentIndex < 0 || stages[currentIndex + 1] !== next) {
    throw err("Invalid fulfillment status transition", 409);
  }
  const eventId = "pl3:fulfillment:" + id + ":" + next;
  const payload = {
    fulfillment_id: id, order_id: row.order_id, from: row.status,
    to: next, actor, note: note || null
  };
  const statements = [
    env.DB.prepare("UPDATE fulfillments SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status=?")
      .bind(next, id, row.status),
    env.DB.prepare(
      "INSERT INTO audit_events(id,actor_type,actor_id,action,object_type,object_id,metadata_json) VALUES(?,'owner',?,'fulfillment.advanced','fulfillment',?,?)"
    ).bind(eventId, actor, id, JSON.stringify(payload)),
    env.DB.prepare(
      "INSERT INTO sync_outbox(id,entity_type,entity_id,event_type,payload_json) VALUES(?,'order',?,'fulfillment.advanced',?)"
    ).bind(eventId, row.order_id, JSON.stringify(payload))
  ];
  let results;
  try { results = await env.DB.batch(statements); }
  catch { throw err("Fulfillment update conflicted; refresh status", 409); }
  if (results?.[0]?.meta?.changes !== 1) {
    throw err("Concurrent fulfillment update detected", 409);
  }
  return { ok: true, fulfillment_id: id, status: next };
}
