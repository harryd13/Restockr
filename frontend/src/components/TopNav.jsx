import React from "react";

function TopNav({ rightSlot, navSlot, onMenuClick }) {
  return (
    <nav className="topnav">
      <div className="topnav__left">
        {onMenuClick && (
          <button type="button" className="nav-toggle" onClick={onMenuClick} aria-label="Open navigation">
            ☰
          </button>
        )}
        <span className="topnav__brand">FOFFEE</span>
        {navSlot}
      </div>
      <div className="topnav__meta">{rightSlot}</div>
    </nav>
  );
}

export default TopNav;
