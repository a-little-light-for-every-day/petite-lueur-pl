// The customer OTP proof is valid for one hour. Keep the signed credential in
// a host-only HttpOnly cookie so navigating /shop, /account and /services does
// not require another email. Never persist it in JavaScript-readable storage.
const COOKIE = '__Host-pl3_customer';
export const CUSTOMER_SESSION_SECONDS = 3600;

export function customerSessionCookie(token) {
  return COOKIE + '=' + token + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + CUSTOMER_SESSION_SECONDS;
}

export function readCustomerSessionCookie(request) {
  const entry = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='));
  const token = entry?.slice(COOKIE.length + 1) || '';
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

export function clearCustomerSessionCookie() {
  return COOKIE + '=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}
