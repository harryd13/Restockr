import React, { useEffect, useRef } from "react";
import "./HomePage.css";

const inventoryRows = [
  { icon: "☕", item: "Coffee beans", category: "Beverages", branch: "Brahmpuri", stock: "248", status: "In stock", tone: "good" },
  { icon: "🥛", item: "Milk", category: "Dairy", branch: "Ridhi Sidhi", stock: "12", status: "Low stock", tone: "low" },
  { icon: "☕", item: "Cups (12oz)", category: "Packaging", branch: "All branches", stock: "1,204", status: "In stock", tone: "good" },
  { icon: "◒", item: "Sugar", category: "Ingredients", branch: "Brahmpuri", stock: "36", status: "In stock", tone: "good" },
  { icon: "▣", item: "Chocolate syrup", category: "Ingredients", branch: "Ridhi Sidhi", stock: "8", status: "Low stock", tone: "low" },
  { icon: "▤", item: "Paper bags", category: "Packaging", branch: "All branches", stock: "420", status: "In stock", tone: "good" }
];

function BrandMark() {
  return <img className="tickstock-mark" src="/icons/icon.png" alt="" aria-hidden="true" />;
}

function HomePage() {
  const showcaseRef = useRef(null);

  useEffect(() => {
    const showcase = showcaseRef.current;
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!showcase || prefersReducedMotion) return undefined;

    let animationFrame;
    const updateAccents = () => {
      animationFrame = undefined;
      const travel = window.innerWidth <= 760 ? 18 : 42;
      const progress = Math.min(window.scrollY / Math.max(window.innerHeight * 0.62, 1), 1);
      const offset = travel * (1 - progress);
      showcase.style.setProperty("--coral-accent-offset", `${-offset}px`);
      showcase.style.setProperty("--yellow-accent-offset", `${offset}px`);
    };
    const requestUpdate = () => {
      if (!animationFrame) animationFrame = window.requestAnimationFrame(updateAccents);
    };

    updateAccents();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return (
    <div className="website-shell">
      <header className="website-header">
        <a className="website-brand" href="#home" aria-label="Tickstock home">
          <img className="website-brand__logo" src="/icons/ticStockLogo.png" alt="Tickstock" />
        </a>
        <nav className="website-nav" aria-label="Public navigation">
          <a href="#product">Product</a>
          <a href="#pricing">Pricing</a>
          <a href="#about">About</a>
        </nav>
        <a className="website-login" href="#login">Log in <span aria-hidden="true">→</span></a>
      </header>

      <main>
        <section className="home-hero">
          <div className="home-hero__copy">
            <p className="home-eyebrow">Built for busy cafe teams</p>
            <h1>
              <span>Run your cafe,</span>
              <span>Without the chaos.</span>
            </h1>
            <p className="home-subtitle">Inventory, branches and daily operations — organised in one place.</p>
            <div className="home-actions">
              <a className="home-button home-button--primary" href="#login">Start free <span aria-hidden="true">→</span></a>
              <a className="home-button home-button--secondary" href="#login">Explore Inventory</a>
            </div>
            <p className="home-reassurance">Free plan available <span>•</span> No card required</p>
          </div>

          <div className="product-showcase" ref={showcaseRef} aria-label="Tickstock inventory interface preview">
            <div className="product-accent product-accent--coral" />
            <div className="product-accent product-accent--yellow" />
            <div className="laptop-frame">
              <div className="laptop-camera" />
              <div className="laptop-screen">
                <div className="preview-appbar">
                  <div className="preview-brand"><BrandMark /> <strong>Tickstock</strong></div>
                  <div className="preview-avatar">A</div>
                </div>
                <div className="preview-content">
                  <div className="preview-title-row"><h2>Inventory</h2><button type="button">⌖&nbsp; All branches <span>⌄</span></button></div>
                  <div className="preview-search">⌕ <span>Search items...</span></div>
                  <div className="preview-table">
                    <div className="preview-table__head"><span>Item</span><span>Category</span><span>Branch</span><span>Stock</span><span>Status</span></div>
                    {inventoryRows.map((row) => (
                      <div className="preview-row" key={row.item}>
                        <span className="preview-item"><i>{row.icon}</i><b>{row.item}</b></span>
                        <span>{row.category}</span><span>{row.branch}</span><strong>{row.stock}</strong>
                        <span><em className={`preview-status preview-status--${row.tone}`}><i />{row.status}</em></span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="laptop-base" />
            </div>

            <div className="phone-frame">
              <div className="phone-speaker" />
              <div className="phone-screen">
                <small>9:41</small><h3>Inventory</h3><div className="phone-search">⌕ &nbsp; Search items...</div>
                {inventoryRows.map((row) => <div className="phone-row" key={row.item}><i>{row.icon}</i><span><b>{row.item}</b><small>{row.stock} in stock</small></span><strong>›</strong></div>)}
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="website-footer">
        <div className="website-footer__inner">
          <div className="website-footer__brand">
            <img className="website-footer__logo" src="/icons/ticStockLogo.png" alt="Tickstock" />
            <p>Simple inventory and operations for the cafes people love to visit.</p>
            <div className="website-footer__socials" aria-label="Tickstock social links">
              <a href="mailto:hello@tickstock.app" aria-label="Email Tickstock">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 5.5h17v13h-17zM4.2 6.2 12 12l7.8-5.8" /></svg>
              </a>
              <a href="#home" aria-label="Follow Tickstock on Instagram">
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><circle cx="12" cy="12" r="3.8" /><circle cx="17.6" cy="6.6" r=".9" fill="currentColor" stroke="none" /></svg>
              </a>
              <a href="#home" aria-label="Follow Tickstock on LinkedIn">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.2 9.5v8.3M6.2 6.5v.1M10.2 17.8v-4.7c0-2.8 4.8-3 4.8 0v4.7M15 13v4.8" /></svg>
              </a>
            </div>
          </div>

          <div className="website-footer__links">
            <div>
              <h2>Explore</h2>
              <a href="#product">Product</a>
              <a href="#pricing">Pricing</a>
              <a href="#about">About us</a>
            </div>
            <div>
              <h2>Support</h2>
              <a href="mailto:hello@tickstock.app">Get in touch</a>
              <a href="mailto:support@tickstock.app">Help centre</a>
              <a href="mailto:feedback@tickstock.app">Share feedback</a>
            </div>
          </div>
        </div>
        <div className="website-footer__bottom">
          <span>© {new Date().getFullYear()} Tickstock. Made for better cafe days.</span>
          <div><a href="#privacy">Privacy</a><a href="#terms">Terms</a></div>
        </div>
      </footer>
    </div>
  );
}

export default HomePage;
