import React, { useState } from "react";
import "./LoginScreen.css";

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M14 6l6 6-6 6" /></svg>;
}

function EyeIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" style={{ position: "static", display: "block", margin: "auto", transform: "none" }}><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.7" /></svg>;
}

function LoginScreen({ onLogin, isLoggingIn }) {
  const [passwordVisible, setPasswordVisible] = useState(false);

  return (
    <main className="login-screen">
      <section className="login-panel" aria-label="Tickstock login">
        <header className="login-header">
          <img className="login-logo" src="/icons/ticStockLogo.png" alt="Tickstock" />
          <a className="login-back" href="#home"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12H4M10 6l-6 6 6 6" /></svg><span>Back to home</span></a>
        </header>

        <div className="login-layout">
          <aside className="login-visual" aria-hidden="true">
            <div className="login-intro">
              <h1>Less chaos.<br />More coffee.</h1>
              <p>Your café, organised in one place.</p>
            </div>
            <div className="login-art">
              <img className="login-art__rects" src="/login-assets/rects.png" alt="" />
              <img className="login-art__boxes" src="/login-assets/boxes.png" alt="" />
              <img className="login-art__cup" src="/login-assets/cup.png" alt="" />
              <img className="login-art__pad" src="/login-assets/letterpad.png" alt="" />
              <img className="login-art__beans" src="/login-assets/beans.png" alt="" />
            </div>
          </aside>

          <div className="login-form-wrap">
            <div className="login-form-heading">
              <h2>Welcome back</h2>
              <p>Log in to manage your café.</p>
            </div>
            <form className="login-form" id="login-form" onSubmit={onLogin}>
              <label>
                <span>Email</span>
                <input name="email" type="email" placeholder="you@example.com" disabled={isLoggingIn} required />
              </label>
              <label>
                <span>Password</span>
                <div className="login-password-field">
                  <input name="password" type={passwordVisible ? "text" : "password"} placeholder="Enter your password" disabled={isLoggingIn} required />
                  <button
                    type="button"
                    className="login-password-toggle"
                    onClick={() => setPasswordVisible((visible) => !visible)}
                    aria-label={passwordVisible ? "Hide password" : "Show password"}
                    aria-pressed={passwordVisible}
                    style={{ position: "absolute", top: "50%", right: 12, width: 40, height: 40, padding: 0, border: 0, borderRadius: 9, transform: "translateY(-50%)", color: "#52658d", background: "transparent", cursor: "pointer" }}
                  >
                    <EyeIcon />
                  </button>
                </div>
              </label>
              <button type="submit" className="login-submit" disabled={isLoggingIn}>
                {isLoggingIn ? <><span className="spinner" aria-hidden="true" />Signing in...</> : <>Log in <ArrowIcon /></>}
              </button>
            </form>
          </div>
        </div>

        <footer className="login-footer"><a href="#privacy">Privacy</a><i /> <a href="#terms">Terms</a></footer>
      </section>
    </main>
  );
}

export default LoginScreen;
