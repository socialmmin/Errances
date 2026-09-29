// When a session expires the user is sent to /login; remember the page so they
// land back exactly where they were after signing in again.
const KEY = 'crm-return-path';

export function saveReturnPath() {
  try {
    const path = window.location.pathname + window.location.search;
    if (!path.startsWith('/login')) window.localStorage.setItem(KEY, path);
  } catch { /* storage unavailable */ }
}

export function takeReturnPath(): string | null {
  try {
    const path = window.localStorage.getItem(KEY);
    window.localStorage.removeItem(KEY);
    return path && path.startsWith('/') && !path.startsWith('//') ? path : null;
  } catch { return null; }
}
