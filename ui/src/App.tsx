import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { Activity, Banknote, BookOpen, Clipboard, LayoutDashboard, Network, Zap } from "lucide-react";
import { DashboardPage } from "./pages/Dashboard";
import { AgentsPage } from "./pages/Agents";
import { AgentDetailPage } from "./pages/AgentDetail";
import { ActivityPage } from "./pages/Activity";
import { SkillsPage } from "./pages/Skills";
import { SpendingPage } from "./pages/Spending";
import { TasksPage } from "./pages/Tasks";
import { OrgChartPage } from "./pages/OrgChart";
import { CompanySwitcher } from "./components/CompanySwitcher";

const TABS = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/agents", label: "Agents", icon: Clipboard },
  { to: "/org", label: "Org", icon: Network },
  { to: "/tasks", label: "Tasks", icon: Zap },
  { to: "/skills", label: "Skills", icon: BookOpen },
  { to: "/activity", label: "Activity", icon: Activity },
  { to: "/spending", label: "Spending", icon: Banknote },
];

export function App() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-6 px-6 py-4">
          <Link to="/dashboard" className="flex items-center gap-2 font-semibold hover:opacity-80">
            <span className="inline-flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Clipboard className="size-4" />
            </span>
            <span>Clipboard</span>
          </Link>
          <CompanySwitcher />
          <nav className="flex items-center gap-1">
            {TABS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  }`
                }
              >
                <Icon className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:id" element={<AgentDetailPage />} />
          <Route path="/org" element={<OrgChartPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/spending" element={<SpendingPage />} />
          <Route
            path="*"
            element={
              <div className="text-muted-foreground">Page not found.</div>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
