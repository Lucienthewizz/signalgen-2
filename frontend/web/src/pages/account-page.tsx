import { ArrowLeft, LogOut, ShieldCheck, UserRoundCheck } from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import type { User } from "@/types";

export function AccountPage({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const name = user.full_name?.trim() || user.email.split("@")[0];
  return (
    <main className="account-page">
      <header className="account-topbar">
        <a href="#home">
          <Brand compact />
        </a>
        <a href="#home">
          <ArrowLeft /> Back to overview
        </a>
      </header>
      <section className="account-shell">
        <div className="account-intro">
          <span className="section-index">Account / Identity</span>
          <h1>Workspace access</h1>
          <p>This identity is verified directly by Signalgen authorization.</p>
        </div>
        <div className="account-ledger">
          <div className="account-avatar">{name.slice(0, 2).toUpperCase()}</div>
          <div>
            <span>Authenticated user</span>
            <h2>{name}</h2>
            <p>{user.email}</p>
          </div>
          <span className="account-state">
            <i /> Active session
          </span>
        </div>
        <dl className="identity-table">
          <div>
            <dt>Account ID</dt>
            <dd>{user.id}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{user.role ?? "user"}</dd>
          </div>
          <div>
            <dt>Authorization</dt>
            <dd>
              <ShieldCheck /> Supabase bearer session
            </dd>
          </div>
          <div>
            <dt>Privacy boundary</dt>
            <dd>
              <UserRoundCheck /> User scoped
            </dd>
          </div>
        </dl>
        <Button
          className="ui-button logout-button"
          variant="outline"
          onClick={onLogout}
        >
          <LogOut /> Sign out
        </Button>
      </section>
    </main>
  );
}
