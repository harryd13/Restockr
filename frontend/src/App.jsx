import React, { useEffect, useState } from "react";
import axios from "axios";
import BranchRequests from "./pages/BranchRequests";
import OpsPurchaseRun from "./pages/OpsPurchaseRun";
import Insights from "./pages/Insights";
import AdminMasterData from "./pages/AdminMasterData";
import LoginScreen from "./components/LoginScreen";
import TopNav from "./components/TopNav";
import Modal from "./components/Modal";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

axios.defaults.baseURL = API_BASE;

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState("");
  const [activeTab, setActiveTab] = useState("main");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("foffee_auth");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed?.token && parsed?.user) {
          setUser(parsed.user);
          setToken(parsed.token);
          axios.defaults.headers.common["Authorization"] = `Bearer ${parsed.token}`;
        }
      } catch (e) {
        localStorage.removeItem("foffee_auth");
      }
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError("");
    setIsLoggingIn(true);
    const form = new FormData(e.target);
    const email = form.get("email");
    const password = form.get("password");
    try {
      const res = await axios.post("/api/login", { email, password });
      setUser(res.data.user);
      setToken(res.data.token);
      axios.defaults.headers.common["Authorization"] = `Bearer ${res.data.token}`;
      localStorage.setItem("foffee_auth", JSON.stringify({ user: res.data.user, token: res.data.token }));
    } catch (err) {
      setLoginError("Login failed. Please check your email and password.");
      console.error(err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const logout = () => {
    setUser(null);
    setToken("");
    delete axios.defaults.headers.common["Authorization"];
    localStorage.removeItem("foffee_auth");
  };

  if (!user) {
    return (
      <>
        <LoginScreen onLogin={handleLogin} isLoggingIn={isLoggingIn} />
        <Modal
          open={!!loginError}
          title="Could not sign in"
          onClose={() => setLoginError("")}
          actions={
            <button type="button" className="btn btn-primary" onClick={() => setLoginError("")}>
              Try again
            </button>
          }
        >
          {loginError}
        </Modal>
      </>
    );
  }

  return (
    <div className="app-shell">
      <div className="app-container">
        <TopNav
          rightSlot={
            <>
              <div className="topnav__user">
                <div style={{ fontWeight: 600 }}>{user.name}</div>
                <span>
                  {user.role}
                  {user.branchId ? ` • ${user.branchId}` : ""}
                </span>
              </div>
              <button className="btn btn-secondary" onClick={logout}>
                Logout
              </button>
            </>
          }
        />

        <nav className="tabs">
          {user.role === "BRANCH" && (
            <button className={`tab ${activeTab === "branch" ? "tab--active" : ""}`} onClick={() => setActiveTab("branch")}>
              Branch Requests
            </button>
          )}
          {(user.role === "OPS" || user.role === "ADMIN") && (
            <button className={`tab ${activeTab === "ops" ? "tab--active" : ""}`} onClick={() => setActiveTab("ops")}>
              Purchase Run
            </button>
          )}
          {(user.role === "OPS" || user.role === "ADMIN") && (
            <button className={`tab ${activeTab === "insights" ? "tab--active" : ""}`} onClick={() => setActiveTab("insights")}>
              Insights
            </button>
          )}
          {user.role === "ADMIN" && (
            <button className={`tab ${activeTab === "admin" ? "tab--active" : ""}`} onClick={() => setActiveTab("admin")}>
              Master Data
            </button>
          )}
        </nav>

        <main style={{ marginTop: "1rem" }}>
          {user.role === "BRANCH" && activeTab === "branch" && <BranchRequests />}
          {(user.role === "OPS" || user.role === "ADMIN") && activeTab === "ops" && <OpsPurchaseRun />}
          {(user.role === "OPS" || user.role === "ADMIN") && activeTab === "insights" && <Insights />}
          {user.role === "ADMIN" && activeTab === "admin" && <AdminMasterData />}

          {activeTab === "main" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {user.role === "BRANCH" && <BranchRequests />}
              {(user.role === "OPS" || user.role === "ADMIN") && <OpsPurchaseRun />}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
