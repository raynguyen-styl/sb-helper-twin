// Login through the STYL CIAM realm (central-specs decision 0003, change ciam-keycloak-login), ported
// from Bibo Bus's twin (uwb/transit/bibo-bus/twin/src/auth/authInit.js) so both demos log in the same
// way. keycloak-js gets the realm's discovery document as its provider, with the token endpoint
// pointed at this container's own nginx (`/auth/token`): the client `demo-application` is
// confidential, and the proxy adds its secret on the way (client/docker/40-keycloak-token-proxy.sh).
// The browser never holds the secret.
//
// Enabled ONLY when VITE_KEYCLOAK_ENABLED === 'true' (bootstrap-env.sh writes it for the VM build).
// Local `npm run dev` leaves it off: the Vite dev server has no token proxy. The read API is not
// token-checked (decision 0003), so this login is the only gate — it fails CLOSED: initAuth() rejects
// and main.js shows a notice instead of booting.
import Keycloak from 'keycloak-js';

const ENABLED = import.meta.env.VITE_KEYCLOAK_ENABLED === 'true';
const CFG = {
  oidcConfigUrl: import.meta.env.VITE_KEYCLOAK_OIDC_CONFIG_URL
    || 'https://ciam-uat.styl.solutions/realms/demo/.well-known/openid-configuration',
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'demo-application',
  tokenProxy: import.meta.env.VITE_KEYCLOAK_TOKEN_PROXY ?? 'auth/token',
};

let kc = null;
let persist = () => {};                              // set by initAuth: save the tab's tokens
let clearStored = () => {};

// True if a JWT is still valid for at least `skewSec` more seconds.
function isJwtUsable(jwt, skewSec = 15) {
  try {
    const json = atob(String(jwt).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json);
    return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now() + skewSec * 1000;
  } catch {
    return false;
  }
}

// The realm's issuer from its discovery URL (either form is accepted).
const issuerOf = (url) => String(url ?? '').trim()
  .replace(/\/\.well-known\/openid-configuration\/?$/, '').replace(/\/$/, '');

// The realm's discovery document, with `token_endpoint` replaced by the token proxy (a path relative
// to the app's base). Authorization and end-session stay Keycloak's own endpoints.
async function discover(issuer) {
  const res = await fetch(`${issuer}/.well-known/openid-configuration`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`OIDC discovery HTTP ${res.status}`);
  const config = await res.json();
  if (CFG.tokenProxy) {
    config.token_endpoint = new URL(CFG.tokenProxy, new URL(import.meta.env.BASE_URL || '/', window.location.origin)).href;
  }
  return config;
}

// Settles with { username } once signed in (null when the login is disabled). Never settles while
// the browser is being sent to the CIAM login page; rejects when sign-in cannot start.
export async function initAuth() {
  if (!ENABLED) {
    console.warn('[auth] login disabled (VITE_KEYCLOAK_ENABLED is not "true") — local dev only.');
    return { username: null };
  }
  const issuer = issuerOf(CFG.oidcConfigUrl);
  kc = new Keycloak({ oidcProvider: await discover(issuer), clientId: CFG.clientId });
  // Always return to the bare origin: Keycloak matches a client's redirect URIs exactly, and
  // keycloak-js would otherwise send the full href (hash routes and all).
  const redirectUri = window.location.origin;

  // Keep the tokens for the tab, so a reload resumes the session instead of redirecting.
  const STORE_KEY = `kc-tokens:${issuer}:${CFG.clientId}`;
  persist = () => {
    try {
      if (kc.token && kc.refreshToken) {
        sessionStorage.setItem(STORE_KEY, JSON.stringify({ token: kc.token, refreshToken: kc.refreshToken, idToken: kc.idToken }));
      }
    } catch { /* storage unavailable — the session just won't survive a reload */ }
  };
  clearStored = () => { try { sessionStorage.removeItem(STORE_KEY); } catch { /* ignore */ } };

  let stored = null;
  try { stored = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null'); } catch { stored = null; }
  // Resume only while the REFRESH token is valid — an expired one makes init post a doomed refresh.
  const canUseStored = !!(stored?.token && stored.refreshToken && isJwtUsable(stored.refreshToken));
  if (stored && !canUseStored) clearStored();

  await kc.init({
    onLoad: 'check-sso',
    pkceMethod: 'S256',
    checkLoginIframe: false,
    redirectUri,
    scope: 'openid',
    ...(canUseStored ? { token: stored.token, refreshToken: stored.refreshToken, idToken: stored.idToken } : {}),
  });

  if (!kc.authenticated) {
    kc.login({ redirectUri });
    return new Promise(() => {});                    // the page is navigating away; nothing boots
  }

  persist();
  kc.onAuthSuccess = persist;
  kc.onAuthRefreshSuccess = persist;
  kc.onAuthLogout = clearStored;
  kc.onTokenExpired = () => {
    kc.updateToken(30).then(persist).catch(() => { clearStored(); kc.login({ redirectUri }); });
  };
  return { username: authUser() };
}

// A token valid for at least 30 s more, refreshed through the proxy when needed. null when the login
// is disabled. A failed refresh clears the session and sends the browser back to login.
export async function validToken() {
  if (!kc) return null;
  try {
    await kc.updateToken(30);
    persist();
    return kc.token || null;
  } catch {
    clearStored();
    kc.login({ redirectUri: window.location.origin });
    return null;
  }
}

// Who is signed in, for the nav menu: email, else username. null when the login is disabled.
export function authUser() {
  return kc?.tokenParsed?.email || kc?.tokenParsed?.preferred_username || null;
}

// Clears the tab's tokens and ends the CIAM session, returning to the bare origin.
export function logout() {
  if (!kc) { window.location.reload(); return; }
  clearStored();
  kc.logout({ redirectUri: window.location.origin });
}
