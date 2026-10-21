// The apps' Content-Security-Policy. GitHub Pages cannot send response headers, so the build adds
// the policy to each app page as a <meta> element (vite.shared.js). A <meta> policy cannot carry
// frame-ancestors; otherwise it matches the policy scripts/nginx.conf sends for the full-stack
// apps, which tests/shared-copies.node.mjs checks.
//
// Scripts, styles and workers come only from the site, except that ArcGIS starts workers from blob:
// URLs and both map libraries compile WebAssembly. Map data comes from the ArcGIS hosts and fonts
// from Google Fonts. 'unsafe-inline' covers style attributes and elements the map libraries set;
// scripts never run inline or through eval.
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://js.arcgis.com https://static.arcgis.com https://services.arcgisonline.com https://server.arcgisonline.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'"
].join('; ');

// ArcGIS tests whether the policy allows eval by calling Function() once, which the browser reports
// as a violation; ArcGIS then avoids eval. A check of the running apps excuses only that report.
export const ARCGIS_EVAL_TEST = 'esri-csp-restrictions';
export const isArcgisEvalTest = (violation, scriptText) =>
  violation.effectiveDirective === 'script-src' && violation.blockedURI === 'eval' && scriptText.includes(ARCGIS_EVAL_TEST);
