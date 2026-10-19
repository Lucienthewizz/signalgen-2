import { type FormEvent, useEffect, useRef, useState } from "react";
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
  profileAvatarOptions,
  saveProfileAvatar,
  saveProfileName,
  type ProfileAvatarKey,
} from "@/lib/profile-avatar";
import { api, ApiError } from "@/api/client";
import type { EditableProfile, User } from "@/types";

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
  const [displayName, setDisplayName] = useState(fallbackName);
  const [nameDraft, setNameDraft] = useState(displayName);
  const [editingProfile, setEditingProfile] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [profile, setProfile] = useState<EditableProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileReload, setProfileReload] = useState(0);
  const owner = useRef(user.id);
  owner.current = user.id;
  const [avatarKey, setAvatarKey] = useState<ProfileAvatarKey>(() =>
    getSavedProfileAvatar(user.id),
  );
  const avatar = getProfileAvatar(avatarKey);
  const AvatarIcon = avatar.Icon;

  useEffect(() => {
    let active = true;
    setAvatarKey(getSavedProfileAvatar(user.id));
    setProfile(null);
    setProfileLoading(true);
    setProfileSaving(false);
    setProfileError(null);
    setNameSaved(false);
    setEditingProfile(false);
    setDisplayName(fallbackName);
    setNameDraft(fallbackName);
    // The server is authoritative. Local names are only a display cache for
    // existing workspace menus, updated after a verified read/save succeeds.
    api
      .ensureAppSession()
      .then(() => api.getProfile())
      .then((loaded) => {
        if (!active) return;
        if (loaded.user_id !== user.id)
          throw new ApiError(
            "The profile does not match the signed-in account.",
            0,
          );
        const nextName = loaded.display_name || fallbackName;
        setProfile(loaded);
        setDisplayName(nextName);
        setNameDraft(nextName);
        saveProfileName(user.id, nextName);
      })
      .catch((error: unknown) => {
        if (active)
          setProfileError(
            error instanceof ApiError
              ? error.message
              : "The profile could not be loaded.",
          );
      })
      .finally(() => {
        if (active) setProfileLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fallbackName, profileReload, user.id]);

  function chooseAvatar(nextAvatar: ProfileAvatarKey) {
    saveProfileAvatar(user.id, nextAvatar);
    setAvatarKey(nextAvatar);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || profileSaving) return;
    const nextName = nameDraft.trim() || fallbackName;
    const expectedOwner = user.id;
    setProfileSaving(true);
    setProfileError(null);
    setNameSaved(false);
    try {
      const saved = await api.updateProfile(profile.version, nextName);
      if (owner.current !== expectedOwner) return;
      if (saved.user_id !== expectedOwner)
        throw new ApiError("The saved profile does not match this account.", 0);
      const savedName = saved.display_name || fallbackName;
      setProfile(saved);
      saveProfileName(expectedOwner, savedName);
      setDisplayName(savedName);
      setNameDraft(savedName);
      setNameSaved(true);
      setEditingProfile(false);
    } catch (error) {
      if (owner.current !== expectedOwner) return;
      if (error instanceof ApiError && error.status === 409) {
        // Never replay a stale write. Read the latest version, then let the
        // user review and submit again instead of overwriting another editor.
        setProfile(null);
        setProfileError(
          "This profile changed elsewhere. Reload it before saving again.",
        );
      } else {
        setProfileError(
          error instanceof ApiError
            ? error.message
            : "The profile could not be saved.",
        );
      }
    } finally {
      if (owner.current === expectedOwner) setProfileSaving(false);
    }
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
                  <p>Your account display name: {displayName}</p>
                </div>
                <Button
                  className="profile-sheet__edit"
                  variant="ghost"
                  size="icon"
                  aria-label="Edit profile"
                  disabled={profileLoading || profileSaving || !profile}
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
                      maxLength={100}
                      disabled={profileSaving}
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
                  <strong>Account name synced; profile mark local</strong>
                </div>
                {editingProfile && (
                  <div className="profile-form-actions">
                    <p>
                      Your name is saved to your account. The profile mark stays
                      on this device.
                    </p>
                    <div>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={cancelProfileEdit}
                        disabled={profileSaving}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={profileSaving || !profile}
                      >
                        {profileSaving ? "Saving…" : "Save changes"}
                      </Button>
                    </div>
                  </div>
                )}
                {nameSaved && (
                  <p className="profile-save-status" role="status">
                    Profile saved to your account.
                  </p>
                )}
                {profileLoading && (
                  <p role="status">Loading account profile…</p>
                )}
                {profileError && (
                  <div role="alert">
                    <p>{profileError}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={profileLoading || profileSaving}
                      onClick={() => setProfileReload((value) => value + 1)}
                    >
                      Reload profile
                    </Button>
                  </div>
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
