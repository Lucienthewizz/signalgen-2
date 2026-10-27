import { useEffect, useState } from "react";
import { LogOut, Settings2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getProfileAvatar,
  getSavedProfileAvatar,
  getSavedProfileName,
  type ProfileAvatarKey,
} from "@/lib/profile-avatar";
import type { User } from "@/types";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";

export function AccountMenu({
  user,
  onLogout,
  variant,
  collapsed = false,
}: {
  user: User;
  onLogout: () => void | Promise<void>;
  variant: "landing" | "workspace" | "sidebar";
  collapsed?: boolean;
}) {
  const [avatarKey, setAvatarKey] = useState<ProfileAvatarKey>(() =>
    getSavedProfileAvatar(user.id),
  );
  const avatar = getProfileAvatar(avatarKey);
  const AvatarIcon = avatar.Icon;
  const fallbackName = user.full_name?.trim() || user.email.split("@")[0];
  const [name, setName] = useState(() =>
    getSavedProfileName(user.id, fallbackName),
  );
  const triggerLabel = name;
  const isSidebarMenu = variant === "sidebar";
  const isCompactMenu = isSidebarMenu && collapsed;
  const [subscriptionInfo, setSubscriptionInfo] = useState<{
    userId: string;
    label: string;
    status: string;
  } | null>(null);
  const planLabel =
    subscriptionInfo?.userId === user.id
      ? subscriptionInfo.label
      : "Subscription";
  const planStatus =
    subscriptionInfo?.userId === user.id ? subscriptionInfo.status : "Loading…";
  useEffect(() => {
    let active = true;
    const loadSubscription = () => {
      void api
        .currentSubscription()
        .then(({ subscription }) => {
          if (!active) return;
          const statuses: Record<string, string> = {
            active: "Active",
            trialing: "Trial",
            past_due: "Past due",
            canceled: "Canceled",
            expired: "Expired",
          };
          setSubscriptionInfo({
            userId: user.id,
            label: subscription?.plan_name || subscription?.plan_code || "Free",
            status: subscription
              ? statuses[subscription.status] || subscription.status
              : "No paid subscription",
          });
        })
        .catch(() => {
          if (active)
            setSubscriptionInfo({
              userId: user.id,
              label: "Subscription",
              status: "Unavailable",
            });
        });
    };
    loadSubscription();
    addEventListener("signalgen:subscription", loadSubscription);
    return () => {
      active = false;
      removeEventListener("signalgen:subscription", loadSubscription);
    };
  }, [user.id]);

  useEffect(() => {
    const syncAvatar = () => setAvatarKey(getSavedProfileAvatar(user.id));
    const syncName = () => setName(getSavedProfileName(user.id, fallbackName));
    syncAvatar();
    syncName();
    addEventListener("signalgen:profile-avatar", syncAvatar);
    addEventListener("signalgen:profile-name", syncName);
    addEventListener("storage", syncAvatar);
    return () => {
      removeEventListener("signalgen:profile-avatar", syncAvatar);
      removeEventListener("signalgen:profile-name", syncName);
      removeEventListener("storage", syncAvatar);
    };
  }, [fallbackName, user.id]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={`account-menu__trigger account-menu__trigger--${variant}`}
            aria-label={`Open ${triggerLabel} menu`}
            data-collapsed={isCompactMenu || undefined}
          />
        }
      >
        <Avatar
          className={`account-menu__avatar account-avatar--${avatarKey}`}
          size="sm"
        >
          <AvatarFallback>
            <AvatarIcon aria-hidden="true" />
          </AvatarFallback>
        </Avatar>
        <span className="account-menu__identity">
          <span>{triggerLabel}</span>
          <small>
            {planLabel} · {planStatus}
          </small>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className={cn("account-menu__content", {
          "account-menu__content--sidebar": isSidebarMenu,
          "account-menu__content--rail": isCompactMenu,
        })}
        align={isCompactMenu ? "end" : isSidebarMenu ? "start" : "end"}
        side={isCompactMenu ? "right" : isSidebarMenu ? "top" : "bottom"}
        sideOffset={isCompactMenu ? 20 : isSidebarMenu ? 0 : 8}
      >
        <DropdownMenuGroup>
          {isCompactMenu && (
            <>
              <DropdownMenuLabel className="account-menu__summary">
                <Avatar
                  className={`account-menu__avatar account-menu__summary-avatar account-avatar--${avatarKey}`}
                >
                  <AvatarFallback>
                    <AvatarIcon aria-hidden="true" />
                  </AvatarFallback>
                </Avatar>
                <span className="account-menu__summary-copy">
                  <strong>{triggerLabel}</strong>
                  <span>{user.email}</span>
                  <small>
                    {planLabel} · {planStatus}
                  </small>
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="account-menu__separator" />
            </>
          )}
          <DropdownMenuItem
            className="account-menu__item"
            aria-label="Account"
            onClick={() => {
              location.hash = "account";
            }}
          >
            <Settings2 aria-hidden="true" />
            {isCompactMenu ? (
              <span className="account-menu__action-copy">
                <span>Account</span>
                <small>Profile, plan &amp; devices</small>
              </span>
            ) : (
              "Account"
            )}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="account-menu__separator" />
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="account-menu__item"
            variant="destructive"
            aria-label="Log out"
            onClick={() => void onLogout()}
          >
            <LogOut aria-hidden="true" />
            {isCompactMenu ? (
              <span className="account-menu__action-copy">
                <span>Log out</span>
                <small>Sign out of this account</small>
              </span>
            ) : (
              "Log out"
            )}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
