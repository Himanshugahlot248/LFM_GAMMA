import { v5 as uuidv5 } from "uuid";

/** RFC 4122 DNS namespace — must match `derive_user_id_from_username_normalized` in Python. */
const NAMESPACE_DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

export function normalizeUsernameInput(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s.length < 2 || s.length > 32) {
    throw new Error("Username must be 2–32 characters.");
  }
  if (!/^[a-z0-9_\-]+$/.test(s)) {
    throw new Error("Use letters, numbers, underscores, or hyphens only.");
  }
  return s;
}

export function deriveUserIdFromNormalizedUsername(norm: string): string {
  return uuidv5(`lf.local.username:${norm}`, NAMESPACE_DNS);
}
