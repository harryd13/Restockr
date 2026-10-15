import React from "react";

function Modal({ open, title, children, onClose, actions }) {
  if (!open) return null;

  const stopPropagation = (e) => e.stopPropagation();

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 1200,
        padding: "1rem",
        overflowY: "auto"
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={stopPropagation}
        style={{
          background: "#fff",
          borderRadius: "1rem",
          width: "min(460px, 100%)",
          maxHeight: "calc(100vh - 2rem)",
          overflowY: "auto",
          padding: "1.5rem",
          boxShadow: "0 25px 60px rgba(15, 23, 42, 0.35)"
        }}
      >
        {title && (
          <h4 className="section-title" style={{ marginBottom: "0.5rem" }}>
            {title}
          </h4>
        )}
        <div style={{ marginBottom: "1.25rem", color: "#475569" }}>{children}</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem" }}>
          {actions || (
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default Modal;
