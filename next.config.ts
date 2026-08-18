import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

// Sent on every response. The app holds receipts and members' financial data,
// so the browser is told what it may do with a page from here rather than left
// to its defaults.
//
// script-src is deliberately absent. A CSP worth having would have to allow the
// inline theme script in app/layout.tsx and the ones Next emits for hydration,
// and the only way to do that without 'unsafe-inline' — which would make the
// directive decorative — is a per-request nonce, which a static header cannot
// carry. The directives below are the ones that are worth something without it.
const SECURITY_HEADERS = [
  // Never let the browser second-guess a Content-Type. This is what keeps an
  // uploaded receipt from being sniffed into something executable — see the
  // magic-byte check in api/expenses/[id]/receipts.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Two years, subdomains included. Only ever sent over HTTPS, so it has no
  // effect on local development.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // A receipt URL should not travel to another site as a Referer.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here is meant to be embedded. frame-ancestors is the modern spelling;
  // X-Frame-Options stays for browsers that only read that one.
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: [
      "frame-ancestors 'none'",
      "object-src 'none'", // no plugin content, whatever a MIME type claims
      "base-uri 'none'", // an injected <base> can't repoint relative URLs
      "form-action 'self'", // a form here posts here
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Emit .next/standalone: server.js plus only the node_modules the traced
  // build actually reaches. That is what the Docker image ships — the
  // alternative is copying a 700 MB node_modules into the runtime image to run
  // `next start`. Harmless outside Docker; `next dev` and `next start` ignore it.
  output: "standalone",
  // Native modules — don't bundle them; load them from node_modules. Both ship
  // a platform-specific `.node` binary, which Turbopack cannot place in a
  // JavaScript chunk and refuses outright ("non-ecmascript placeable asset").
  //
  // sharp normalises uploaded receipts; the typst compiler typesets the
  // utläggsräkning (src/lib/expense/cover/typst.ts).
  serverExternalPackages: ["sharp", "@myriaddreamin/typst-ts-node-compiler"],
  experimental: {
    // Turbopack's on-disk dev cache, on by default in Next 16. Off here because
    // it has handed us a stale stylesheet: a new route's utilities never made it
    // into the compiled CSS, the chunk kept its old bytes across every restart,
    // and the page rendered with classes that had no rules behind them — the
    // kind of bug you debug in the wrong place for an hour, because restarting
    // is exactly what should have cleared it.
    //
    // The cost is a slower cold `next dev`; nothing recompiles differently once
    // it is up, and the production build has its own flag
    // (turbopackFileSystemCacheForBuild), which is off by default anyway.
    turbopackFileSystemCacheForDev: false,
  },
  allowedDevOrigins: ['192.168.1.76'],
  // The framework's version is not the visitor's business.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
}

export default withNextIntl(nextConfig);
