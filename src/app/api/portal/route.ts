import type { Ticket } from '@/lib/types';
import { fail, ok, withErrorHandling } from '@/server/http';
import { getEmployee, listPermissions } from '@/server/repositories/employees';
import { listTickets } from '@/server/repositories/tickets';

/**
 * GET /api/portal?employeeId=E1001
 *
 * 员工端门户的概览数据。**只返回该员工自己的数据**，这是员工端与后台的权限边界：
 * 后台的 /api/tickets 可以查全量队列，这个接口按 employeeId 收敛。
 *
 * 真实环境里 employeeId 不该由前端传，而是从会话（SSO）里取，
 * 否则改一下 query 就能看别人的工单。当前 Demo 未接鉴权，这里显式留个记号。
 */

/** 员工视角下「还没完结」的工单状态 */
const ACTIVE_STATUSES: Ticket['status'][] = ['OPEN', 'IN_PROGRESS', 'PENDING_REVIEW'];

export const GET = withErrorHandling(async (req: Request) => {
  const employeeId = new URL(req.url).searchParams.get('employeeId');
  if (!employeeId) return fail('INVALID_REQUEST', '缺少查询参数 employeeId', 400);

  const employee = await getEmployee(employeeId);
  if (!employee) return fail('EMPLOYEE_NOT_FOUND', `未找到工号 ${employeeId}`, 404);

  const [tickets, permissions] = await Promise.all([
    listTickets({ employeeId }),
    listPermissions(employeeId),
  ]);

  const active = tickets.filter((t) => ACTIVE_STATUSES.includes(t.status));
  const awaitingReview = tickets.filter((t) => t.status === 'PENDING_REVIEW');
  const granted = permissions.filter((p) => p.status === 'GRANTED');
  const expiring = permissions.filter((p) => {
    if (p.status !== 'GRANTED' || !p.expiresAt) return false;
    const days = (new Date(p.expiresAt).getTime() - Date.now()) / 86_400_000;
    return days >= 0 && days <= 30;
  });
  const remainingLeave = Number((employee.annualLeaveTotal - employee.annualLeaveUsed).toFixed(1));

  return ok({
    employeeId,
    /** 三张概览卡片，数字全部来自该员工的真实数据 */
    cards: [
      {
        key: 'tickets',
        title: '进行中的工单',
        value: active.length,
        hint:
          active.length > 0
            ? active.slice(0, 3).map((t) => t.title).join('、')
            : '当前没有在处理的工单',
      },
      {
        key: 'pending',
        title: '等待人工确认',
        value: awaitingReview.length,
        hint:
          awaitingReview.length > 0
            ? `${awaitingReview.map((t) => t.assigneeTeam).join('、')} 正在复核`
            : '没有待确认事项',
      },
      {
        key: 'systems',
        title: '已开通系统',
        value: granted.length,
        hint:
          granted.length > 0
            ? `${granted.slice(0, 4).map((p) => p.system).join('、')}${granted.length > 4 ? ' 等' : ''}`
            : '暂无已开通的系统权限',
      },
    ],
    /** 首页可以直接展示的个人事实，避免员工还要开口问 */
    facts: {
      remainingLeave,
      compTimeDays: employee.compTimeDays,
      expiringPermissions: expiring.map((p) => ({ system: p.system, expiresAt: p.expiresAt })),
    },
    /** 最近动态：该员工的工单时间线，倒序 */
    recent: tickets.slice(0, 5).map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      domain: t.domain,
      riskLevel: t.riskLevel,
      assigneeTeam: t.assigneeTeam,
      createdAt: t.createdAt,
      lastNote: t.timeline[t.timeline.length - 1]?.note ?? '',
    })),
  });
});
