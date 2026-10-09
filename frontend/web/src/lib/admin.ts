export type AdminAction = "grant" | "revoke" | "subscription" | "role";

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
  if (action === "grant" || action === "subscription") {
    const expiry = new Date(expiresAt).valueOf();
    if (!Number.isFinite(expiry) || expiry <= now)
      return "Choose an expiry date and time in the future.";
  }
  return null;
}
