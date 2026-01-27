import React from "react";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled UI error", error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { hasError } = this.state;
    if (!hasError) return this.props.children;

    return (
      <div className="app-shell">
        <div className="app-container">
          <section className="section-card" style={{ marginTop: "2rem" }}>
            <h3 className="section-title">We hit a snag</h3>
            <p className="muted-text">
              Something unexpected happened while loading this page. Please reload. If it keeps happening, contact the admin.
            </p>
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
              <button type="button" className="btn btn-primary" onClick={this.handleReload}>
                Reload
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
