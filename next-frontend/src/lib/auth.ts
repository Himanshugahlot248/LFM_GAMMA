export type StoredUser = {
  userId: string;
  /** Lowercase normalized handle (unique). */
  username: string;
  /** Synthetic email for display/API: `{username}@lf.local` */
  email: string;
  name?: string;
};

export const AUTH_STORAGE_KEY = "ai_ppt_user";

export function getStoredUser(): StoredUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const u = JSON.parse(raw) as Partial<StoredUser>;
    if (!u?.userId || !u?.username || !u?.email) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      return null;
    }
    return u as StoredUser;
  } catch {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

export function setStoredUser(user: StoredUser): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
}

export function clearStoredUser(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}
