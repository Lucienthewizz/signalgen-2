import type { LucideIcon } from "lucide-react";
import {
  CandlestickChart,
  Compass,
  Orbit,
  Radar,
  ScanLine,
  Sparkles,
} from "lucide-react";

export const AVATAR_STORAGE_PREFIX = "signalgen.profile-avatar.";

export const profileAvatarOptions = [
  { key: "orbit", label: "Orbit", Icon: Orbit },
  { key: "signal", label: "Signal", Icon: Radar },
  { key: "market", label: "Market", Icon: CandlestickChart },
  { key: "scan", label: "Scanner", Icon: ScanLine },
  { key: "compass", label: "Compass", Icon: Compass },
  { key: "spark", label: "Spark", Icon: Sparkles },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  Icon: LucideIcon;
}>;

export type ProfileAvatarKey = (typeof profileAvatarOptions)[number]["key"];

export const defaultProfileAvatar: ProfileAvatarKey = "orbit";

export function getSavedProfileAvatar(userId: string): ProfileAvatarKey {
  if (typeof window === "undefined") return defaultProfileAvatar;
  const saved = localStorage.getItem(`${AVATAR_STORAGE_PREFIX}${userId}`);
  return profileAvatarOptions.some((avatar) => avatar.key === saved)
    ? (saved as ProfileAvatarKey)
    : defaultProfileAvatar;
}

export function saveProfileAvatar(userId: string, avatar: ProfileAvatarKey) {
  localStorage.setItem(`${AVATAR_STORAGE_PREFIX}${userId}`, avatar);
  window.dispatchEvent(new Event("signalgen:profile-avatar"));
}

export function getProfileAvatar(key: ProfileAvatarKey) {
  return (
    profileAvatarOptions.find((avatar) => avatar.key === key) ??
    profileAvatarOptions[0]
  );
}
