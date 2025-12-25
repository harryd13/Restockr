import React, { useEffect, useState } from "react";
import axios from "axios";
import BranchRequests from "./pages/BranchRequests";
import BranchExpenseTickets from "./pages/BranchExpenseTickets";
import DailyRequests from "./pages/DailyRequests";
import OtherRequests from "./pages/OtherRequests";
import OpsPurchaseRun from "./pages/OpsPurchaseRun";
import CombinedPurchaseRun from "./pages/CombinedPurchaseRun";
import DistributionRun from "./pages/DistributionRun";
import CentralInventory from "./pages/CentralInventory";
import Insights from "./pages/Insights";
import AdminMasterData from "./pages/AdminMasterData";
import Tickets from "./pages/Tickets";
import ExpenseTickets from "./pages/ExpenseTickets";
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notificationCounts, setNotificationCounts] = useState({ combined: 0, distribution: 0, tickets: 0 });
  const [lastSeenCounts, setLastSeenCounts] = useState({ combined: 0, distribution: 0, tickets: 0 });

  useEffect(() => {
    const stored = localStorage.getItem("foffee_auth");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed?.token && parsed?.user) {
          setUser(parsed.user);
          setToken(parsed.token);
          axios.defaults.headers.common["Authorization"] = `Bearer ${parsed.token}`;
          if (parsed.user?.role === "ADMIN") {
            setActiveTab("home");
          } else if (parsed.user?.role === "BRANCH") {
            setActiveTab("branch-home");
          } else if (parsed.user?.role === "OPS") {
            setActiveTab("ops");
          }
        }
      } catch (e) {
        localStorage.removeItem("foffee_auth");
      }
    }
  }, []);

  const refreshNotifications = async () => {
    if (!user || user.role !== "ADMIN") return;
    try {
      const [combinedRes, distRes, ticketsRes] = await Promise.all([
        axios.get("/api/combined-purchase-queue"),
        axios.get("/api/distribution-queue"),
        axios.get("/api/tickets", { params: { status: "OPEN" } })
      ]);
      setNotificationCounts({
        combined: combinedRes.data?.runIds?.length || 0,
        distribution: distRes.data?.runs?.length || 0,
        tickets: ticketsRes.data?.tickets?.length || 0
      });
    } catch (err) {
      // Ignore notification errors to avoid blocking navigation.
    }
  };

  useEffect(() => {
    if (!user || user.role !== "ADMIN") return;
    refreshNotifications();
    const intervalId = setInterval(() => {
      refreshNotifications();
    }, 30000);
    return () => clearInterval(intervalId);
  }, [user]);

  useEffect(() => {
    if (!user || user.role !== "ADMIN") return;
    if (!["combined", "distribution", "tickets"].includes(activeTab)) return;
    setLastSeenCounts((prev) => {
      const latest = notificationCounts[activeTab] || 0;
      if (prev[activeTab] === latest) return prev;
      return { ...prev, [activeTab]: latest };
    });
  }, [activeTab, notificationCounts, user]);

  const getBadgeCount = (tab) => {
    const current = notificationCounts[tab] || 0;
    const seen = lastSeenCounts[tab] || 0;
    return Math.max(0, current - seen);
  };

  const selectTab = (tab) => {
    setActiveTab(tab);
    if (!user || user.role !== "ADMIN") return;
    if (!["combined", "distribution", "tickets"].includes(tab)) return;
    setLastSeenCounts((prev) => ({ ...prev, [tab]: notificationCounts[tab] || 0 }));
  };

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
      if (res.data.user?.role === "ADMIN") {
        setActiveTab("home");
      } else if (res.data.user?.role === "BRANCH") {
        setActiveTab("branch-home");
      } else if (res.data.user?.role === "OPS") {
        setActiveTab("ops");
      }
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
    setNotificationCounts({ combined: 0, distribution: 0, tickets: 0 });
    setLastSeenCounts({ combined: 0, distribution: 0, tickets: 0 });
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
          onMenuClick={() => setDrawerOpen(true)}
          navSlot={
            <nav className="tabs">
              {user.role === "ADMIN" && (
                <button className={`tab ${activeTab === "home" ? "tab--active" : ""}`} onClick={() => selectTab("home")}>
                  Home
                </button>
              )}
              {user.role === "BRANCH" && (
                <button className={`tab ${activeTab === "branch-home" ? "tab--active" : ""}`} onClick={() => selectTab("branch-home")}>
                  Home
                </button>
              )}
              {user.role === "BRANCH" && (
                <button className={`tab ${activeTab === "branch" ? "tab--active" : ""}`} onClick={() => selectTab("branch")}>
                  Weekly Request
                </button>
              )}
              {user.role === "BRANCH" && (
                <button className={`tab ${activeTab === "daily" ? "tab--active" : ""}`} onClick={() => selectTab("daily")}>
                  Daily Requests
                </button>
              )}
              {user.role === "BRANCH" && (
                <button className={`tab ${activeTab === "other" ? "tab--active" : ""}`} onClick={() => selectTab("other")}>
                  Others
                </button>
              )}
              {user.role === "OPS" && (
                <button className={`tab ${activeTab === "ops" ? "tab--active" : ""}`} onClick={() => selectTab("ops")}>
                  Purchase Run
                </button>
              )}
              {user.role === "ADMIN" && (
                <button className={`tab ${activeTab === "combined" ? "tab--active" : ""}`} onClick={() => selectTab("combined")}>
                  Central Purchase
                  {getBadgeCount("combined") > 0 && <span className="tab__badge">{getBadgeCount("combined")}</span>}
                </button>
              )}
              {user.role === "ADMIN" && (
                <button className={`tab ${activeTab === "distribution" ? "tab--active" : ""}`} onClick={() => selectTab("distribution")}>
                  Distribution
                  {getBadgeCount("distribution") > 0 && <span className="tab__badge">{getBadgeCount("distribution")}</span>}
                </button>
              )}
              {user.role === "ADMIN" && (
                <button className={`tab ${activeTab === "inventory" ? "tab--active" : ""}`} onClick={() => selectTab("inventory")}>
                  Central Inventory
                </button>
              )}
              {user.role === "ADMIN" && (
                <button className={`tab ${activeTab === "tickets" ? "tab--active" : ""}`} onClick={() => selectTab("tickets")}>
                  Tickets
                  {getBadgeCount("tickets") > 0 && <span className="tab__badge">{getBadgeCount("tickets")}</span>}
                </button>
              )}
              {(user.role === "OPS" || user.role === "ADMIN") && (
                <button className={`tab ${activeTab === "insights" ? "tab--active" : ""}`} onClick={() => selectTab("insights")}>
                  Reports
                </button>
              )}
              {user.role === "ADMIN" && (
                <button className={`tab ${activeTab === "admin" ? "tab--active" : ""}`} onClick={() => selectTab("admin")}>
                  Master Data
                </button>
              )}
            </nav>
          }
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

        <main style={{ marginTop: "1rem" }}>
          {user.role === "BRANCH" && activeTab === "branch" && <BranchRequests />}
          {user.role === "BRANCH" && activeTab === "daily" && <DailyRequests />}
          {user.role === "BRANCH" && activeTab === "other" && <OtherRequests />}
          {user.role === "BRANCH" && activeTab === "branch-home" && <BranchExpenseTickets />}
          {user.role === "OPS" && activeTab === "ops" && <OpsPurchaseRun />}
          {user.role === "ADMIN" && activeTab === "combined" && <CombinedPurchaseRun onNavigate={selectTab} />}
          {user.role === "ADMIN" && activeTab === "distribution" && <DistributionRun />}
          {user.role === "ADMIN" && activeTab === "inventory" && <CentralInventory />}
          {user.role === "ADMIN" && activeTab === "tickets" && <Tickets />}
          {user.role === "ADMIN" && activeTab === "home" && <ExpenseTickets />}
          {(user.role === "OPS" || user.role === "ADMIN") && activeTab === "insights" && <Insights />}
          {user.role === "ADMIN" && activeTab === "admin" && <AdminMasterData />}

          {activeTab === "main" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {user.role === "BRANCH" && <BranchRequests />}
              {user.role === "BRANCH" && <DailyRequests />}
              {user.role === "BRANCH" && <OtherRequests />}
              {user.role === "OPS" && <OpsPurchaseRun />}
              {user.role === "ADMIN" && <CombinedPurchaseRun onNavigate={selectTab} />}
            </div>
          )}
        </main>

        <div className={`drawer-backdrop ${drawerOpen ? "drawer-backdrop--open" : ""}`} onClick={() => setDrawerOpen(false)} role="presentation">
          <div className={`drawer ${drawerOpen ? "drawer--open" : ""}`} onClick={(e) => e.stopPropagation()} role="presentation">
            <div className="drawer__header">
              <strong>Navigate</strong>
              <button type="button" className="btn btn-ghost" onClick={() => setDrawerOpen(false)}>
                Close
              </button>
            </div>
            <div className="drawer__list">
              {user.role === "ADMIN" && (
                <>
                  <button
                    type="button"
                    className={activeTab === "home" ? "drawer__item drawer__item--active" : "drawer__item"}
                    onClick={() => {
                      selectTab("home");
                      setDrawerOpen(false);
                    }}
                  >
                    Home
                  </button>
                  <button
                    type="button"
                    className={activeTab === "combined" ? "drawer__item drawer__item--active" : "drawer__item"}
                    onClick={() => {
                      selectTab("combined");
                      setDrawerOpen(false);
                    }}
                  >
                    <span>Central Purchase</span>
                    {getBadgeCount("combined") > 0 && <span className="drawer__badge">{getBadgeCount("combined")}</span>}
                  </button>
                  <button
                    type="button"
                    className={activeTab === "distribution" ? "drawer__item drawer__item--active" : "drawer__item"}
                    onClick={() => {
                      selectTab("distribution");
                      setDrawerOpen(false);
                    }}
                  >
                    <span>Distribution</span>
                    {getBadgeCount("distribution") > 0 && <span className="drawer__badge">{getBadgeCount("distribution")}</span>}
                  </button>
                  <button
                    type="button"
                    className={activeTab === "inventory" ? "drawer__item drawer__item--active" : "drawer__item"}
                    onClick={() => {
                      selectTab("inventory");
                      setDrawerOpen(false);
                    }}
                  >
                    Central Inventory
                  </button>
                  <button
                    type="button"
                    className={activeTab === "tickets" ? "drawer__item drawer__item--active" : "drawer__item"}
                    onClick={() => {
                      selectTab("tickets");
                      setDrawerOpen(false);
                    }}
                  >
                    <span>Tickets</span>
                    {getBadgeCount("tickets") > 0 && <span className="drawer__badge">{getBadgeCount("tickets")}</span>}
                  </button>
                  <button
                    type="button"
                    className={activeTab === "insights" ? "drawer__item drawer__item--active" : "drawer__item"}
                    onClick={() => {
                      selectTab("insights");
                      setDrawerOpen(false);
                    }}
                  >
                    Reports
                  </button>
                  <button
                    type="button"
                    className={activeTab === "admin" ? "drawer__item drawer__item--active" : "drawer__item"}
                    onClick={() => {
                      selectTab("admin");
                      setDrawerOpen(false);
                    }}
                  >
                    Master Data
                  </button>
                </>
              )}
              {user.role === "BRANCH" && (
                <>
                  <button
                    type="button"
                    className={activeTab === "branch-home" ? "drawer__item drawer__item--active" : "drawer__item"}
                    onClick={() => {
                      selectTab("branch-home");
                      setDrawerOpen(false);
                    }}
                  >
                    Home
                  </button>
                  <button
                    type="button"
                    className={activeTab === "branch" ? "drawer__item drawer__item--active" : "drawer__item"}
                    onClick={() => {
                      selectTab("branch");
                      setDrawerOpen(false);
                    }}
                  >
                    Weekly Request
                  </button>
                  <button
                    type="button"
                    className={activeTab === "daily" ? "drawer__item drawer__item--active" : "drawer__item"}
                    onClick={() => {
                      selectTab("daily");
                      setDrawerOpen(false);
                    }}
                  >
                    Daily Requests
                  </button>
                  <button
                    type="button"
                    className={activeTab === "other" ? "drawer__item drawer__item--active" : "drawer__item"}
                    onClick={() => {
                      selectTab("other");
                      setDrawerOpen(false);
                    }}
                  >
                    Others
                  </button>
                </>
              )}
              {user.role === "OPS" && (
                <>
                  <button
                    type="button"
                    className={activeTab === "ops" ? "drawer__item drawer__item--active" : "drawer__item"}
                    onClick={() => {
                      selectTab("ops");
                      setDrawerOpen(false);
                    }}
                  >
                    Purchase Run
                  </button>
                  <button
                    type="button"
                    className={activeTab === "insights" ? "drawer__item drawer__item--active" : "drawer__item"}
                    onClick={() => {
                      selectTab("insights");
                      setDrawerOpen(false);
                    }}
                  >
                    Reports
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
