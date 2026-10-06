import { type FormEvent, useEffect, useState } from "react";
import {
  ArrowLeft,
  Bell,
  ChevronRight,
  KeyRound,
  Link2,
  LogOut,
  MonitorSmartphone,
  Pencil,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  getProfileAvatar,
  getSavedProfileAvatar,
  getSavedProfileName,
  profileAvatarOptions,
  saveProfileAvatar,
  saveProfileName,
  type ProfileAvatarKey,
} from "@/lib/profile-avatar";
import type { User } from "@/types";

type AccountSection =
  "profile" | "password" | "notifications" | "privacy" | "devices";

const settingItems: Array<{
  id: AccountSection;
  label: string;
  Icon: typeof UserRound;
}> = [
  { id: "profile", label: "Profile", Icon: UserRound },
  { id: "password", label: "Password", Icon: KeyRound },
  { id: "notifications", label: "Notifications", Icon: Bell },
  { id: "privacy", label: "Privacy and access", Icon: ShieldCheck },
  { id: "devices", label: "Linked devices", Icon: MonitorSmartphone },
];

export function AccountPage({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const fallbackName = user.full_name?.trim() || user.email.split("@")[0];
  const [activeSection, setActiveSection] = useState<AccountSection>("profile");
  const [displayName, setDisplayName] = useState(() =>
    getSavedProfileName(user.id, fallbackName),
  );
  const [nameDraft, setNameDraft] = useState(displayName);
  const [editingProfile, setEditingProfile] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [avatarKey, setAvatarKey] = useState<ProfileAvatarKey>(() =>
    getSavedProfileAvatar(user.id),
  );
  const avatar = getProfileAvatar(avatarKey);
  const AvatarIcon = avatar.Icon;

  useEffect(() => {
    setAvatarKey(getSavedProfileAvatar(user.id));
    const nextName = getSavedProfileName(user.id, fallbackName);
    setDisplayName(nextName);
    setNameDraft(nextName);
  }, [fallbackName, user.id]);

  function chooseAvatar(nextAvatar: ProfileAvatarKey) {
    saveProfileAvatar(user.id, nextAvatar);
    setAvatarKey(nextAvatar);
  }

  function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = nameDraft.trim() || fallbackName;
    saveProfileName(user.id, nextName);
    setDisplayName(nextName);
    setNameDraft(nextName);
    setNameSaved(true);
    setEditingProfile(false);
  }

  function cancelProfileEdit() {
    setNameDraft(displayName);
    setEditingProfile(false);
  }

  return (
    <main className="account-page">
      <header className="account-topbar">
        <div className="account-topbar__inner">
          <a href="#home" aria-label="Signalgen home">
            <Brand compact />
          </a>
          <div className="account-topbar__actions">
            <ThemeToggle compact />
            <a href="#app/overview">
              <ArrowLeft aria-hidden="true" /> Back to workspace
            </a>
          </div>
        </div>
      </header>

      <section className="account-layout" aria-label="Account settings">
        <aside className="account-sidebar">
          <h1>Settings</h1>
          <nav aria-label="Account settings navigation">
            {settingItems.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                className="account-sidebar__item"
                data-active={activeSection === id || undefined}
                onClick={() => setActiveSection(id)}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="account-sidebar__footer">
            <Button variant="outline" onClick={onLogout}>
              <LogOut aria-hidden="true" /> Sign out
            </Button>
          </div>
        </aside>

        <section className="account-panel" aria-live="polite">
          {activeSection === "profile" && (
            <section className="profile-sheet" aria-labelledby="profile-title">
              <header className="profile-sheet__header">
                <a
                  href="#app/overview"
                  className="profile-sheet__back"
                  aria-label="Back to workspace"
                >
                  <ArrowLeft aria-hidden="true" />
                </a>
                <Avatar
                  className={`account-avatar account-avatar--${avatarKey}`}
                  size="lg"
                >
                  <AvatarFallback>
                    <AvatarIcon aria-hidden="true" />
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h2 id="profile-title">My Signalgen profile</h2>
                  <p>Shown in this browser as {displayName}</p>
                </div>
                <Button
                  className="profile-sheet__edit"
                  variant="ghost"
                  size="icon"
                  aria-label="Edit profile"
                  onClick={() => {
                    setNameSaved(false);
                    setEditingProfile(true);
                  }}
                >
                  <Pencil aria-hidden="true" />
                </Button>
              </header>

              <form className="profile-fields" onSubmit={saveProfile}>
                <div className="profile-field">
                  <span>Name</span>
                  {editingProfile ? (
                    <Input
                      aria-label="Display name"
                      value={nameDraft}
                      maxLength={48}
                      autoFocus
                      onChange={(event) => setNameDraft(event.target.value)}
                    />
                  ) : (
                    <strong>{displayName}</strong>
                  )}
                </div>
                <div className="profile-field">
                  <span>Email</span>
                  <strong>{user.email}</strong>
                </div>
                <div className="profile-field profile-field--mark">
                  <span>Profile mark</span>
                  {editingProfile ? (
                    <ToggleGroup
                      className="profile-mark-picker"
                      value={[avatarKey]}
                      onValueChange={(value) => {
                        const nextAvatar = value.at(-1);
                        if (nextAvatar)
                          chooseAvatar(nextAvatar as ProfileAvatarKey);
                      }}
                      variant="outline"
                      spacing={0}
                      aria-label="Profile mark choices"
                    >
                      {profileAvatarOptions.map(({ key, label, Icon }) => (
                        <ToggleGroupItem
                          key={key}
                          value={key}
                          aria-label={`Use ${label} mark`}
                          title={label}
                        >
                          <Icon aria-hidden="true" />
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  ) : (
                    <span className="profile-field__mark">
                      <Avatar
                        className={`account-avatar account-avatar--${avatarKey}`}
                        size="sm"
                      >
                        <AvatarFallback>
                          <AvatarIcon aria-hidden="true" />
                        </AvatarFallback>
                      </Avatar>
                      {avatar.label}
                    </span>
                  )}
                </div>
                <div className="profile-field">
                  <span>Visibility</span>
                  <strong>This browser only</strong>
                </div>
                {editingProfile && (
                  <div className="profile-form-actions">
                    <p>
                      Changes to your name and mark are saved only on this
                      device.
                    </p>
                    <div>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={cancelProfileEdit}
                      >
                        Cancel
                      </Button>
                      <Button type="submit">Save changes</Button>
                    </div>
                  </div>
                )}
                {nameSaved && (
                  <p className="profile-save-status">Profile saved locally.</p>
                )}
              </form>
            </section>
          )}
          {activeSection === "password" && (
            <SettingsNotice
              title="Password"
              description="Reset your password through the secure account recovery flow."
              action="Reset password"
              href="#forgot-password"
              Icon={KeyRound}
            />
          )}
          {activeSection === "notifications" && (
            <SettingsNotice
              title="Notifications"
              description="Notification preferences will be available when workspace alerts are connected."
              Icon={Bell}
            />
          )}
          {activeSection === "privacy" && (
            <SettingsNotice
              title="Privacy and access"
              description="Your workspace identity is authenticated through the current Supabase bearer session."
              action="Review workspace access"
              href="#app/access"
              Icon={ShieldCheck}
            />
          )}
          {activeSection === "devices" && (
            <SettingsNotice
              title="Linked devices"
              description="Manage the devices that can use this workspace session."
              action="Open linked devices"
              href="#app/access"
              Icon={Link2}
            />
          )}
        </section>
      </section>
    </main>
  );
}

function SettingsNotice({
  title,
  description,
  action,
  href,
  Icon,
}: {
  title: string;
  description: string;
  action?: string;
  href?: string;
  Icon: typeof KeyRound;
}) {
  return (
    <section className="settings-notice">
      <Icon aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action && href && (
        <a href={href} className="settings-notice__action">
          {action} <ChevronRight aria-hidden="true" />
        </a>
      )}
    </section>
  );
}
