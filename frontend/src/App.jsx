import React, { useEffect, useState } from "react";
import axios from "axios";
import BranchRequests from "./pages/BranchRequests";
import DailyRequests from "./pages/DailyRequests";
import OtherRequests from "./pages/OtherRequests";
import OpsPurchaseRun from "./pages/OpsPurchaseRun";
import CombinedPurchaseRun from "./pages/CombinedPurchaseRun";
import DistributionRun from "./pages/DistributionRun";
import CentralInventory from "./pages/CentralInventory";
import Insights from "./pages/Insights";
import AdminMasterData from "./pages/AdminMasterData";
import Tickets from "./pages/Tickets";
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
  const [appError, setAppError] = useState("");

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

  useEffect(() => {
    const interceptorId = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const url = error?.config?.url || "";
        if (!url.includes("/api/login")) {
          const message = error?.response?.data?.message || error?.message || "Something went wrong.";
          setAppError(message);
        }
        return Promise.reject(error);
      }
    );
    return () => {
      axios.interceptors.response.eject(interceptorId);
    };
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

  if (appError) {
    return (
      <div className="app-shell">
        <div className="app-container">
          <section className="section-card" style={{ marginTop: "2rem" }}>
            <h3 className="section-title">Something went wrong</h3>
            <p className="muted-text">{appError}</p>
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
              <button type="button" className="btn btn-secondary" onClick={() => setAppError("")}>
                Go back
              </button>
              <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  }

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
          {user.role === "BRANCH" && (
            <button className={`tab ${activeTab === "daily" ? "tab--active" : ""}`} onClick={() => setActiveTab("daily")}>
              Daily Requests
            </button>
          )}
          {user.role === "BRANCH" && (
            <button className={`tab ${activeTab === "other" ? "tab--active" : ""}`} onClick={() => setActiveTab("other")}>
              Others
            </button>
          )}
          {user.role === "OPS" && (
            <button className={`tab ${activeTab === "ops" ? "tab--active" : ""}`} onClick={() => setActiveTab("ops")}>
              Purchase Run
            </button>
          )}
          {user.role === "ADMIN" && (
            <button className={`tab ${activeTab === "combined" ? "tab--active" : ""}`} onClick={() => setActiveTab("combined")}>
              Central Purchase
            </button>
          )}
          {user.role === "ADMIN" && (
            <button className={`tab ${activeTab === "distribution" ? "tab--active" : ""}`} onClick={() => setActiveTab("distribution")}>
              Distribution
            </button>
          )}
          {user.role === "ADMIN" && (
            <button className={`tab ${activeTab === "inventory" ? "tab--active" : ""}`} onClick={() => setActiveTab("inventory")}>
              Central Inventory
            </button>
          )}
          {user.role === "ADMIN" && (
            <button className={`tab ${activeTab === "tickets" ? "tab--active" : ""}`} onClick={() => setActiveTab("tickets")}>
              Tickets
            </button>
          )}
          {(user.role === "OPS" || user.role === "ADMIN") && (
            <button className={`tab ${activeTab === "insights" ? "tab--active" : ""}`} onClick={() => setActiveTab("insights")}>
              Reports
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
          {user.role === "BRANCH" && activeTab === "daily" && <DailyRequests />}
          {user.role === "BRANCH" && activeTab === "other" && <OtherRequests />}
          {user.role === "OPS" && activeTab === "ops" && <OpsPurchaseRun />}
          {user.role === "ADMIN" && activeTab === "combined" && <CombinedPurchaseRun onNavigate={setActiveTab} />}
          {user.role === "ADMIN" && activeTab === "distribution" && <DistributionRun />}
          {user.role === "ADMIN" && activeTab === "inventory" && <CentralInventory />}
          {user.role === "ADMIN" && activeTab === "tickets" && <Tickets />}
          {(user.role === "OPS" || user.role === "ADMIN") && activeTab === "insights" && <Insights />}
          {user.role === "ADMIN" && activeTab === "admin" && <AdminMasterData />}

          {activeTab === "main" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {user.role === "BRANCH" && <BranchRequests />}
              {user.role === "BRANCH" && <DailyRequests />}
              {user.role === "BRANCH" && <OtherRequests />}
              {user.role === "OPS" && <OpsPurchaseRun />}
              {user.role === "ADMIN" && <CombinedPurchaseRun onNavigate={setActiveTab} />}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
