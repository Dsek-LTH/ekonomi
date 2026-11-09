"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="sv">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          background: "#fff",
          color: "#171319",
        }}
      >
        <main style={{ maxWidth: "32rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>Något gick fel</h1>
          <p style={{ margin: "0.5rem 0 0", color: "#6b6470", fontSize: "0.9375rem" }}>
            Appen kunde inte starta. Försök igen, står det kvar, hör av dig till skattmästeriet.
          </p>
          <p style={{ margin: "1.25rem 0 0", color: "#6b6470", fontSize: "0.875rem" }}>
            Something went wrong and the app could not start.
          </p>
          {error.digest && (
            <p style={{ margin: "1rem 0 0", color: "#6b6470", fontSize: "0.75rem" }}>
              Referens: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.5rem",
              padding: "0.625rem 1.25rem",
              borderRadius: "9999px",
              border: "1px solid #ef678d",
              background: "#f280a1",
              color: "#17111a",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Försök igen / Try again
          </button>
        </main>
      </body>
    </html>
  );
}
