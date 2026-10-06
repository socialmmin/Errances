import { effectiveAccess, grantedPermissions, roleDefaults } from './access-catalog';
import { PERMISSIONS } from '../rbac/role-permissions';

describe('access catalog', () => {
  it('super_admin gets everything, and overrides cannot take anything away', () => {
    const a = effectiveAccess('super_admin', { reports: false, 'dashboard.meta_ads': false });
    expect(Object.values(a).every(Boolean)).toBe(true);
  });

  it('sales_executive defaults: sensitive dashboard sections and reports are off', () => {
    const d = roleDefaults('sales_executive');
    expect(d.dashboard).toBe(true);
    expect(d['dashboard.meta_ads']).toBe(false);
    expect(d['dashboard.wa_billing']).toBe(false);
    expect(d['dashboard.coverage']).toBe(false);
    expect(d['dashboard.new_leads']).toBe(true);
    expect(d.leads).toBe(true);
    expect(d['leads.delete']).toBe(false);
    expect(d.reports).toBe(false);
    expect(d.meta_quality).toBe(false);
  });

  it('an override switches a page off', () => {
    expect(effectiveAccess('sales_executive', { leads: false }).leads).toBe(false);
  });

  it('a section is off whenever its page is off, even if the section itself is on', () => {
    const a = effectiveAccess('sales_executive', { dashboard: false, 'dashboard.new_leads': true });
    expect(a['dashboard.new_leads']).toBe(false);
  });

  it('unknown keys in saved overrides are ignored', () => {
    expect(effectiveAccess('sales_executive', { not_a_page: true } as any).not_a_page).toBeUndefined();
  });

  it('switching a page on grants the permissions it needs; switching it off grants nothing', () => {
    expect(grantedPermissions(effectiveAccess('hr_executive', { invoices: true })).has(PERMISSIONS.FINANCE_VIEW)).toBe(true);
    expect(grantedPermissions(effectiveAccess('hr_executive', {})).has(PERMISSIONS.FINANCE_VIEW)).toBe(false);
  });
});
