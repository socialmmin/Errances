import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { Permission, roleHasPermission } from '../rbac/role-permissions';
import { ACCESS_KEY, AccessService } from '../access/access.service';
import { grantedPermissions } from '../access/access-catalog';

// Two checks, both server-side:
//  1. Access switches (@RequireAccess): if a route belongs to a page/section that's switched OFF
//     for this employee, it's refused -- even though their role would allow it. This is what makes
//     the access panel real security rather than just a hidden sidebar link.
//  2. Permissions (@RequirePermissions): the role's permissions, PLUS anything a page switched ON
//     for this employee grants. Without (2b), turning on a page their role lacks would show the
//     page but every request on it would fail.
// super_admin passes everything.
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector, private access: AccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]) ?? [];
    const requiredAccess = this.reflector.getAllAndOverride<string[]>(ACCESS_KEY, [context.getHandler(), context.getClass()]) ?? [];
    if (!required.length && !requiredAccess.length) return true;

    const user = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Not authenticated');
    if (user.roleName === 'super_admin') return true;

    const access = await this.access.effectiveFor(user.userId, user.roleName);
    if (requiredAccess.length && !requiredAccess.some((k) => access[k])) {
      throw new ForbiddenException("You don't have access to this section");
    }
    if (required.length) {
      const granted = grantedPermissions(access);
      const ok = required.every((p) => roleHasPermission(user.roleName, p) || granted.has(p));
      if (!ok) throw new ForbiddenException(`Missing required permission(s): ${required.join(', ')}`);
    }
    return true;
  }
}
