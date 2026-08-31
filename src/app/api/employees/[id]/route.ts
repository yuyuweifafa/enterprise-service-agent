import { fail, ok, withErrorHandling } from '@/server/http';
import { getEmployee, listPermissions } from '@/server/repositories/employees';

/** GET /api/employees/:id — 查询员工信息（对应工具 hr.get_employee） */
export const GET = withErrorHandling(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const employee = await getEmployee(id);
    if (!employee) return fail('EMPLOYEE_NOT_FOUND', `未找到工号 ${id}`, 404);
    const permissions = await listPermissions(id);
    return ok({ ...employee, permissions });
  },
);
