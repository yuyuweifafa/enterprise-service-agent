import { ok, withErrorHandling } from '@/server/http';
import { listEmployees } from '@/server/repositories/employees';

/** GET /api/employees — 查询员工列表（Demo 用于身份切换下拉框） */
export const GET = withErrorHandling(async () => {
  const employees = await listEmployees();
  return ok(employees, { total: employees.length });
});
