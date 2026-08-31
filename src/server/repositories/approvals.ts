import type { Approval, ApprovalEvidence, ApprovalStatus, Domain, RiskLevel } from '@/lib/types';
import { domainOwner } from '../config';
import { mutate, nextSequentialId, readCollection } from '../store';
import { updateTicket } from './tickets';

export interface CreateApprovalInput {
  ticketId?: string | null;
  employeeId: string;
  employeeName: string;
  domain: Domain;
  intentId: string | null;
  title: string;
  riskLevel: RiskLevel;
  riskReasons: string[];
  suggestedAction: string;
  reviewerTeam?: string;
  agentEvidence?: Partial<ApprovalEvidence>;
}

export async function listApprovals(filter: {
  status?: ApprovalStatus;
  domain?: Domain;
  q?: string;
} = {}): Promise<Approval[]> {
  const all = await readCollection<Approval>('approvals');
  const q = filter.q?.trim().toLowerCase();
  return all
    .filter((a) => {
      if (filter.status && a.status !== filter.status) return false;
      if (filter.domain && a.domain !== filter.domain) return false;
      if (q && !`${a.id} ${a.title} ${a.employeeName}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => {
      // 待处理优先，其次按创建时间倒序
      if (a.status === 'PENDING' && b.status !== 'PENDING') return -1;
      if (b.status === 'PENDING' && a.status !== 'PENDING') return 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
}

export async function getApproval(id: string): Promise<Approval | null> {
  const all = await readCollection<Approval>('approvals');
  return all.find((a) => a.id === id) ?? null;
}

export async function createApproval(input: CreateApprovalInput): Promise<Approval> {
  const now = new Date().toISOString();
  const approval = await mutate<Approval, Approval>('approvals', (items) => {
    const id = nextSequentialId('AP', items.map((a) => a.id));
    const record: Approval = {
      id,
      ticketId: input.ticketId ?? null,
      employeeId: input.employeeId,
      employeeName: input.employeeName,
      domain: input.domain,
      intentId: input.intentId,
      title: input.title,
      riskLevel: input.riskLevel,
      riskReasons: input.riskReasons,
      suggestedAction: input.suggestedAction,
      reviewerTeam: input.reviewerTeam ?? domainOwner(input.domain),
      reviewer: null,
      status: 'PENDING',
      createdAt: now,
      decidedAt: null,
      decisionNote: null,
      agentEvidence: {
        employeeSnapshot: input.agentEvidence?.employeeSnapshot ?? {},
        citations: input.agentEvidence?.citations ?? [],
        toolCalls: input.agentEvidence?.toolCalls ?? [],
      },
    };
    return { items: [...items, record], result: record };
  });

  if (approval.ticketId) {
    await updateTicket(approval.ticketId, {
      linkedApprovalId: approval.id,
      status: 'PENDING_REVIEW',
      actor: 'AGENT',
      note: `已生成人工确认任务 ${approval.id}`,
    });
  }

  return approval;
}

export interface DecideApprovalInput {
  status: Exclude<ApprovalStatus, 'PENDING'>;
  reviewer: string;
  decisionNote?: string;
}

export async function decideApproval(
  id: string,
  input: DecideApprovalInput,
): Promise<Approval | null> {
  const now = new Date().toISOString();
  const updated = await mutate<Approval, Approval | null>('approvals', (items) => {
    const idx = items.findIndex((a) => a.id === id);
    if (idx === -1) return { items, result: null };
    const next: Approval = {
      ...items[idx],
      status: input.status,
      reviewer: input.reviewer,
      decidedAt: now,
      decisionNote: input.decisionNote ?? null,
    };
    const copy = [...items];
    copy[idx] = next;
    return { items: copy, result: next };
  });

  if (updated?.ticketId) {
    const statusMap = {
      APPROVED: 'IN_PROGRESS',
      REJECTED: 'REJECTED',
      TAKEN_OVER: 'IN_PROGRESS',
    } as const;
    const actionLabel = {
      APPROVED: '人工确认通过，进入执行',
      REJECTED: '人工驳回',
      TAKEN_OVER: '人工接管处理',
    } as const;
    await updateTicket(updated.ticketId, {
      status: statusMap[input.status],
      assignee: input.reviewer,
      actor: input.reviewer,
      note: `${actionLabel[input.status]}${input.decisionNote ? `：${input.decisionNote}` : ''}`,
    });
  }

  return updated;
}

export async function pendingApprovalCount(): Promise<number> {
  const all = await readCollection<Approval>('approvals');
  return all.filter((a) => a.status === 'PENDING').length;
}
