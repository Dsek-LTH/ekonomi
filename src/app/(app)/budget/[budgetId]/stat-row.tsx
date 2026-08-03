// Consistent metric-tile row. Auto-fits any number of tiles to equal-width
// columns so summaries line up the same on every page.
export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    // 200px, not 170: the figures are set at 24px now, and a six-figure belopp
    // with its öre and "kr" runs past what a 170px column left after padding.
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
      {children}
    </div>
  );
}
