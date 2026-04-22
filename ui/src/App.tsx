import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import {
  Activity,
  Banknote,
  BookOpen,
  Clipboard,
  LayoutDashboard,
  LogOut,
  Network,
  Zap,
} from "lucide-react";
import { DashboardPage } from "./pages/Dashboard";
import { AgentsPage } from "./pages/Agents";
import { AgentDetailPage } from "./pages/AgentDetail";
import { ActivityPage } from "./pages/Activity";
import { SkillsPage } from "./pages/Skills";
import { SpendingPage } from "./pages/Spending";
import { TasksPage } from "./pages/Tasks";
import { OrgChartPage } from "./pages/OrgChart";
import { LoginPage } from "./pages/Login";
import { ResetPasswordPage } from "./pages/ResetPassword";
import { CompanySwitcher } from "./components/CompanySwitcher";
import { useSession, useSignOut } from "./lib/auth";

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
  // Pre-session routes: the reset-password flow lands here via a link
  // from the email, when the user is by definition not signed in yet.
  // Route-match on the pathname BEFORE the session check so the token
  // in the URL isn't lost to the Login screen's redirect.
  if (typeof window !== "undefined" && window.location.pathname === "/reset-password") {
    return <ResetPasswordPage />;
  }

  // Auth gate: render Login until Better Auth confirms a session.
  // During the initial fetch we show a neutral "Loading" screen instead
  // of the tabbed layout — that avoids the dashboard flashing and then
  // snapping back to the sign-in screen once the /get-session call
  // resolves to no user.
  const session = useSession();
  if (session.isLoading) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  if (!session.data?.user) {
    return <LoginPage />;
  }

  return <AuthenticatedApp user={session.data.user} />;
}

function AuthenticatedApp({
  user,
}: {
  user: { email: string | null; name: string | null };
}) {
  const signOut = useSignOut();
  const label = user.name?.trim() || user.email || "Signed in";

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-6 px-6 py-4">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 font-semibold hover:opacity-80"
          >
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
          <div className="ml-auto flex items-center gap-3">
            <span
              className="text-xs text-muted-foreground max-w-[220px] truncate"
              title={label}
            >
              {label}
            </span>
            <button
              type="button"
              onClick={() => signOut.mutate()}
              disabled={signOut.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 disabled:opacity-50"
              title="Sign out"
            >
              <LogOut className="size-3.5" />
              Sign out
            </button>
          </div>
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
