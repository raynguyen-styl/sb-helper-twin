// Login against the SHARED IoT-platform Keycloak (realm styl-iot), mirroring the tree-digital-twin
// frontend. The dashboard carries real (hashed) card/device/user ids, so live deployments MUST gate
// it — set VITE_KEYCLOAK_URL and the browser is forced through Keycloak login before anything loads.
// If unset (local dev, before the client exists), it degrades to a no-token stub so the app still runs.
//
// The client id defaults to `smart-buddy` — register that client in the Keycloak admin console and
// add it to the platform's JWT_ALLOWED_CLIENTS, exactly like the other demos (nparks-tree-twin, …).
import Keycloak from 'keycloak-js';

const CFG = {
  url: import.meta.env.VITE_KEYCLOAK_URL || '',
  realm: import.meta.env.VITE_KEYCLOAK_REALM || 'styl-iot',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'smart-buddy',
};

let kc = null;
let _resolve;
// Resolves once auth is settled (token present, or a stub in dev). sbApi.js awaits this before any
// call so a request never races ahead of the token.
export const authReady = new Promise((r) => { _resolve = r; });

export async function initAuth() {
  if (!CFG.url) {
    console.warn('[auth] Keycloak disabled (no VITE_KEYCLOAK_URL) — running without login (dev only).');
    _resolve({ token: null, username: 'dev' });
    return;
  }
  kc = new Keycloak({ url: CFG.url, realm: CFG.realm, clientId: CFG.clientId });
  try {
    await kc.init({ onLoad: 'login-required', checkLoginIframe: false, pkceMethod: 'S256' });
    // Refresh the access token before it expires so long dashboard sessions keep working.
    setInterval(() => { kc.updateToken(60).catch(() => {}); }, 60_000);
    _resolve({ token: kc.token, username: kc.tokenParsed?.preferred_username || 'user' });
  } catch (err) {
    console.error('[auth] Keycloak init failed; continuing without auth:', err);
    _resolve({ token: null, username: 'dev' });
  }
}

export function authToken() {
  return kc?.token || null;
}

// Logged-in username for the nav badge (preferred_username, else name). null when auth is disabled.
export function authUser() {
  return kc?.tokenParsed?.preferred_username || kc?.tokenParsed?.name || null;
}

// Roles from the token (realm + client), lowercased — used to gate admin-only UI.
export function authRoles() {
  const t = kc?.tokenParsed || {};
  const realm = t.realm_access?.roles || [];
  const client = Object.values(t.resource_access || {}).flatMap((r) => r.roles || []);
  return [...realm, ...client].map((r) => String(r).toLowerCase());
}

export function logout() {
  if (kc) kc.logout({ redirectUri: window.location.origin });
  else window.location.reload();
}
