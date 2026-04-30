import React from "react";
import pkg from "../../package.json";

function AppFooter() {
  const version = "4.26.2";
  const year = new Date().getFullYear();

  return <footer className="app-footer">v{version} · © {year} Restockr</footer>;
}

export default AppFooter;
