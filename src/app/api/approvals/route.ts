import { z } from 'zod';
import type { ApprovalStatus, Domain } from '@/lib/types';
import { ok, parseBody, withErrorHandling } from '@/server/http';
import { createApproval, listApprovals } from '@/server/repositories/approvals';
import { getEmployee } from '@/server/repositories/employees';

/** GET /api/approvals?status=PENDING&domain=IT */
export const GET = withErrorHandling(async (req: Request) => {
  const p = new URL(req.url).searchParams;
  const approvals = await listApprovals({
    status: (p.get('status') as ApprovalStatus) ?? undefined,
    domain: (p.get('domain') as Domain) ?? undefined,
    q: p.get('q') ?? undefined,
  });
  return ok(approvals, {
    total: approvals.length,
    pending: approvals.filter((a) => a.status === 'PENDING').length,
  });
});

const createSchema = z.object({
  ticketId: z.string().nullable().optional(),
  employeeId: z.string().min(1),
  domain: z.enum(['IT', 'HR', 'FINANCE', 'ADMIN', 'UNKNOWN']),
  intentId: z.string().nullable().optional(),
  title: z.string().min(1).max(200),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('HIGH'),
  riskReasons: z.array(z.string()).default([]),
  suggestedAction: z.string().min(1).max(4000),
  reviewerTeam: z.string().optional(),
});

/** POST /api/approvals — 创建审批 / 人工确认任务（对应工具 approval.create） */
export const POST = withErrorHandling(async (req: Request) => {
  const parsed = await parseBody(req, createSchema);
  if (!parsed.ok) return parsed.response;
  const employee = await getEmployee(parsed.data.employeeId);
  const approval = await createApproval({
    ...parsed.data,
    intentId: parsed.data.intentId ?? null,
    employeeName: employee?.name ?? '未知员工',
  });
  return ok(approval, undefined, 201);
});
