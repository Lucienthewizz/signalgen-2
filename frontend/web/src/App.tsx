import { useEffect, useState } from "react";
import { api, session } from "@/api/client";
import { Brand } from "@/components/brand";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountPage } from "@/pages/account-page";
import { AuthPage, type AuthView } from "@/pages/auth-page";
import { DemoWorkspace, type DemoView } from "@/pages/demo-workspace";
import { PublicWorkspace } from "@/pages/public-workspace";
import type { User } from "@/types";

type Route = "home" | "account" | AuthView | `app/${DemoView}`;

function currentRoute(): Route {
  const queryView = new URLSearchParams(location.search).get("view");
  if (queryView === "reset-password") return "reset-password";
  const route = location.hash.slice(1).split("&")[0];
  if (
    [
      "app/overview",
      "app/analysis",
      "app/rules",
      "app/journal",
      "app/access",
    ].includes(route)
  ) {
    return route as Route;
  }
  return [
    "account",
    "login",
    "register",
    "forgot-password",
    "reset-password",
  ].includes(route)
    ? (route as Route)
    : "home";
}

export default function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [backendOnline, setBackendOnline] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);

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
    Promise.allSettled([
      api.status().then(() => {
        if (active) setBackendOnline(true);
      }),
      session.getToken()
        ? api.me().then((profile) => {
            if (active) setUser(profile);
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
      removeEventListener("signalgen:unauthorized", unauthorized);
    };
  }, []);

  function authenticated(nextUser: User) {
    setUser(nextUser);
    location.hash = "account";
  }

  function logout() {
    session.clear();
    setUser(null);
    location.hash = "home";
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
    return <AccountPage user={user} onLogout={logout} />;
  if (route === "account")
    return (
      <AuthPage
        view="login"
        backendOnline={backendOnline}
        onAuthenticated={authenticated}
      />
    );
  if (route.startsWith("app/")) {
    return (
      <DemoWorkspace
        view={route.replace("app/", "") as DemoView}
        backendOnline={backendOnline}
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
  return <PublicWorkspace backendOnline={backendOnline} user={user} />;
}
