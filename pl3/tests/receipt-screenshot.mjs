import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBankReceipt } from '../console/receipt-screenshot.js';

const notice = '存款 入帳 通知\n新 臺 幣 1,230 元\n入 帳 時 間：2026/11/15 17:51:25\n入 帳 帳 號 後 四 碼：0123';
const details = '11/15 跨行轉 1,230\n餘額 8,449\n對 方 帳 號 1234**05678';

test('uses the incoming amount instead of the balance and preserves leading zeroes', () => {
  const draft = readBankReceipt([details, notice]);
  assert.equal(draft.amount_twd, 1230);
  assert.equal(draft.received_at, '2026-11-15');
  assert.equal(draft.transaction_id, 'PL-20261115-175125-0123-1230-05678');
  assert.match(draft.details, /末五碼 05678/);
});

test('requires a complete deposit notice and skips unmatched transfer details', () => {
  assert.equal(readBankReceipt([details]), null);
  assert.equal(readBankReceipt([notice.replace('11/15', '11/31')]), null);
  assert.equal(readBankReceipt([notice, notice.replace('17:51', '17:52')]), null);
  const draft = readBankReceipt([notice, details.replace('1,230', '1,231')]);
  assert.equal(draft.transaction_id, 'PL-20261115-175125-0123-1230');
  assert.equal(draft.details, '');
});
