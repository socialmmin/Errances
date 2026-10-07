import { PERMISSIONS, Permission, roleHasPermission } from '../rbac/role-permissions';

// Every page (sidebar entry) and section an admin can switch on/off per employee. The frontend
// fetches this same catalog (GET /access/catalog) so the panel, the sidebar and the server can
// never disagree about what exists.
export interface AccessItem {
  key: string;
  label: string;
  parent?: string; // sections belong to a page
  sensitive?: boolean;
  // Role permission(s) that make this ON by default for a role. Absent => uses `defaultOn`.
  defaultFrom?: Permission[];
  defaultOn?: boolean;
  // Permissions this item GRANTS when switched on for someone whose role lacks them, so turning
  // a page on actually works end to end instead of the page loading and every request failing.
  grants?: Permission[];
}

export const ACCESS_CATALOG: AccessItem[] = [
  { key: 'dashboard', label: 'Dashboard', defaultOn: true },
  { key: 'dashboard.meta_ads', label: 'Meta Ads balance', parent: 'dashboard', sensitive: true, defaultOn: false },
  { key: 'dashboard.wa_billing', label: 'WhatsApp billing this month', parent: 'dashboard', sensitive: true, defaultOn: false },
  { key: 'dashboard.coverage', label: 'Ad campaign → itinerary coverage', parent: 'dashboard', sensitive: true, defaultOn: false, grants: [PERMISSIONS.PACKAGES_VIEW] },
  { key: 'dashboard.failed', label: 'Failed WhatsApp follow-ups', parent: 'dashboard', defaultFrom: [PERMISSIONS.LEADS_VIEW], grants: [PERMISSIONS.PACKAGES_VIEW] },
  { key: 'dashboard.calls', label: 'Calls & follow-ups', parent: 'dashboard', defaultFrom: [PERMISSIONS.LEADS_VIEW], grants: [PERMISSIONS.LEADS_VIEW] },
  { key: 'dashboard.new_leads', label: 'New leads', parent: 'dashboard', defaultFrom: [PERMISSIONS.LEADS_VIEW], grants: [PERMISSIONS.LEADS_VIEW] },
  { key: 'dashboard.quotations', label: 'Quotations', parent: 'dashboard', defaultFrom: [PERMISSIONS.QUOTATIONS_VIEW], grants: [PERMISSIONS.QUOTATIONS_VIEW] },

  { key: 'leads', label: 'Leads', defaultFrom: [PERMISSIONS.LEADS_VIEW], grants: [PERMISSIONS.LEADS_VIEW, PERMISSIONS.LEADS_EDIT] },
  { key: 'leads.add', label: 'Add lead', parent: 'leads', defaultFrom: [PERMISSIONS.LEADS_CREATE], grants: [PERMISSIONS.LEADS_CREATE] },
  { key: 'leads.import', label: 'Import from Excel', parent: 'leads', defaultFrom: [PERMISSIONS.LEADS_ASSIGN], grants: [PERMISSIONS.LEADS_CREATE] },
  { key: 'leads.export', label: 'Export to Excel', parent: 'leads', defaultFrom: [PERMISSIONS.LEADS_EXPORT], grants: [PERMISSIONS.LEADS_EXPORT] },
  { key: 'leads.delete', label: 'Delete leads', parent: 'leads', defaultFrom: [PERMISSIONS.LEADS_DELETE], grants: [PERMISSIONS.LEADS_DELETE] },
  { key: 'leads.assign', label: 'Assign leads to others', parent: 'leads', defaultFrom: [PERMISSIONS.LEADS_ASSIGN], grants: [PERMISSIONS.LEADS_ASSIGN] },

  { key: 'followups', label: 'Follow-ups', defaultFrom: [PERMISSIONS.LEADS_VIEW], grants: [PERMISSIONS.LEADS_VIEW, PERMISSIONS.LEADS_EDIT] },
  { key: 'followups.complete', label: 'Complete / reschedule', parent: 'followups', defaultFrom: [PERMISSIONS.LEADS_EDIT], grants: [PERMISSIONS.LEADS_EDIT] },
  { key: 'followups.cancel', label: 'Cancel follow-ups', parent: 'followups', defaultFrom: [PERMISSIONS.LEADS_EDIT], grants: [PERMISSIONS.LEADS_EDIT] },

  { key: 'callbacks', label: 'Callback Requests', defaultFrom: [PERMISSIONS.LEADS_VIEW], grants: [PERMISSIONS.LEADS_VIEW, PERMISSIONS.LEADS_EDIT] },
  { key: 'failed_whatsapp', label: 'Failed WhatsApp', defaultFrom: [PERMISSIONS.LEADS_VIEW], grants: [PERMISSIONS.PACKAGES_VIEW, PERMISSIONS.PACKAGES_EDIT] },
  { key: 'packages', label: 'Packages & Itinerary', defaultFrom: [PERMISSIONS.PACKAGES_EDIT], grants: [PERMISSIONS.PACKAGES_VIEW, PERMISSIONS.PACKAGES_CREATE, PERMISSIONS.PACKAGES_EDIT] },
  { key: 'quotations', label: 'Quotations', defaultFrom: [PERMISSIONS.QUOTATIONS_VIEW], grants: [PERMISSIONS.QUOTATIONS_VIEW, PERMISSIONS.QUOTATIONS_CREATE, PERMISSIONS.QUOTATIONS_EDIT, PERMISSIONS.QUOTATIONS_SEND] },
  { key: 'invoices', label: 'Invoices', defaultFrom: [PERMISSIONS.FINANCE_VIEW], grants: [PERMISSIONS.FINANCE_VIEW, PERMISSIONS.FINANCE_COLLECT_PAYMENT] },
  { key: 'whatsapp', label: 'WhatsApp Inbox', defaultFrom: [PERMISSIONS.LEADS_VIEW], grants: [PERMISSIONS.LEADS_VIEW, PERMISSIONS.LEADS_EDIT] },
  { key: 'whatsapp_broadcast', label: 'Bulk WhatsApp', sensitive: true, defaultOn: false, grants: [PERMISSIONS.LEADS_VIEW] },
  { key: 'reports', label: 'Reports', defaultOn: false, grants: [PERMISSIONS.REPORTS_VIEW] },
  { key: 'meta_quality', label: 'Meta Quality', defaultOn: false, grants: [PERMISSIONS.REPORTS_VIEW] },
];

