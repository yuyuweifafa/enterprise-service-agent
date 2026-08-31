import { ok, withErrorHandling } from '@/server/http';
import { listPermissions } from '@/server/repositories/employees';

/** GET /api/permissions?employeeId=E1001&system=VPN — 查询权限状态（对应工具 it.get_permissions） */
export const GET = withErrorHandling(async (req: Request) => {
  const url = new URL(req.url);
  const employeeId = url.searchParams.get('employeeId') ?? undefined;
  const system = url.searchParams.get('system') ?? undefined;
  const rows = await listPermissions(employeeId, system);
  return ok(rows, { total: rows.length });
});
