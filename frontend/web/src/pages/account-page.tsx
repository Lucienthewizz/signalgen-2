import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  ChevronRight,
  KeyRound,
  LogOut,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  getProfileAvatar,
  getSavedProfileAvatar,
  profileAvatarOptions,
  saveProfileAvatar,
  type ProfileAvatarKey,
} from "@/lib/profile-avatar";
import type { User } from "@/types";

export function AccountPage({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const name = user.full_name?.trim() || user.email.split("@")[0];
  const [avatarKey, setAvatarKey] = useState<ProfileAvatarKey>(() =>
    getSavedProfileAvatar(user.id),
  );
  const avatar = getProfileAvatar(avatarKey);
  const AvatarIcon = avatar.Icon;

  useEffect(() => {
    setAvatarKey(getSavedProfileAvatar(user.id));
  }, [user.id]);

  function chooseAvatar(nextAvatar: ProfileAvatarKey) {
    saveProfileAvatar(user.id, nextAvatar);
    setAvatarKey(nextAvatar);
  }

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
          <h1>Your account</h1>
          <p>
            Manage the identity and workspace preferences linked to Signalgen.
          </p>
        </div>
        <div className="account-profile">
          <Avatar className={`account-avatar account-avatar--${avatarKey}`} size="lg">
            <AvatarFallback><AvatarIcon aria-hidden="true" /></AvatarFallback>
          </Avatar>
          <div>
            <span>Authenticated user</span>
            <h2>{name}</h2>
            <p>{user.email}</p>
          </div>
          <span className="account-state">
            <i /> Active session
          </span>
        </div>
        <section className="account-section account-section--avatar" aria-labelledby="avatar-heading">
          <div className="account-section__heading account-section__heading--avatar">
            <div>
              <h2 id="avatar-heading">Profile mark</h2>
              <p>Choose the mark shown for this account on this browser.</p>
            </div>
            <div className="avatar-current" aria-live="polite">
              <Avatar className={`avatar-current__mark account-avatar--${avatarKey}`} size="sm">
                <AvatarFallback><AvatarIcon aria-hidden="true" /></AvatarFallback>
              </Avatar>
              <span>{avatar.label}</span>
            </div>
          </div>
          <ToggleGroup
            className="avatar-picker"
            value={[avatarKey]}
            onValueChange={(value) => {
              const nextAvatar = value.at(-1);
              if (nextAvatar) chooseAvatar(nextAvatar as ProfileAvatarKey);
            }}
            variant="outline"
            spacing={0}
            aria-label="Profile mark choices"
          >
            {profileAvatarOptions.map(({ key, label, Icon }) => (
              <ToggleGroupItem
                key={key}
                className="avatar-choice"
                value={key}
                aria-label={`Use ${label} avatar`}
                title={label}
              >
                <Icon aria-hidden="true" />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </section>
        <section className="account-section" aria-labelledby="security-heading">
          <div className="account-section__heading">
            <div>
              <h2 id="security-heading">Security and access</h2>
              <p>Review your plan or change credentials when needed.</p>
            </div>
          </div>
          <div className="account-actions">
            <a className="account-action" href="#app/access">
              <BadgeCheck aria-hidden="true" />
              <span>
                <strong>Plan and access</strong>
                <small>Review your current workspace access.</small>
              </span>
              <ChevronRight aria-hidden="true" />
            </a>
            <a className="account-action" href="#forgot-password">
              <KeyRound aria-hidden="true" />
              <span>
                <strong>Password</strong>
                <small>Send a link to reset your password.</small>
              </span>
              <ChevronRight aria-hidden="true" />
            </a>
          </div>
        </section>
        <details className="account-details">
          <summary>Technical account details <ChevronRight aria-hidden="true" /></summary>
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
              <dd><ShieldCheck /> Supabase bearer session</dd>
            </div>
            <div>
              <dt>Privacy boundary</dt>
              <dd><UserRoundCheck /> User scoped</dd>
            </div>
          </dl>
        </details>
        <div className="account-danger-zone">
          <div>
            <h2>Sign out</h2>
            <p>End this session on the current browser.</p>
          </div>
          <Button className="ui-button logout-button" variant="outline" onClick={onLogout}>
            <LogOut /> Sign out
          </Button>
        </div>
      </section>
    </main>
  );
}
