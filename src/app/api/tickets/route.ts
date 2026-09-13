import type { Domain, RiskLevel, TicketStatus } from '@/lib/types';
import { fail, ok, withErrorHandling } from '@/server/http';
import { listTickets } from '@/server/repositories/tickets';

/** GET /api/tickets?domain=IT&status=OPEN&riskLevel=HIGH&q=vpn */
export const GET = withErrorHandling(async (req: Request) => {
  const p = new URL(req.url).searchParams;
  const tickets = await listTickets({
    domain: (p.get('domain') as Domain) ?? undefined,
    status: (p.get('status') as TicketStatus) ?? undefined,
    riskLevel: (p.get('riskLevel') as RiskLevel) ?? undefined,
    employeeId: p.get('employeeId') ?? undefined,
    q: p.get('q') ?? undefined,
  });
  return ok(tickets, { total: tickets.length });
});

/** POST /api/tickets — 当前收敛版不再支持自动创建工单 */
export const POST = withErrorHandling(async (req: Request) => {
  await req.text();
  return fail('TICKET_CREATE_DISABLED', '当前 Demo 不再自动创建工单，请使用对话记录和 IT / 行政人工接入。', 410);
});
