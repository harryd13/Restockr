import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import Modal from "../components/Modal";

const CATEGORIES = ["Rent", "Electricity Bill", "Salary", "Food Expense", "Ice Cream", "Other"];
const ASSIGNEES = ["Vivek", "Harman", "Bhashit"];
const PAYMENT_METHODS = ["UPI", "Cash", "Paid by assignee"];

function ExpenseTickets() {
  const [branches, setBranches] = useState([]);
  const [category, setCategory] = useState("Rent");
  const [branchId, setBranchId] = useState("");
  const [assignee, setAssignee] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [attachmentName, setAttachmentName] = useState("");
  const [attachmentType, setAttachmentType] = useState("");
  const [attachmentData, setAttachmentData] = useState("");
  const [attachmentKey, setAttachmentKey] = useState(0);
  const [employeeName, setEmployeeName] = useState("");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [errorBanner, setErrorBanner] = useState("");
  const [successBanner, setSuccessBanner] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showBranchModal, setShowBranchModal] = useState(false);
  const [showAssigneeModal, setShowAssigneeModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showPaymentHint, setShowPaymentHint] = useState(false);

  useEffect(() => {
    loadBranches();
    if (!date) setDate(new Date().toISOString().slice(0, 10));
  }, []);

  const loadBranches = async () => {
    const res = await axios.get("/api/branches");
    setBranches(res.data || []);
    if (!branchId && res.data?.length) setBranchId(res.data[0].id);
  };

  const showEmployee = category === "Salary";
  const showSource = category === "Food Expense";
  const showNote = category === "Other";

  const canSubmit = useMemo(() => {
    if (!branchId || !assignee || !paymentMethod || !date) return false;
    if (Number(amount || 0) <= 0) return false;
    if (showEmployee && !employeeName.trim()) return false;
    if (showSource && !source.trim()) return false;
    return true;
  }, [branchId, assignee, paymentMethod, date, amount, showEmployee, employeeName, showSource, source]);

  const submit = async () => {
    setErrorBanner("");
    setSuccessBanner("");
    if (!canSubmit) {
      setErrorBanner("Please fill all required fields.");
      return;
    }
    try {
      setIsSubmitting(true);
      await axios.post("/api/expense-tickets", {
        category,
        branchId,
        assignee,
        paymentMethod,
        amount: Number(amount || 0),
        date,
        attachmentName,
        attachmentType,
        attachmentData,
        employeeName,
        source,
        note
      });
      setSuccessBanner("Expense ticket logged.");
      setAmount("");
      setAttachmentName("");
      setAttachmentType("");
      setAttachmentData("");
      setAttachmentKey((value) => value + 1);
      setEmployeeName("");
      setSource("");
      setNote("");
    } catch (err) {
      setErrorBanner("Could not log expense ticket.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAttachmentChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      setAttachmentName("");
      setAttachmentType("");
      setAttachmentData("");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setErrorBanner("Attachment must be under 2 MB.");
      event.target.value = "";
      setAttachmentName("");
      setAttachmentType("");
      setAttachmentData("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setAttachmentName(file.name);
      setAttachmentType(file.type);
      setAttachmentData(String(reader.result || ""));
    };
    reader.onerror = () => {
      setErrorBanner("Could not read attachment.");
      setAttachmentName("");
      setAttachmentType("");
      setAttachmentData("");
    };
    reader.readAsDataURL(file);
  };

  const handleKeyDown = (event) => {
    if (event.key !== "Enter") return;
    if (paymentMethod) return;
    event.preventDefault();
    setShowPaymentHint(true);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }} onKeyDown={handleKeyDown}>
      {errorBanner && (
        <div className="banner banner--warning">
          <strong>Warning:</strong> {errorBanner}
        </div>
      )}
      {successBanner && (
        <div className="banner banner--success">
          <strong>Success:</strong> {successBanner}
        </div>
      )}

      <section className="section-card expense-form" style={{ maxWidth: 540, width: "100%" }}>
        <h3 className="section-title">Expense Ticket</h3>
        <p className="muted-text">Log rent, utilities, salary, food, or other expenses.</p>

        <div style={{ display: "grid", gap: "0.75rem", marginTop: "1rem" }}>
          <label>
            <span className="muted-text field-label">Category</span>
            <button type="button" className="btn btn-secondary" onClick={() => setShowCategoryModal(true)}>
              {category}
            </button>
          </label>

          <label>
            <span className="muted-text field-label">Branch</span>
            <button type="button" className="btn btn-secondary" onClick={() => setShowBranchModal(true)}>
              {branches.find((b) => b.id === branchId)?.name || "Select branch"}
            </button>
          </label>

          <label>
            <span className="muted-text field-label">Assignee</span>
            <button type="button" className="btn btn-secondary" onClick={() => setShowAssigneeModal(true)}>
              {assignee || "Select assignee"}
            </button>
          </label>

          <label>
            <span className="muted-text field-label">Payment Method</span>
            <button
              type="button"
              className={`btn btn-secondary${showPaymentHint && !paymentMethod ? " field-error" : ""}`}
              onClick={() => setShowPaymentModal(true)}
            >
              {paymentMethod || "Select payment"}
            </button>
            {showPaymentHint && !paymentMethod && (
              <span className="field-hint field-hint--error">Select payment method first.</span>
            )}
          </label>

          <label>
            <span className="muted-text field-label">Date</span>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>

          <label>
            <span className="muted-text field-label">TRC (Amount)</span>
            <input className="input" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>

          {showEmployee && (
            <label>
              <span className="muted-text field-label">Employee Name</span>
              <input className="input" type="text" value={employeeName} onChange={(e) => setEmployeeName(e.target.value)} />
            </label>
          )}

          {showSource && (
            <label>
              <span className="muted-text field-label">Source</span>
              <input className="input" type="text" value={source} onChange={(e) => setSource(e.target.value)} />
            </label>
          )}

          {showNote && (
            <label>
              <span className="muted-text field-label">Note</span>
              <input className="input" type="text" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          )}

          <label>
            <span className="muted-text field-label">Attachment (optional)</span>
            <input
              key={attachmentKey}
              className="input"
              type="file"
              accept="image/*,application/pdf"
              onChange={handleAttachmentChange}
            />
            {attachmentName && <span className="muted-text">Selected: {attachmentName}</span>}
          </label>
        </div>

        <div style={{ marginTop: "1rem" }}>
          <button className="btn btn-primary" type="button" onClick={submit} disabled={isSubmitting || !canSubmit}>
            {isSubmitting ? "Saving..." : "Submit Ticket"}
          </button>
        </div>
      </section>

      <Modal
        open={showCategoryModal}
        title="Select category"
        onClose={() => setShowCategoryModal(false)}
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => setShowCategoryModal(false)}>
            Close
          </button>
        }
      >
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {CATEGORIES.map((item) => (
            <button
              key={item}
              type="button"
              className={item === category ? "btn btn-primary" : "btn btn-secondary"}
              onClick={() => {
                setCategory(item);
                setShowCategoryModal(false);
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={showBranchModal}
        title="Select branch"
        onClose={() => setShowBranchModal(false)}
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => setShowBranchModal(false)}>
            Close
          </button>
        }
      >
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {branches.map((b) => (
            <button
              key={b.id}
              type="button"
              className={b.id === branchId ? "btn btn-primary" : "btn btn-secondary"}
              onClick={() => {
                setBranchId(b.id);
                setShowBranchModal(false);
              }}
            >
              {b.name}
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={showAssigneeModal}
        title="Select assignee"
        onClose={() => setShowAssigneeModal(false)}
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => setShowAssigneeModal(false)}>
            Close
          </button>
        }
      >
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {ASSIGNEES.map((name) => (
            <button
              key={name}
              type="button"
              className={name === assignee ? "btn btn-primary" : "btn btn-secondary"}
              onClick={() => {
                setAssignee(name);
                setShowAssigneeModal(false);
              }}
            >
              {name}
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={showPaymentModal}
        title="Select payment method"
        onClose={() => setShowPaymentModal(false)}
        actions={
          <button type="button" className="btn btn-ghost" onClick={() => setShowPaymentModal(false)}>
            Close
          </button>
        }
      >
        <div style={{ display: "grid", gap: "0.5rem" }}>
          {PAYMENT_METHODS.map((method) => (
            <button
              key={method}
              type="button"
              className={method === paymentMethod ? "btn btn-primary" : "btn btn-secondary"}
              onClick={() => {
                setPaymentMethod(method);
                setShowPaymentHint(false);
                setShowPaymentModal(false);
              }}
            >
              {method}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

export default ExpenseTickets;
