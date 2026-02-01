import React from "react";
import pkg from "../../package.json";

function AppFooter() {
  const version = pkg.restockrVersion || pkg.version || "1.0.0";
  const year = new Date().getFullYear();

  return <footer className="app-footer">v{version} · © {year} Restockr</footer>;
}

export default AppFooter;
