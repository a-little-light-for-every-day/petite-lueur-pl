import React, { useEffect, useState } from 'react';
import { cartFromFragment } from '../storefront-handoff.js';
import { visibleCatalogProducts, selectedGroupCart } from '../catalog-search.js';

const PUBLIC_PROGRESS_URL = 'https://docs.google.com/spreadsheets/d/14RUqyVYyAlD5th0g9fNkxR-8eqV3yhiadTAYNK9Dz4A/edit';

export function PublicShop({ token, ready, api, Login, Input, Empty, money }) {
  const [data, setData] = useState(null);
  const [groupId, setGroupId] = useState('');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState({});
  const [name, setName] = useState('');
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [login, setLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [attempt, setAttempt] = useState(() => crypto.randomUUID());

  useEffect(() => {
    api('/api/operations/catalog').then(catalog => {
      setData(catalog);
      if (location.hash.startsWith('#cart=')) {
        const restored = cartFromFragment(location.hash, catalog);
        setCart(restored.cart);
        const first = catalog.products.find(product => restored.cart[product.id]);
        if (first) setGroupId(first.group_id);
        if (restored.errors.length) setError(restored.errors.join(' '));
        history.replaceState(null, '', location.pathname);
      }
    }).catch(err => setError(err.message));
  }, []);

  const groupProducts = (data?.products ?? []).filter(product => product.group_id === groupId);
  const matches = visibleCatalogProducts(data, search, groupId);
  const cartSummary = selectedGroupCart(data?.products, cart, groupId);
  const otherGroupItems = (data?.products ?? []).filter(product =>
    product.group_id !== groupId && Number(cart[product.id]) > 0
  );

  const changeQuantity = (product, value) => {
    const limit = product.quantity_limit || 99;
    const count = Math.max(0, Math.min(limit, Math.floor(Number(value) || 0)));
    setCart(current => ({ ...current, [product.id]: count }));
    setAttempt(crypto.randomUUID());
  };

  if (login && !token) {
    return <Login admin={false} ready={newToken => { ready(newToken); setLogin(false); }} />;
  }

  return <main className="customer pl3-shop">
    <div className="eyebrow">PETITE LUEUR PL</div>
    <h1>商品與團次</h1>
    <p className="shop-navigation">
      <a href="/account">查詢我的訂單</a> · <a href="/services">詢價／代下單／代付</a> ·
      {' '}<a href={PUBLIC_PROGRESS_URL} target="_blank" rel="noopener noreferrer">團次公開進度與公告 ↗</a>
    </p>

    <details className="panel shop-guide" id="purchase-guide">
      <summary>購物流程、兩階段付款與運費說明</summary>
      <ol>
        <li>選擇已公開的團次、商品款式與數量，確認商品款金額。</li>
        <li>使用訂購 Email 完成驗證後送出申請；不同團次分開成立訂單。</li>
        <li>結單並核對後，依個別通知支付第一階段商品款；匯款資料請向 PL 官方私訊索取。</li>
        <li>官方採購、海外到倉與運回台灣後，依實際境內運費、國際運費、包材、稅費與台灣配送費計算第二階段費用。</li>
        <li>以相同 Email 在「我的訂單」查詢進度及回報付款；付款回報仍須由主購核實入帳。</li>
      </ol>
      <p>國際運費依商品份數分攤，境內運費依件分攤；預購發售及特典以官方實際公告與採購結果為準。若需純代下單、代付或轉運，請使用<a href="/services">委託服務入口</a>。</p>
      <p className="muted">拆團角色名額的即時表尚在移轉核對，避免顯示過期數量；可先查看上方公開團次進度，認領前請向 PL 確認。</p>
    </details>

    {error && <p className="error" role="alert">{error}</p>}

    {result ? <section className="panel">
      <h2>訂單已成立</h2>
      <p>{result.result.order_id}</p>
      <p>商品款 {money(cartSummary.total)}，後續運費及實際分攤另計。結單後會提供第一階段付款通知。</p>
      <a href="/account">以訂購 Email 查單及回報付款</a>
      {otherGroupItems.length > 0 && <button className="secondary" onClick={() => {
        const remaining = Object.fromEntries(Object.entries(cart).filter(([id]) =>
          !groupProducts.some(product => product.id === id)
        ));
        setCart(remaining);
        setGroupId(otherGroupItems[0].group_id);
        setSearch('');
        setResult(null);
        setAttempt(crypto.randomUUID());
        setAdult(false);
        setTerms(false);
      }}>繼續確認其他團次商品</button>}
    </section> : <>
      <p>不同團次請逐團確認；每團各自建立訂單與付款通知。</p>
      <Input label="搜尋商品、角色、規格或團次" type="search" value={search}
        placeholder="輸入作品、角色、商品名稱、貨號…"
        onChange={event => setSearch(event.target.value)} />
      <Input label="選擇團次" value={groupId}
        options={[["", "請選擇團次"], ...(data?.groups ?? []).map(g => [g.id, g.title])]}
        onChange={event => { setGroupId(event.target.value); setAttempt(crypto.randomUUID()); }} />

      {data && !data.groups.length && <Empty>目前沒有已核准且仍在收單期間的商品。</Empty>}
      {data && search.trim() && <p className="muted" role="status">符合搜尋的商品：{matches.length} 款</p>}

      {!groupId && search.trim() && matches.map(product => <section className="panel shop-result" key={product.id}>
        <div>
          <small>{data.groups.find(g => g.id === product.group_id)?.title}</small>
          <h2>{product.name}</h2>
          <p>{product.variant} · {product.sku}</p>
          <strong>{money(product.price_twd)}</strong>
        </div>
        <button className="secondary" onClick={() => { setGroupId(product.group_id); setAttempt(crypto.randomUUID()); }}>選擇此團次商品</button>
      </section>)}

      {groupId && matches.map(product => <section className="panel shop-product" key={product.id}>
        {product.image_url && <img src={product.image_url} alt={product.name} loading="lazy" />}
        <div>
          <h2>{product.name}</h2>
          <p>{product.variant} · {product.sku}</p>
          <b>{money(product.price_twd)}</b>
          <Input label="數量" type="number" min="0" max={product.quantity_limit || 99}
            value={cart[product.id] || 0} onChange={event => changeQuantity(product, event.target.value)} />
        </div>
      </section>)}
      {groupId && data && !matches.length && <Empty>這個團次沒有符合搜尋條件的商品；可清除搜尋字詞。</Empty>}

      {cartSummary.total > 0 && <section className="panel shop-checkout">
        <h2>本團商品款合計 {money(cartSummary.total)}</h2>
        <p>已選 {cartSummary.products.length} 款、共 {cartSummary.quantity} 件（即使搜尋隱藏已選商品，也不會從購物車移除）。</p>
        <ul>{cartSummary.products.map(product => <li key={product.id}>
          {product.name} {product.variant} × {cart[product.id]} · {money(product.price_twd * cart[product.id])}
        </li>)}</ul>
        <p>後續運費、包材與實際稅費於二補結算。付款資料請向官方索取。</p>
        <Input label="訂購姓名" value={name} onChange={event => { setName(event.target.value); setAttempt(crypto.randomUUID()); }} />
        <label className="check"><input type="checkbox" checked={adult} onChange={event => setAdult(event.target.checked)} />我已滿18歲</label>
        <label className="check"><input type="checkbox" checked={terms} onChange={event => setTerms(event.target.checked)} />我確認本次商品規格、金額及兩階段付款方式，預購出貨以官方實際進度為準</label>
        {cartSummary.total > 22000 && <p className="error">本團商品款超過單筆 NT$22,000 的刷卡上限，請調整數量或私訊詢問。</p>}
        <button disabled={busy || !name.trim() || !adult || !terms || cartSummary.total > 22000} onClick={async () => {
          if (!token) { setLogin(true); return; }
          setBusy(true); setError('');
          try {
            setResult(await api('/api/operations/checkout', {
              key: attempt, name, group_id: groupId,
              adult_confirmed: adult, terms_confirmed: terms,
              items: cartSummary.products.map(product => ({ product_id: product.id, quantity: cart[product.id] })),
            }, token));
          } catch (err) { setError(err.message); }
          finally { setBusy(false); }
        }}>{busy ? '送出中…' : token ? '確認並成立訂單' : '驗證 Email 後成立訂單'}</button>
      </section>}
    </>}
  </main>;
}
