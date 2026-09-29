import { useEffect, useState } from "react";
import { LogOut, Settings2 } from "lucide-react";
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
        <span>{triggerLabel}</span>
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
