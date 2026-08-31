// The tab /approvals opens on, in a module of its own, deliberately not in
// approvals-client.tsx.
//
// Both halves need it: the page hands it to `parseListQuery` so the query it
// runs matches, and the client hands it to `useUrlTableControls` so the tab
// drawn as active matches. It used to be declared in the client file and
// imported from there by the page, which is a Server Component reading a value
// across the "use client" boundary, and that boundary does not carry values.
// Next replaces every export of a client module with a client *reference*, so
// what arrived on the server was an opaque proxy rather than the string
// "PENDING".
//
// It failed quietly, in the one place it could do the most damage. The proxy is
// truthy, so `parseListQuery` took it as the tab; no key in STATUS_TAB matched
// it, so no status filter went into the query at all; and DataTable draws its
// first tab as active whenever the current value matches no option, so the
// first load of the attest queue listed every utlägg in the section, in every
// state including drafts, under a highlighted "Väntar". Touching any tab put a
// real value in the URL and the page corrected itself, which is why it only
// ever looked wrong on arrival.
export const APPROVALS_DEFAULT_TAB = "PENDING";
