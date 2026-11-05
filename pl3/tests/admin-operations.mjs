import test from "node:test";
import assert from "node:assert/strict";
import { reviewPayment, advanceFulfillment } from "../admin-operations.js";

function harness() {
  const state = {
    payment: { id: "r1", order_id: "o1", amount_twd: 350,
      total_twd: 350, status: "pending_review", payment_status: "unpaid", group_id: "PL3-QA-LOCAL" },
    fulfillment: { id: "f1", order_id: "o1", status: "pending", group_id: "PL3-QA-LOCAL" },
    events: [], audit: []
  };
  const db = {
    prepare(sql) {
      return {
        sql, args: [],
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes("FROM payment_reports pr")) {
            return this.args[0] === "r1" ? { ...state.payment } : null;
          }
          if (sql.includes("FROM fulfillments f")) {
            return this.args[0] === "f1" ? { ...state.fulfillment } : null;
          }
          throw Error("Unexpected SQL");
        }
      };
    },
    async batch(statements) {
      const out = [];
      for (const s of statements) {
        let changes = 1;
        if (s.sql.startsWith("UPDATE payment_reports")) {
          if (state.payment.status !== "pending_review") changes = 0;
          else state.payment.status = s.args[0];
        } else if (s.sql.startsWith("UPDATE orders")) {
          if (state.payment.payment_status !== "unpaid") changes = 0;
          else state.payment.payment_status = "paid";
        } else if (s.sql.startsWith("UPDATE fulfillments")) {
          if (state.fulfillment.status !== s.args[2]) changes = 0;
          else state.fulfillment.status = s.args[0];
        } else if (s.sql.startsWith("INSERT INTO audit_events")) {
          if (state.audit.some(e => e.args[0] === s.args[0])) throw Error("Duplicate audit");
          state.audit.push(s);
        } else if (s.sql.startsWith("INSERT INTO sync_outbox")) {
          if (state.events.some(e => e.args[0] === s.args[0])) throw Error("Duplicate event");
          state.events.push(s);
        } else throw Error("Unexpected batch SQL");
        out.push({ meta: { changes } });
      }
      return out;
    }
  };
  return { state, env: { DB: db } };
}
const approval = {
  report_id: "r1", decision: "approve", bank_statement_confirmed: true,
  note: "QA bank statement checked"
};

test("bank confirmation is mandatory before approving report", async () => {
  const { env } = harness();
  await assert.rejects(reviewPayment({ ...approval,
    bank_statement_confirmed: false }, "owner@example.com", env),
    { status: 400, message: "Manual bank statement confirmation required" });
});

test("owner approval updates report and order and produces audit/outbox once", async () => {
  const { env, state } = harness();
  const response = await reviewPayment(approval, "owner@example.com", env);
  assert.equal(response.status, "approved");
  assert.equal(state.payment.payment_status, "paid");
  assert.equal(state.audit.length, 1);
  assert.equal(state.events.length, 1);
  await assert.rejects(reviewPayment(approval, "owner@example.com", env), { status: 409 });
});

test("mismatched amount cannot automatically mark fully paid", async () => {
  const { env, state } = harness();
  state.payment.amount_twd = 100;
  await assert.rejects(reviewPayment(approval, "owner@example.com", env), { status: 409 });
  assert.equal(state.payment.payment_status, "unpaid");
});

test("rejection requires reason and never marks order paid", async () => {
  const { env, state } = harness();
  await assert.rejects(reviewPayment({
    report_id: "r1", decision: "reject"
  }, "owner@example.com", env), { status: 400 });
  const r = await reviewPayment({
    report_id: "r1", decision: "reject", note: "Bank transfer not found"
  }, "owner@example.com", env);
  assert.equal(r.status, "rejected");
  assert.equal(state.payment.payment_status, "unpaid");
  assert.equal(state.events.length, 1);
});

test("fulfillment allows only confirmed next-step transition", async () => {
  const { env, state } = harness();
  await assert.rejects(advanceFulfillment({
    fulfillment_id: "f1", status: "delivered", confirmed: true
  }, "owner@example.com", env), { status: 409 });
  await assert.rejects(advanceFulfillment({
    fulfillment_id: "f1", status: "ordered", confirmed: false
  }, "owner@example.com", env), { status: 400 });
  const r = await advanceFulfillment({
    fulfillment_id: "f1", status: "ordered", confirmed: true,
    note: "Test transition"
  }, "owner@example.com", env);
  assert.equal(r.status, "ordered");
  assert.equal(state.fulfillment.status, "ordered");
  assert.equal(state.audit.length, 1);
  assert.equal(state.events.length, 1);
  await assert.rejects(advanceFulfillment({
    fulfillment_id: "f1", status: "ordered", confirmed: true
  }, "owner@example.com", env), { status: 409 });
});

test("staging rejects manual mutations for any non-QA group", async () => {
  const {env,state}=harness();
  state.payment.group_id="FORMAL-GROUP";
  state.fulfillment.group_id="FORMAL-GROUP";
  await assert.rejects(reviewPayment({
    report_id:"r1", decision:"reject", note:"Reason provided"
  },"owner@example.com",env),{status:403,message:"Staging mutations are QA-only"});
  await assert.rejects(advanceFulfillment({
    fulfillment_id:"f1",status:"ordered",confirmed:true,note:"Test"
  },"owner@example.com",env),{status:403,message:"Staging mutations are QA-only"});
  assert.equal(state.audit.length,0);
  assert.equal(state.events.length,0);
  assert.equal(state.payment.status,"pending_review");
  assert.equal(state.fulfillment.status,"pending");
});
