// Employees added without an email get an internal placeholder login email on the server;
// never show that as if it were a real address.
export function displayEmail(email?: string | null) {
  return email && !email.endsWith('@mobile.errance.local') ? email : null;
}
