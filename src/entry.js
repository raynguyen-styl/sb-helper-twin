// Entry point: sign in first (auth.js, the STYL CIAM login), then load the app. main.js starts the map,
// the data calls and the chat as soon as it is imported, so it is imported only once the login has
// settled. The read API is not token-checked (central-specs decision 0003), so this login is the only
// gate and it fails closed: if sign-in cannot start, the app is never loaded and a notice says so.
import { initAuth } from './auth.js';

function showSignInFailed(err) {
    console.error('[auth] sign-in failed:', err);
    const box = document.createElement('div');
    box.className = 'signin-failed';
    box.setAttribute('role', 'alert');
    const title = document.createElement('b');
    title.textContent = 'Sign-in failed';
    const msg = document.createElement('p');
    msg.textContent = 'The STYL login could not be reached, so the dashboard was not loaded. Reload to try again.';
    const again = document.createElement('button');
    again.type = 'button';
    again.textContent = 'Reload';
    again.addEventListener('click', () => window.location.reload());
    box.append(title, msg, again);
    document.querySelector('.stage')?.replaceChildren(box);
    document.querySelectorAll('.top > :not(.brand), #rail, #tabbar').forEach((el) => el.remove());   // nothing to act on
}

initAuth().then(() => import('./main.js'), showSignInFailed);
