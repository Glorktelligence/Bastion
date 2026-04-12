// Admin UI is purely client-side — disable SSR (fetches data from admin API at runtime).
// adapter-static with fallback: 'index.html' needs prerender=true on root layout
// to generate the SPA shell. All routes resolve client-side.
export const ssr = false;
export const prerender = true;
