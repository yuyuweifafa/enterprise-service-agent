import { ok, withErrorHandling } from '@/server/http';
import { listPermissions } from '@/server/repositories/employees';

/** GET /api/permissions?employeeId=E1001&system=VPN — 查询员工权限状态，供员工档案展示使用。 */
export const GET = withErrorHandling(async (req: Request) => {
  const url = new URL(req.url);
  const employeeId = url.searchParams.get('employeeId') ?? undefined;
  const system = url.searchParams.get('system') ?? undefined;
  const rows = await listPermissions(employeeId, system);
  return ok(rows, { total: rows.length });
});