export const ACCESS_KEYS = new Set(ACCESS_CATALOG.map((i) => i.key));

export type AccessMap = Record<string, boolean>;

export function roleDefaults(roleName: string | undefined): AccessMap {
  const out: AccessMap = {};
  for (const item of ACCESS_CATALOG) {
    out[item.key] = roleName === 'super_admin'
      ? true
      : item.defaultFrom ? item.defaultFrom.every((p) => roleHasPermission(roleName, p)) : !!item.defaultOn;
  }
  return out;
}

// Role defaults with the employee's own overrides applied. A section is only effective if its
// page is also on. super_admin always gets everything -- overrides are ignored for them.
export function effectiveAccess(roleName: string | undefined, overrides: AccessMap | null | undefined): AccessMap {
  const base = roleDefaults(roleName);
  if (roleName === 'super_admin') return base;
  for (const [k, v] of Object.entries(overrides ?? {})) if (ACCESS_KEYS.has(k)) base[k] = !!v;
  for (const item of ACCESS_CATALOG) if (item.parent && !base[item.parent]) base[item.key] = false;
  return base;
}

export function grantedPermissions(access: AccessMap): Set<Permission> {
  const out = new Set<Permission>();
  for (const item of ACCESS_CATALOG) if (access[item.key]) for (const p of item.grants ?? []) out.add(p);
  return out;
}
