import { lazy, Suspense, useEffect, useLayoutEffect, useState } from "react";
import { api, session } from "@/api/client";
import {
  monitorBackendStatus,
  type BackendConnection,
} from "@/api/backend-status";
import { Brand } from "@/components/brand";
import { Skeleton } from "@/components/ui/skeleton";
import type { AuthView } from "@/pages/auth-page";
import type { DemoView } from "@/pages/demo-workspace";
import { RouteBoundary, RouteLoading } from "@/components/route-boundary";
import { startHistoricalCacheLifecycle } from "@/data/historical-lifecycle";
const AccountPage = lazy(() =>
  import("@/pages/account-page").then((m) => ({ default: m.AccountPage })),
);
const AuthPage = lazy(() =>
  import("@/pages/auth-page").then((m) => ({ default: m.AuthPage })),
);
const DemoWorkspace = lazy(() =>
  import("@/pages/demo-workspace").then((m) => ({ default: m.DemoWorkspace })),
);
const CreatorsPage = lazy(() =>
  import("@/pages/creators-page").then((m) => ({ default: m.CreatorsPage })),
);
const PublicWorkspace = lazy(() =>
  import("@/pages/public-workspace").then((m) => ({
    default: m.PublicWorkspace,
  })),
);
import type { User } from "@/types";

type Route = "home" | "account" | "creators" | AuthView | `app/${DemoView}`;

function currentRoute(): Route {
  const queryView = new URLSearchParams(location.search).get("view");
  if (queryView === "reset-password") return "reset-password";
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (
    hashParams.get("type") === "recovery" ||
    (hashParams.get("access_token") && hashParams.get("refresh_token"))
  ) {
    return "reset-password";
  }
  const route = location.hash.slice(1).split("&")[0];
  if (route === "app/admin") return "app/operator";
  if (
    [
      "app/overview",
      "app/analysis",
      "app/backtest",
      "app/realtime",
      "app/news",
      "app/rules",
      "app/journal",
      "app/access",
      "app/universes",
      "app/subscription",
      "app/operator",
    ].includes(route)
  ) {
    return route as Route;
  }
  return [
    "account",
    "creators",
    "login",
    "register",
    "forgot-password",
    "reset-password",
  ].includes(route)
    ? (route as Route)
    : "home";
}

function RoutedApp() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [backendOnline, setBackendOnline] = useState(false);
  const [connection, setConnection] = useState<BackendConnection>("checking");
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(startHistoricalCacheLifecycle, []);
  // Put typography on the document so portalled controls and toasts match the route.
  useLayoutEffect(() => {
    document.documentElement.dataset.typography =
      route === "home" ? "landing" : "workspace";
    return () => {
      delete document.documentElement.dataset.typography;
    };
  }, [route]);

  useEffect(() => {
    const navigate = () => setRoute(currentRoute());
    addEventListener("hashchange", navigate);
    addEventListener("popstate", navigate);
    return () => {
      removeEventListener("hashchange", navigate);
      removeEventListener("popstate", navigate);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const stopBackendMonitor = monitorBackendStatus(
      api.status,
      setBackendOnline,
      5000,
      setConnection,
    );
    Promise.allSettled([
      session.getToken()
        ? Promise.all([api.me(), api.ensureAppSession()]).then(([profile]) => {
            if (active) {
              setUser(profile);
              if (currentRoute() === "home") location.hash = "app/overview";
            }
          })
        : Promise.resolve(),
    ]).finally(() => {
      if (active) setBooting(false);
    });
    const unauthorized = () => {
      setUser(null);
      location.hash = "login";
    };
    addEventListener("signalgen:unauthorized", unauthorized);
    return () => {
      active = false;
      stopBackendMonitor();
      removeEventListener("signalgen:unauthorized", unauthorized);
    };
  }, []);

  function authenticated(nextUser: User) {
    setUser(nextUser);
    location.hash = "app/overview";
  }

  useEffect(() => {
    if (!user) return;
    const refresh = () => {
      void api.refreshIfNeeded().catch(() => {
        /* Retry on next request; don't log tokens or sign out on network failure. */
      });
    };
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [user]);

  async function logout() {
    try {
      if (session.getToken() && session.getAppSession())
        await api.revokeCurrentAppSession();
    } finally {
      session.clear();
      setUser(null);
      location.hash = "home";
    }
  }

  if (booting) {
    return (
      <main className="splash" role="status">
        <div className="splash__brand">
          <Brand />
        </div>
        <div className="splash__signal" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="splash__skeleton" aria-hidden="true">
          <Skeleton />
          <Skeleton />
        </div>
        <p>Preparing your workspace…</p>
      </main>
    );
  }
  if (route === "account" && user)
    return (
      <AccountPage
        user={user}
        onLogout={logout}
        backendOnline={backendOnline}
      />
    );
  if (route === "account")
    return (
      <AuthPage
        view="login"
        backendOnline={backendOnline}
        onAuthenticated={authenticated}
      />
    );
  if (route === "creators") return <CreatorsPage />;
  if (route.startsWith("app/")) {
    return (
      <DemoWorkspace
        connection={connection}
        view={route.replace("app/", "") as DemoView}
        backendOnline={backendOnline}
        authenticated={Boolean(user && session.getAppSession())}
        user={user}
        onLogout={logout}
      />
    );
  }
  if (
    route === "login" ||
    route === "register" ||
    route === "forgot-password" ||
    route === "reset-password"
  ) {
    return (
      <AuthPage
        view={route}
        backendOnline={backendOnline}
        onAuthenticated={authenticated}
      />
    );
  }
  return (
    <PublicWorkspace
      backendOnline={backendOnline}
      user={user}
      onLogout={logout}
    />
  );
}

export default function App() {
  return (
    <RouteBoundary>
      <Suspense fallback={<RouteLoading />}>
        <RoutedApp />
      </Suspense>
    </RouteBoundary>
  );
}
