/** Session flag: home entrance splash already shown (clears on tab close / new session). */
export const HOME_SPLASH_SESSION_KEY = "ai-tools-home-splash-v1";

export function hasHomeSplashBeenSeen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(HOME_SPLASH_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function markHomeSplashSeen(): void {
  try {
    sessionStorage.setItem(HOME_SPLASH_SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function clearHomeSplashSession(): void {
  try {
    sessionStorage.removeItem(HOME_SPLASH_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
