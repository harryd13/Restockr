import React from "react";

function TopNav({ rightSlot }) {
  return (
    <nav className="topnav">
      <span className="topnav__brand">FOFFEE™</span>
      <div className="topnav__meta">{rightSlot}</div>
    </nav>
  );
}

export default TopNav;

