export function normalizeCatalogSearch(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('zh-Hant').trim().replace(/\s+/g, ' ');
}

export function catalogProductMatches(product, group, search) {
  const terms = normalizeCatalogSearch(search).split(' ').filter(Boolean);
  if (!terms.length) return true;
  const text = normalizeCatalogSearch([
    product.name,
    product.variant,
    product.sku,
    group?.title,
  ].join(' '));
  return terms.every(term => text.includes(term));
}

export function visibleCatalogProducts(catalog, search, groupId = '') {
  const groups = new Map((catalog?.groups ?? []).map(group => [group.id, group]));
  return (catalog?.products ?? []).filter(product =>
    (!groupId || product.group_id === groupId) &&
    groups.has(product.group_id) &&
    catalogProductMatches(product, groups.get(product.group_id), search)
  );
}

export function selectedGroupCart(products, cart, groupId) {
  const selected = (products ?? []).filter(product =>
    product.group_id === groupId && Number(cart?.[product.id]) > 0
  );
  return {
    products: selected,
    quantity: selected.reduce((total, product) => total + Number(cart[product.id]), 0),
    total: selected.reduce((total, product) => total + Number(cart[product.id]) * Number(product.price_twd), 0),
  };
}
