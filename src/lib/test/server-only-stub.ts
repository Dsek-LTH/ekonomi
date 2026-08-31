// Stands in for the `server-only` package under Vitest, which resolves to it
// via vitest.config.mts. The real package throws when imported outside a React
// Server Component, which is exactly what makes server modules untestable,
// and a test runner is not the client bundle it exists to protect.
export {};
