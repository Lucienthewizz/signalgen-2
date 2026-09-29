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
import { getProfileAvatar, getSavedProfileAvatar, type ProfileAvatarKey } from "@/lib/profile-avatar";
import type { User } from "@/types";

export function AccountMenu({
  user,
  onLogout,
  label,
  variant,
}: {
  user: User;
  onLogout: () => void | Promise<void>;
  label: "Profile" | "Account";
  variant: "landing" | "workspace";
}) {
  const [avatarKey, setAvatarKey] = useState<ProfileAvatarKey>(() =>
    getSavedProfileAvatar(user.id),
  );
  const avatar = getProfileAvatar(avatarKey);
  const AvatarIcon = avatar.Icon;
  const name = user.full_name?.trim() || user.email.split("@")[0];

  useEffect(() => {
    const syncAvatar = () => setAvatarKey(getSavedProfileAvatar(user.id));
    syncAvatar();
    addEventListener("signalgen:profile-avatar", syncAvatar);
    addEventListener("storage", syncAvatar);
    return () => {
      removeEventListener("signalgen:profile-avatar", syncAvatar);
      removeEventListener("storage", syncAvatar);
    };
  }, [user.id]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={`account-menu__trigger account-menu__trigger--${variant}`}
            aria-label={`Open ${label.toLowerCase()} menu`}
          />
        }
      >
        <Avatar className={`account-menu__avatar account-avatar--${avatarKey}`} size="sm">
          <AvatarFallback>
            <AvatarIcon aria-hidden="true" />
          </AvatarFallback>
        </Avatar>
        <span>{label}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="account-menu__content"
        align="end"
        sideOffset={8}
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className="account-menu__identity">
            <strong>{name}</strong>
            <span>{user.email}</span>
          </DropdownMenuLabel>
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
