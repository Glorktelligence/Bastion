import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html',
      precompress: false,
    }),
    // SvelteKit emits the SPA bootloader as an inline <script>. With hash-mode
    // CSP, the build computes its SHA-256 and embeds it in a <meta> CSP tag
    // inside the generated index.html — so script-src can stay at 'self' + the
    // hash without an 'unsafe-inline' loophole. The relay's AdminServer sends
    // its own (stricter) CSP on API responses; this one binds the HTML doc.
    csp: {
      mode: 'hash',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self', 'unsafe-inline'],
        'img-src': ['self', 'data:'],
        'connect-src': ['self'],
        'frame-ancestors': ['none'],
        'base-uri': ['none'],
        'form-action': ['self'],
      },
    },
  },
};

export default config;
