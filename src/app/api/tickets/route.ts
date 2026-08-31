import { z } from 'zod';
import type { Domain, RiskLevel, TicketStatus } from '@/lib/types';
import { ok, parseBody, withErrorHandling } from '@/server/http';
import { createTicket, listTickets } from '@/server/repositories/tickets';
import { getEmployee } from '@/server/repositories/employees';

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

const createSchema = z.object({
  employeeId: z.string().min(1),
  domain: z.enum(['IT', 'HR', 'FINANCE', 'ADMIN', 'UNKNOWN']),
  intentId: z.string().nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(4000),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  assigneeTeam: z.string().optional(),
  source: z.enum(['AGENT', 'HUMAN']).default('HUMAN'),
  slots: z.record(z.string(), z.unknown()).optional(),
  citations: z
    .array(z.object({ docId: z.string(), title: z.string(), section: z.string() }))
    .optional(),
});

/** POST /api/tickets — 创建工单（对应工具 ticket.create） */
export const POST = withErrorHandling(async (req: Request) => {
  const parsed = await parseBody(req, createSchema);
  if (!parsed.ok) return parsed.response;
  const employee = await getEmployee(parsed.data.employeeId);
  const ticket = await createTicket({
    ...parsed.data,
    intentId: parsed.data.intentId ?? null,
    employeeName: employee?.name ?? '未知员工',
  });
  return ok(ticket, undefined, 201);
});
