import React from "react";
import TopNav from "./TopNav";

function LoginScreen({ onLogin }) {
  const focusLoginForm = () => {
    const form = document.getElementById("login-form");
    if (form) {
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      form.querySelector("input")?.focus();
    }
  };

  return (
    <div className="app-shell" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "0 2rem" }}>
        <TopNav
          rightSlot={
            <button type="button" className="btn btn-primary" onClick={focusLoginForm}>
              Log In
            </button>
          }
        />
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem"
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            background: "#fff",
            borderRadius: "1.25rem",
            boxShadow: "0 18px 45px rgba(16, 24, 40, 0.12)",
            padding: "2.5rem"
          }}
        >
          <header style={{ marginBottom: "1.75rem" }}>
            <p
              style={{
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "#94a3b8",
                fontSize: "0.75rem",
                marginBottom: "0.35rem"
              }}
            >
              Welcome to
            </p>
            <h1 style={{ margin: 0, fontSize: "2rem", color: "#0f172a" }}>Foffee Inventory</h1>
            <p style={{ color: "#475569", marginTop: "0.5rem" }}>Sign in with a role-specific account to continue.</p>
          </header>

          <section style={{ marginBottom: "1.5rem", color: "#475569" }}>
            <strong style={{ display: "block", marginBottom: "0.35rem", color: "#0f172a" }}>Demo credentials</strong>
            <ul style={{ paddingLeft: "1.25rem", margin: 0, lineHeight: 1.6 }}>
              <li>Brahmpuri Branch: brahmpuri@foffee.in / branch123</li>
              <li>Ridhi-Sidhi Branch: ridhi@foffee.in / branch123</li>
              <li>Rajapark Branch: rajapark@foffee.in / branch123</li>
              <li>Ops: ops@foffee.in / ops123</li>
              <li>Admin: admin@foffee.in / admin123</li>
            </ul>
          </section>

          <form id="login-form" onSubmit={onLogin} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <label style={{ fontSize: "0.85rem", color: "#475569", fontWeight: 600 }}>Email</label>
              <input
                name="email"
                type="email"
                style={{
                  padding: "0.85rem 1rem",
                  borderRadius: "0.75rem",
                  border: "1px solid #cbd5f5",
                  fontSize: "1rem",
                  outline: "none",
                  transition: "border 0.2s"
                }}
                required
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <label style={{ fontSize: "0.85rem", color: "#475569", fontWeight: 600 }}>Password</label>
              <input
                name="password"
                type="password"
                style={{
                  padding: "0.85rem 1rem",
                  borderRadius: "0.75rem",
                  border: "1px solid #cbd5f5",
                  fontSize: "1rem",
                  outline: "none",
                  transition: "border 0.2s"
                }}
                required
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ marginTop: "0.5rem" }}>
              Continue
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default LoginScreen;

