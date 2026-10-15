import React from "react";
import "./TopNav.css";
import "./TopNavOverrides.css";
import "./TopNavBranchIdentity.css";
import "./TopNavMobile.css";
import "./TopNavTabFit.css";

function TopNav({ rightSlot, navSlot, onMenuClick, mobileSubtitle = "", mobileBranchName = "" }) {
  return (
    <nav className="topnav">
      <div className="topnav__identity">
        <img src="/icons/ticStockLogo.png" alt="Tickstock" />
        {(mobileBranchName || mobileSubtitle) && <span>{mobileBranchName ? `Foffee · ${mobileBranchName}` : mobileSubtitle}</span>}
      </div>
      <div className="topnav__divider" aria-hidden="true" />
      <div className="topnav__left">{navSlot}</div>
      <div className="topnav__meta">{rightSlot}</div>
      {onMenuClick && (
        <button type="button" className="nav-toggle" onClick={onMenuClick} aria-label="Open navigation">
          <i /><i /><i />
        </button>
      )}
    </nav>
  );
}

export default TopNav;
