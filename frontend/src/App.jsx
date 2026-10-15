import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import BranchRequests from "./inventory/pages/BranchRequests";
import BranchExpenseTickets from "./inventory/pages/BranchExpenseTickets";
import BranchCashManagement from "./inventory/pages/BranchCashManagement";
import AdminCashManagement from "./inventory/pages/AdminCashManagement";
import AdminCashReports from "./inventory/pages/AdminCashReports";
import DailyRequests from "./inventory/pages/DailyRequests";
import OtherRequests from "./inventory/pages/OtherRequests";
import OpsPurchaseRun from "./inventory/pages/OpsPurchaseRun";
import CombinedPurchaseRun from "./inventory/pages/CombinedPurchaseRun";
import DistributionRun from "./inventory/pages/DistributionRun";
import CentralInventory from "./inventory/pages/CentralInventory";
import Insights from "./inventory/pages/Insights";
import AdminMasterData from "./inventory/pages/AdminMasterData";
import Tickets from "./inventory/pages/Tickets";
import ExpenseTickets from "./inventory/pages/ExpenseTickets";
import AdminTools from "./inventory/pages/AdminTools";
import LoginScreen from "./shared/auth/LoginScreen";
import TopNav from "./shared/components/TopNav";
import Modal from "./shared/components/Modal";
import AppFooter from "./shared/components/AppFooter";
import HomePage from "./web/pages/public/HomePage";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

axios.defaults.baseURL = API_BASE;

