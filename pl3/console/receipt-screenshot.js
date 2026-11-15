function compact(text) {
  return text.normalize('NFKC').replace(/\s/g, '');
}

export function readBankReceipt(texts) {
  const recognized = texts.map(compact);
  const notices = recognized.filter(text => /存款入[帳賬]通知/.test(text));
  const drafts = notices.map(text => {
    const amount = text.match(/新臺幣([\d,]+)元/) || text.match(/新台幣([\d,]+)元/);
    const timestamp = text.match(/入[帳賬]時間[:：]?(\d{4})[/-](\d{2})[/-](\d{2})(\d{2}):(\d{2}):(\d{2})/);
    const account = text.match(/入[帳賬][帳賬]號後四碼[:：]?(\d{4})(?!\d)/);
    if (!amount || !timestamp || !account) return null;

    const [, year, month, day, hour, minute, second] = timestamp;
    const date = [year, month, day].join('-');
    const time = [hour, minute, second].join(':');
    const instant = new Date(date + 'T' + time + 'Z');
    const total = Number(amount[1].replaceAll(',', ''));
    if (!Number.isFinite(+instant) || instant.toISOString().slice(0, 19) !== date + 'T' + time ||
        !Number.isSafeInteger(total) || total <= 0) return null;

    const reference = ['PL', year + month + day, hour + minute + second, account[1], total].join('-');
    return { date, time, total, account: account[1], reference };
  });
  const draft = drafts[0];
  if (!draft || drafts.some(entry => entry?.reference !== draft.reference)) return null;

  const matchingDetails = recognized.flatMap(text => {
    const header = text.match(/(\d{1,2})[/-](\d{1,2})跨行轉(?:帳|賬)?([\d,]+)(?![\d,])/);
    const sender = text.match(/對方[帳賬]號[:：]?[\d*•]+?(\d{5})(?![\d*•])/);
    if (!header || !sender) return [];
    const [, month, day, amount] = header;
    if (Number(month) !== Number(draft.date.slice(5, 7)) ||
        Number(day) !== Number(draft.date.slice(8)) ||
        Number(amount.replaceAll(',', '')) !== draft.total) return [];
    return [sender[1]];
  });
  const last5 = [...new Set(matchingDetails)];
  return {
    received_at: draft.date,
    amount_twd: draft.total,
    transaction_id: last5.length === 1 ? draft.reference + `-${last5[0]}` : draft.reference,
    details: last5.length === 1 ? `交易明細顯示跨行轉帳 NT$${draft.total}，對方帳號末五碼 ${last5[0]}。` : '',
    evidence: `銀行存款入帳通知顯示 ${draft.date} ${draft.time} 入帳 NT$${draft.total}，收款帳號末四碼 ${draft.account}。\n`,
  };
}
