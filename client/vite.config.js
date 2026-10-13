import { defineConfig } from 'vite';

// Pinned to its own port so it never collides with the tree-digital-twin
// frontend (which uses Vite's default 5173). strictPort makes Vite fail
// loudly instead of silently hopping back onto a port another project uses.
//
// /solace mirrors client/nginx.conf: the app's default Solace URL is same-origin
// /solace, so in dev it is proxied to the shared broker's Web Messaging port that
// atlantic-platform/common publishes on loopback (SOLACE_WEB_MESSAGING_PORT, default 8008).
const solaceWebMessaging = `http://127.0.0.1:${process.env.SOLACE_WEB_MESSAGING_PORT || 8008}`;
const solaceProxy = { '/solace': { target: solaceWebMessaging, ws: true, changeOrigin: true } };

export default defineConfig({
    server: { port: 5188, strictPort: true, proxy: solaceProxy },
    preview: { port: 5189, strictPort: true, proxy: solaceProxy },
});
