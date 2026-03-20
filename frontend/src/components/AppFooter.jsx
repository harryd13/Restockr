import React from "react";
import pkg from "../../package.json";

function AppFooter() {
  const version = "3.26.1";
  const year = new Date().getFullYear();

  return <footer className="app-footer">v{version} · © {year} Restockr</footer>;
}

export default AppFooter;
