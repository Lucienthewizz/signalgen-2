import { useEffect, useState } from "react";
import { BadgeCheck, LogOut, Settings2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
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

export function AccountMenu({
  user,
  onLogout,
  variant,
}: {
  user: User;
  onLogout: () => void | Promise<void>;
  variant: "landing" | "workspace" | "sidebar";
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
        className={`account-menu__content${isSidebarMenu ? " account-menu__content--sidebar" : ""}`}
        align={isSidebarMenu ? "start" : "end"}
        side={isSidebarMenu ? "top" : "bottom"}
        sideOffset={isSidebarMenu ? 0 : 8}
      >
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="account-menu__item"
            onClick={() => {
              location.hash = "account";
            }}
          >
            <Settings2 aria-hidden="true" />
            Account
          </DropdownMenuItem>
          <DropdownMenuItem
            className="account-menu__item account-menu__plan"
            onClick={() => {
              location.hash = "app/subscription";
            }}
          >
            <BadgeCheck aria-hidden="true" />
            <span className="account-menu__plan-copy">
              <span>Subscription</span>
              <small>{planStatus}</small>
            </span>
            <span className="account-menu__plan-badge">{planLabel}</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator className="account-menu__separator" />
        <DropdownMenuGroup>
          <DropdownMenuItem
            className="account-menu__item"
            variant="destructive"
            onClick={() => void onLogout()}
          >
            <LogOut aria-hidden="true" />
            Log out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
