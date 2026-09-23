# CRM usability and account checks

## Staff accounts

Admins use **Staff → Add Member** to enter a name, email, role, login ID and password (at least 8 characters). Staff can sign in with either that login ID or email. Editing an account with the password field blank preserves its password. Setting a new password replaces it. Inactive accounts cannot log in or use an existing API session. Staff profiles are saved in the same transaction as their accounts so lead assignment works immediately.

Existing accounts keep their credentials. Accounts without a login ID can continue using email; assign an ID when editing them. Account creation/update is handled by `/api/staff`, not direct table writes. Password hashes are excluded from staff queries and realtime events.

## Packages

Packages support departure city, availability, accommodation, meals, transport, inclusions/exclusions, booking/cancellation terms and a rich-text itinerary. Empty fields are displayed as unspecified. **View details** opens the package brief. **Create enquiry** opens a lead form with the package and budget prefilled. A failed save leaves the form open.

## Validation

`npm run build` builds the frontend. `npm --prefix backend test` builds the backend and runs the CRM and WhatsApp integration suites. The suites use only the disposable Postgres database at `127.0.0.1:55439/errances_test`; they must never be pointed at production. WhatsApp transport is mocked in the workflow suite.

CRM checks cover staff ID/email login, duplicate IDs, admin permissions, password reset, deactivation including existing sessions, profile mirroring, package create/edit persistence, lead assignment/status history, follow-ups, notes, payment ledger entries and table reads.

Browser checks cover main navigation, actual dashboard scrolling, scrollable staff/lead dialogs, mobile navigation closing, mobile staff form bounds, package edit/save/detail, enquiry prefill and staff login with the correct role. API integration tests do not send customer messages or take payments.

The app uses the Express API in `backend/`; the `supabase` frontend module is a compatibility client, not a dependency on Supabase Edge Functions.
