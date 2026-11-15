// PL3 / LINE quote-to-claim adapter. Call only AFTER verifying X-Line-Signature.
// No order, invoice, stock reservation, payment or customer identity is created.
const MAX_QTY = 20;
const MAX_TWD = 22000;
const enc = new TextEncoder();

function lineScope(event, allowedGroupIds) {
  const source = event?.source;
  if (source?.type === 'group' && /^[C][a-f0-9]{32}$/i.test(source.groupId || '')) {
    return allowedGroupIds.has(source.groupId) ? `group:${source.groupId}` : null;
  }
  if (source?.type === 'user' && /^U[a-f0-9]{32}$/i.test(source.userId || '')) {
    return `user:${source.userId}`;
  }
  return null;
}

function parseQuantity(text) {
  const match = /^\s*(?:\+|＋|×|x|X)\s*(\d{1,2})\s*$/.exec(text || '');
  const qty = match ? Number(match[1]) : NaN;
  return Number.isInteger(qty) && qty >= 1 && qty <= MAX_QTY ? qty : null;
}

function parseDirectClaim(text) {
  const match = /^PL認領\s+([A-Za-z0-9_.:-]{1,128})\s+(?:\+|＋|×|x|X)\s*(\d{1,2})\s*$/.exec(text || '');
  if (!match) return null;
  const quantity = Number(match[2]);
  return quantity >= 1 && quantity <= MAX_QTY ? { productId: match[1], quantity } : null;
}

function parseBinding(text) {
  const match = /^PL綁定\s+([A-Za-z0-9_.:-]{1,128})\s*$/.exec(text || '');
  return match ? match[1] : null;
}

async function userHash(secret, lineUserId) {
  if (!secret || secret.length < 24) throw new Error('PL_LINE_CLAIM_HASH_SECRET required');
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(lineUserId)));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// Product checks mirror PL3 checkout: never trust a LINE caption or price.
export async function lookupClaimProduct(db, productId, now = Date.now()) {
  const row = await db.prepare(`SELECT p.id, p.group_id, p.name, p.variant, p.price_twd,
    p.quantity_limit, p.status AS product_status, g.status AS group_status,
    g.published, g.order_deadline
    FROM products p JOIN groups g ON g.id=p.group_id WHERE p.id=? LIMIT 1`).bind(productId).first();
  if (!row || Number(row.published) !== 1 || row.group_status !== 'open' ||
      !['available', 'active'].includes(row.product_status) ||
      !Number.isInteger(row.price_twd) || row.price_twd < 1) return null;
  if (row.order_deadline) {
    let value = String(row.order_deadline).trim().replace(' ', 'T');
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) value += '+08:00';
    const end = Date.parse(value);
    if (!Number.isFinite(end) || end <= now) return null;
  }
  return row;
}

export function createLineClaimHandler({ db, ownerId, allowedGroupIds = [], hashSecret, enabled = false,
  lookupProduct = lookupClaimProduct, now = () => Date.now() }) {
  const allowed = new Set(allowedGroupIds);
  if (!db) throw new Error('D1 DB binding is required');
  const isOwner = userId => userId && userId === ownerId;
  return async function handleLineClaimEvent(event) {
    if (!enabled || event?.type !== 'message') return null;
    const scope = lineScope(event, allowed);
    if (!scope) return null;
    const msg = event.message || {};
    const actorId = event.source.userId;
    // Record only images sent by PL owner, not customers' private photos.
    if (msg.type === 'image' && isOwner(actorId) && typeof msg.id === 'string' && /^\d{8,25}$/.test(msg.id)) {
      await db.prepare('INSERT OR IGNORE INTO line_claim_images(scope_id,image_message_id) VALUES(?,?)')
        .bind(scope, msg.id).run();
      return null;
    }
    if (msg.type !== 'text' || typeof msg.text !== 'string') return null;
    const text = msg.text.trim();
    const bindId = parseBinding(text);
    if (text.startsWith('PL綁定')) {
      if (!isOwner(actorId)) return null;
      if (!bindId || !msg.quotedMessageId) return '綁定格式：請引用已發送的商品圖片，回覆「PL綁定 商品ID」。';
      const original = await db.prepare('SELECT image_message_id FROM line_claim_images WHERE scope_id=? AND image_message_id=?')
        .bind(scope, msg.quotedMessageId).first();
      if (!original) return '找不到這張由主購發布的圖片紀錄，請重新發圖再引用綁定。';
      const product = await lookupProduct(db, bindId, now());
      if (!product) return '商品未公開、已截止或尚未確認價格，不能開放認領。';
      await db.prepare(`INSERT INTO line_claim_bindings(scope_id,image_message_id,product_id)
        VALUES(?,?,?) ON CONFLICT(scope_id,image_message_id) DO UPDATE SET product_id=excluded.product_id`)
        .bind(scope, msg.quotedMessageId, product.id).run();
      return `♡ 已綁定：${product.name}${product.variant ? `｜${product.variant}` : ''}\n商品款 NT$${product.price_twd}／件（二補另計）\n引用原圖回覆「+1」「+2」即可暫存認領。`;
    }
    let claim = parseDirectClaim(text);
    let quotedId = null;
    if (!claim && msg.quotedMessageId) {
      const quantity = parseQuantity(text);
      if (quantity) {
        const binding = await db.prepare('SELECT product_id FROM line_claim_bindings WHERE scope_id=? AND image_message_id=?')
          .bind(scope, msg.quotedMessageId).first();
        if (binding) { claim = { productId: binding.product_id, quantity }; quotedId = msg.quotedMessageId; }
      }
    }
    if (!claim) return text.startsWith('PL認領') ? '認領格式：PL認領 商品ID +1（最多 20 件）。' : null;
    if (!/^U[a-f0-9]{32}$/i.test(actorId || '')) return '無法確認 LINE 發送者，未建立認領登記。';
    if (typeof event.webhookEventId !== 'string' || !/^[a-zA-Z0-9_-]{12,100}$/.test(event.webhookEventId)) return null;
    const product = await lookupProduct(db, claim.productId, now());
    if (!product) return '商品已截止、售完或未公開，目前無法認領。';
    if (product.quantity_limit != null && claim.quantity > Number(product.quantity_limit))
      return '認領數量超過此商品設定的單筆限制，請減少數量。';
    const total = product.price_twd * claim.quantity;
    if (!Number.isSafeInteger(total) || total > MAX_TWD)
      return '本次商品款超過 PL 單筆金額上限，請先聯絡主購確認。';
    const hashedUserId = await userHash(hashSecret, actorId);
    const claimId = crypto.randomUUID();
    const stored = await db.prepare(`INSERT OR IGNORE INTO line_claim_intents
      (id,webhook_event_id,scope_id,image_message_id,user_hash,product_id,quantity,unit_price_twd,group_id)
      VALUES(?,?,?,?,?,?,?,?,?)`).bind(
        claimId, event.webhookEventId, scope, quotedId, hashedUserId, product.id,
        claim.quantity, product.price_twd, product.group_id
      ).run();
    if (stored.meta?.changes !== 1) return '這則 LINE 訊息已登記過，不會重複計入。';
    return `♡ 已暫存認領\n${product.name}${product.variant ? `｜${product.variant}` : ''} ×${claim.quantity}\n` +
      `商品款 NT$${total}（不含二補）\n認領編號：${claimId}\n` +
      '此為待確認登記，未保留庫存、未成立訂單或付款義務。請至 PL 正式網站完成申請，待主購確認承接後再依通知付款。';
  };
}