function isWeeklyWindow(date = new Date()) {
  const now = new Date(date);
  const day = now.getDay();
  if (day === 4) return true;
  if (day === 5 && now.getHours() < 12) return true;
  return false;
}

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState("");
  const [activeTab, setActiveTab] = useState("main");
  const [loginError, setLoginError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [appError, setAppError] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openNavGroup, setOpenNavGroup] = useState(null);
  const [notificationCounts, setNotificationCounts] = useState({ combined: 0, distribution: 0, tickets: 0 });
  const [lastSeenCounts, setLastSeenCounts] = useState({ combined: 0, distribution: 0, tickets: 0 });
  const [showWeeklyBanner, setShowWeeklyBanner] = useState(false);
  const weeklyBannerTimer = useRef(null);
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportRefreshKey, setReportRefreshKey] = useState(0);
  const [weeklyOverride, setWeeklyOverride] = useState(false);
  const [publicRoute, setPublicRoute] = useState(() => (window.location.hash === "#login" ? "login" : "home"));
  const allowWeeklyAnyDay = String(import.meta.env.VITE_WEEKLY_ALLOW_ANY_DAY || "").toLowerCase() === "true";
  const weeklyEnabled = allowWeeklyAnyDay || weeklyOverride || isWeeklyWindow();

  const clearAuthState = () => {
    setUser(null);
    setToken("");
    setNotificationCounts({ combined: 0, distribution: 0, tickets: 0 });
    setLastSeenCounts({ combined: 0, distribution: 0, tickets: 0 });
    delete axios.defaults.headers.common["Authorization"];
    localStorage.removeItem("foffee_auth");
  };

  useEffect(() => {
    const stored = localStorage.getItem("foffee_auth");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed?.token && parsed?.user) {
          setUser(parsed.user);
          setToken(parsed.token);
          axios.defaults.headers.common["Authorization"] = `Bearer ${parsed.token}`;
          loadWeeklyOverride();
          loadReportStartDate();
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

  useEffect(() => {
    const syncPublicRoute = () => {
      setPublicRoute(window.location.hash === "#login" ? "login" : "home");
      window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
    };
    syncPublicRoute();
    window.addEventListener("hashchange", syncPublicRoute);
    return () => window.removeEventListener("hashchange", syncPublicRoute);
  }, []);

  const loadWeeklyOverride = async () => {
    try {
      const res = await axios.get("/api/settings/weekly-override");
      setWeeklyOverride(!!res.data?.weeklyOverride);
    } catch (err) {
      // Ignore to avoid blocking UI.
    }
  };

  useEffect(() => {
    return () => {
      if (weeklyBannerTimer.current) clearTimeout(weeklyBannerTimer.current);
    };
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
    setOpenNavGroup(null);
    if (!user || user.role !== "ADMIN") return;
    if (!["combined", "distribution", "tickets"].includes(tab)) return;
    setLastSeenCounts((prev) => ({ ...prev, [tab]: notificationCounts[tab] || 0 }));
  };

  const handleWeeklyTabClick = () => {
    selectTab("branch");
    if (!weeklyEnabled) {
      setShowWeeklyBanner(true);
      if (weeklyBannerTimer.current) clearTimeout(weeklyBannerTimer.current);
      weeklyBannerTimer.current = setTimeout(() => setShowWeeklyBanner(false), 5000);
    }
  };

  const handleReportsRefresh = async (date) => {
    setReportStartDate(date);
    try {
      await axios.post("/api/settings/report-start-date", { reportStartDate: date });
    } catch (err) {
      const message = err?.response?.data?.message || "Could not save report start date.";
      setAppError(message);
    }
    setReportRefreshKey((prev) => prev + 1);
  };

  const loadReportStartDate = async () => {
    try {
      const res = await axios.get("/api/settings/report-start-date");
      const saved = res.data?.reportStartDate || "";
      if (saved) {
        setReportStartDate(saved);
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      setReportStartDate(today);
      await axios.post("/api/settings/report-start-date", { reportStartDate: today });
    } catch (err) {
      // Ignore to avoid blocking UI.
    }
  };

  const handleWeeklyOverride = async (value) => {
    try {
      const res = await axios.post("/api/admin/settings/weekly-override", { weeklyOverride: value });
      setWeeklyOverride(!!res.data?.weeklyOverride);
    } catch (err) {
      const message = err?.response?.data?.message || "Could not update weekly override.";
      setAppError(message);
    }
  };

  useEffect(() => {
    const interceptorId = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const url = error?.config?.url || "";
        const status = error?.response?.status;
        if (status === 401 && !url.includes("/api/login")) {
          setAppError("");
          clearAuthState();
          setLoginError("Session expired. Please sign in again.");
          return Promise.reject(error);
        }
        if (!url.includes("/api/login") && !error?.config?.skipGlobalError) {
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
      await loadWeeklyOverride();
      await loadReportStartDate();
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
    clearAuthState();
    window.location.hash = "#home";
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
    if (publicRoute !== "login") return <HomePage />;
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
          mobileBranchName={user.role === "BRANCH" ? user.name || user.branchId || "Branch" : ""}
          mobileSubtitle={user.role === "BRANCH" ? `Foffee · ${user.branchId || "Branch"}` : user.role}
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
                <button
                  className={`tab ${activeTab === "cash-management" ? "tab--active" : ""}`}
                  onClick={() => selectTab("cash-management")}
                >
                  Cash Management
                </button>
              )}
              {user.role === "BRANCH" && (
                <button
                  className={`tab ${activeTab === "branch" ? "tab--active" : ""} ${!weeklyEnabled ? "tab--disabled" : ""}`}
                  onClick={handleWeeklyTabClick}
                  aria-disabled={!weeklyEnabled}
                >
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
                <div className="tab-menu">
                  <button className={`tab tab-menu__trigger ${["admin-cash", "cash-reports"].includes(activeTab) ? "tab--active" : ""}`} onClick={() => setOpenNavGroup(openNavGroup === "cashier" ? null : "cashier")} aria-expanded={openNavGroup === "cashier"}>
                    Cashier <span aria-hidden="true">⌄</span>
                  </button>
                  {openNavGroup === "cashier" && <div className="tab-menu__content">
                    <button type="button" onClick={() => selectTab("admin-cash")}>Cash Management</button>
                    <button type="button" onClick={() => selectTab("cash-reports")}>Cash Reports</button>
                  </div>}
                </div>
              )}
              {user.role === "ADMIN" && (
                <div className="tab-menu">
                  <button className={`tab tab-menu__trigger ${["combined", "distribution", "inventory"].includes(activeTab) ? "tab--active" : ""}`} onClick={() => setOpenNavGroup(openNavGroup === "central" ? null : "central")} aria-expanded={openNavGroup === "central"}>
                    Central <span aria-hidden="true">⌄</span>
                  </button>
                  {openNavGroup === "central" && <div className="tab-menu__content">
                    <button type="button" onClick={() => selectTab("combined")}>Central Purchase {getBadgeCount("combined") > 0 && <span className="tab__badge">{getBadgeCount("combined")}</span>}</button>
                    <button type="button" onClick={() => selectTab("distribution")}>Distribution {getBadgeCount("distribution") > 0 && <span className="tab__badge">{getBadgeCount("distribution")}</span>}</button>
                    <button type="button" onClick={() => selectTab("inventory")}>Central Inventory</button>
                  </div>}
                </div>
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
                <div className="tab-menu">
                  <button className={`tab tab-menu__trigger ${["admin", "tools"].includes(activeTab) ? "tab--active" : ""}`} onClick={() => setOpenNavGroup(openNavGroup === "tools" ? null : "tools")} aria-expanded={openNavGroup === "tools"}>
                    Tools <span aria-hidden="true">⌄</span>
                  </button>
                  {openNavGroup === "tools" && <div className="tab-menu__content">
                    <button type="button" onClick={() => selectTab("admin")}>Master Data</button>
                    <button type="button" onClick={() => selectTab("tools")}>Tools</button>
                  </div>}
                </div>
              )}
            </nav>
          }
          rightSlot={
            <>
              <div
                className={user.role === "BRANCH" ? "topnav__user topnav__user--branch" : "topnav__user"}
                title={user.role === "BRANCH" ? `${user.name || user.branchId || "Branch"} · Foffee` : undefined}
              >
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

        {showWeeklyBanner && !weeklyEnabled && (
          <div className="notice-banner" role="status" style={{ marginTop: "1rem" }}>
            Weekly requests are only allowed on THURSDAY.
            <button type="button" className="notice-banner__close" onClick={() => setShowWeeklyBanner(false)}>
              Dismiss
            </button>
          </div>
        )}

        <main style={{ marginTop: "1rem" }}>
          {user.role === "BRANCH" && activeTab === "branch" && <BranchRequests allowWeeklyOverride={weeklyOverride} />}
          {user.role === "BRANCH" && activeTab === "daily" && <DailyRequests />}
          {user.role === "BRANCH" && activeTab === "other" && <OtherRequests />}
          {user.role === "BRANCH" && activeTab === "branch-home" && <BranchExpenseTickets />}
          {user.role === "BRANCH" && activeTab === "cash-management" && <BranchCashManagement />}
          {user.role === "ADMIN" && activeTab === "admin-cash" && <AdminCashManagement onNavigate={selectTab} />}
          {user.role === "ADMIN" && activeTab === "cash-reports" && <AdminCashReports />}
          {user.role === "OPS" && activeTab === "ops" && <OpsPurchaseRun />}
          {user.role === "ADMIN" && activeTab === "combined" && <CombinedPurchaseRun onNavigate={selectTab} />}
          {user.role === "ADMIN" && activeTab === "distribution" && <DistributionRun />}
          {user.role === "ADMIN" && activeTab === "inventory" && <CentralInventory />}
          {user.role === "ADMIN" && activeTab === "tickets" && (
            <Tickets reportStartDate={reportStartDate} reportRefreshKey={reportRefreshKey} />
          )}
          {user.role === "ADMIN" && activeTab === "home" && <ExpenseTickets />}
          {(user.role === "OPS" || user.role === "ADMIN") && activeTab === "insights" && (
            <Insights reportStartDate={reportStartDate} reportRefreshKey={reportRefreshKey} />
          )}
          {user.role === "ADMIN" && activeTab === "admin" && <AdminMasterData />}
          {user.role === "ADMIN" && activeTab === "tools" && (
            <AdminTools
              reportStartDate={reportStartDate}
              onRefresh={handleReportsRefresh}
              allowWeeklyOverride={weeklyOverride}
              onWeeklyOverrideChange={handleWeeklyOverride}
            />
          )}

          {activeTab === "main" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {user.role === "BRANCH" && <BranchRequests allowWeeklyOverride={weeklyOverride} />}
              {user.role === "BRANCH" && <DailyRequests />}
              {user.role === "BRANCH" && <OtherRequests />}
              {user.role === "OPS" && <OpsPurchaseRun />}
              {user.role === "ADMIN" && <CombinedPurchaseRun onNavigate={selectTab} />}
            </div>
          )}
        </main>
        <AppFooter />

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
                    className={activeTab === "admin-cash" ? "drawer__item drawer__item--active" : "drawer__item"}
                    onClick={() => {
                      selectTab("admin-cash");
                      setDrawerOpen(false);
                    }}
                  >
                    Cash Management
                  </button>
                  <button
                    type="button"
                    className={activeTab === "cash-reports" ? "drawer__item drawer__item--active" : "drawer__item"}
                    onClick={() => {
                      selectTab("cash-reports");
                      setDrawerOpen(false);
                    }}
                  >
                    Cash Reports
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
                  <button
                    type="button"
                    className={activeTab === "tools" ? "drawer__item drawer__item--active" : "drawer__item"}
                    onClick={() => {
                      selectTab("tools");
                      setDrawerOpen(false);
                    }}
                  >
                    Tools
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
                    className={activeTab === "cash-management" ? "drawer__item drawer__item--active" : "drawer__item"}
                    onClick={() => {
                      selectTab("cash-management");
                      setDrawerOpen(false);
                    }}
                  >
                    Cash Management
                  </button>
                  <button
                    type="button"
                    className={`${activeTab === "branch" ? "drawer__item drawer__item--active" : "drawer__item"} ${
                      !weeklyEnabled ? "drawer__item--disabled" : ""
                    }`}
                    onClick={() => {
                      handleWeeklyTabClick();
                      setDrawerOpen(false);
                    }}
                    aria-disabled={!weeklyEnabled}
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
            <div className="drawer__logout">
              <button
                type="button"
                className="drawer__item"
                onClick={() => {
                  setDrawerOpen(false);
                  logout();
                }}
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
