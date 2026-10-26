export type AdminAction = "grant" | "revoke" | "subscription" | "role";

export function accessExpiry(days: number, now = Date.now()) {
  const end = new Date(now + days * 86400000);
  return new Date(end.valueOf() - end.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

export function validateAdminChange(
  userId: string,
  reason: string,
  action: AdminAction,
  expiresAt: string,
  now = Date.now(),
): string | null {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      userId.trim(),
    )
  )
    return "Enter a valid account User ID (UUID).";
  if (!reason.trim()) return "Add a reason for this change.";
  if (reason.trim().length > 500)
    return "Keep the reason within 500 characters.";
  if (/[\x00-\x1f\x7f-\x9f]/.test(reason))
    return "Use a single-line reason without control characters.";
  if (action === "grant" || action === "subscription") {
    const expiry = new Date(expiresAt).valueOf();
    if (!Number.isFinite(expiry) || expiry <= now)
      return "Choose an expiry date and time in the future.";
  }
  return null;
}
