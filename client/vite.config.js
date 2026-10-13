import { defineConfig } from 'vite';

// Pinned to its own port so it never collides with the tree-digital-twin
// frontend (which uses Vite's default 5173). strictPort makes Vite fail
// loudly instead of silently hopping back onto a port another project uses.
export default defineConfig({
    server: { port: 5188, strictPort: true },
    preview: { port: 5189, strictPort: true },
});
