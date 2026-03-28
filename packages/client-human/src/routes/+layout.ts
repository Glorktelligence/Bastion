// Disable SSR for the entire app.
// Bastion is a real-time WebSocket client — SSR provides no benefit and causes
// store singleton issues (SvelteKit SSR creates fresh module scope per render,
// destroying client-side store state on navigation).
export const ssr = false;
