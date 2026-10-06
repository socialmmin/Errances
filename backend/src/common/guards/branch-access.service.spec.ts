import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BranchAccessService } from './branch-access.service';

// Regression tests for the IDOR fix (Leads, Customers, Bookings, Quotations, Invoices/Payments
// all route their :id authorization through this one shared check). Uses a mocked Pool -- no
// real database needed, safe to run anywhere, anytime, including in CI before every deploy.
// Proves the exact matrix asked for: own-branch allow, other-branch deny, wrong/missing user
// deny, super_admin always allow, unknown record 404s instead of leaking a 403/200 distinction.
describe('BranchAccessService', () => {
  const BRANCH_A = 'branch-a';
  const BRANCH_B = 'branch-b';
  const RECORD_ID = 'record-1';

  function makeService(recordBranchId: string | null) {
    const query = jest.fn().mockResolvedValue({ rows: recordBranchId === null ? [] : [{ branch_id: recordBranchId }] });
    const audit = { log: jest.fn() };
    const service = new BranchAccessService({ query } as any, audit as any);
    return { service, query, audit };
  }

  it('allows an agent to access a record in their own branch', async () => {
    const { service, audit } = makeService(BRANCH_A);
    await expect(service.assertAccess('leads', RECORD_ID, { userId: 'u1', roleName: 'sales_executive', branchId: BRANCH_A })).resolves.toBeUndefined();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('denies an agent accessing another branch\'s record, and logs it', async () => {
    const { service, audit } = makeService(BRANCH_B);
    await expect(service.assertAccess('leads', RECORD_ID, { userId: 'u1', roleName: 'sales_executive', branchId: BRANCH_A })).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'access_denied', resourceType: 'leads', resourceId: RECORD_ID, result: 'denied' }));
  });

  it('denies a user with no branch assigned (fails closed, never falls open to "see everything")', async () => {
    const { service } = makeService(BRANCH_A);
    await expect(service.assertAccess('bookings', RECORD_ID, { userId: 'u2', roleName: 'sales_executive', branchId: null })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies an unauthenticated/missing-user call rather than silently allowing it', async () => {
    const { service, query } = makeService(BRANCH_A);
    await expect(service.assertAccess('quotations', RECORD_ID, undefined)).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled(); // denied before ever touching the DB
  });

  it('always allows super_admin, regardless of branch', async () => {
    const { service, query } = makeService(BRANCH_B);
    await expect(service.assertAccess('invoices', RECORD_ID, { userId: 'admin', roleName: 'super_admin', branchId: BRANCH_A })).resolves.toBeUndefined();
    expect(query).not.toHaveBeenCalled(); // super_admin short-circuits before even touching the DB
  });

  it('404s on a record that does not exist, instead of a 403 that would leak "it exists but isn\'t yours"', async () => {
    const { service } = makeService(null);
    await expect(service.assertAccess('payments', 'nonexistent', { userId: 'u1', roleName: 'sales_executive', branchId: BRANCH_A })).rejects.toBeInstanceOf(NotFoundException);
  });
});
