import type { Domain, RiskLevel, Ticket, TicketStatus } from '@/lib/types';
import { getConfig, domainOwner } from '../config';
import { mutate, nextSequentialId, readCollection } from '../store';

export interface CreateTicketInput {
  employeeId: string;
  employeeName: string;
  domain: Domain;
  intentId: string | null;
  title: string;
  description: string;
  riskLevel: RiskLevel;
  assigneeTeam?: string;
  source?: 'AGENT' | 'HUMAN';
  slots?: Record<string, unknown>;
  citations?: Array<{ docId: string; title: string; section: string }>;
  linkedGapId?: string | null;
  createdBy?: string;
}

const PRIORITY_BY_RISK: Record<RiskLevel, Ticket['priority']> = {
  HIGH: 'P1',
  MEDIUM: 'P2',
  LOW: 'P3',
};

export async function listTickets(filter: {
  domain?: Domain;
  status?: TicketStatus;
  riskLevel?: RiskLevel;
  employeeId?: string;
  q?: string;
} = {}): Promise<Ticket[]> {
  const all = await readCollection<Ticket>('tickets');
  const q = filter.q?.trim().toLowerCase();
  return all
    .filter((t) => {
      if (filter.domain && t.domain !== filter.domain) return false;
      if (filter.status && t.status !== filter.status) return false;
      if (filter.riskLevel && t.riskLevel !== filter.riskLevel) return false;
      if (filter.employeeId && t.employeeId !== filter.employeeId) return false;
      if (q) {
        const haystack = `${t.id} ${t.title} ${t.description} ${t.employeeName} ${t.assigneeTeam}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getTicket(id: string): Promise<Ticket | null> {
  const all = await readCollection<Ticket>('tickets');
  return all.find((t) => t.id === id) ?? null;
}

export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const { sla } = getConfig().app;
  const now = new Date();
  const resolveHours = sla[input.riskLevel]?.resolveHours ?? 24;
  const assigneeTeam = input.assigneeTeam ?? domainOwner(input.domain);

  return mutate<Ticket, Ticket>('tickets', (items) => {
    const id = nextSequentialId('TK', items.map((t) => t.id));
    const ticket: Ticket = {
      id,
      employeeId: input.employeeId,
      employeeName: input.employeeName,
      domain: input.domain,
      intentId: input.intentId,
      title: input.title,
      description: input.description,
      riskLevel: input.riskLevel,
      priority: PRIORITY_BY_RISK[input.riskLevel],
      status: input.riskLevel === 'HIGH' ? 'PENDING_REVIEW' : 'OPEN',
      assigneeTeam,
      assignee: null,
      source: input.source ?? 'AGENT',
      slots: input.slots ?? {},
      citations: input.citations ?? [],
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      slaDueAt: new Date(now.getTime() + resolveHours * 3600_000).toISOString(),
      resolvedAt: null,
      linkedApprovalId: null,
      linkedGapId: input.linkedGapId ?? null,
      timeline: [
        {
          at: now.toISOString(),
          actor: input.createdBy ?? (input.source === 'HUMAN' ? '人工' : 'AGENT'),
          action: 'CREATED',
          note:
            input.riskLevel === 'HIGH'
              ? `高风险事项，已置为待人工确认，路由给 ${assigneeTeam}，Agent 未执行任何变更动作`
              : `识别意图 ${input.intentId ?? '未识别'}，风险 ${input.riskLevel}，已路由给 ${assigneeTeam} 自动建单`,
        },
      ],
    };
    return { items: [...items, ticket], result: ticket };
  });
}

export interface UpdateTicketInput {
  status?: TicketStatus;
  assignee?: string | null;
  assigneeTeam?: string;
  note?: string;
  actor?: string;
  linkedApprovalId?: string | null;
}

export async function updateTicket(id: string, input: UpdateTicketInput): Promise<Ticket | null> {
  const now = new Date().toISOString();
  return mutate<Ticket, Ticket | null>('tickets', (items) => {
    const idx = items.findIndex((t) => t.id === id);
    if (idx === -1) return { items, result: null };
    const prev = items[idx];
    const next: Ticket = {
      ...prev,
      status: input.status ?? prev.status,
      assignee: input.assignee !== undefined ? input.assignee : prev.assignee,
      assigneeTeam: input.assigneeTeam ?? prev.assigneeTeam,
      linkedApprovalId:
        input.linkedApprovalId !== undefined ? input.linkedApprovalId : prev.linkedApprovalId,
      updatedAt: now,
      resolvedAt:
        input.status === 'RESOLVED' || input.status === 'CLOSED' ? now : prev.resolvedAt,
      timeline: [
        ...prev.timeline,
        {
          at: now,
          actor: input.actor ?? '人工',
          action: input.status ?? 'NOTE',
          note: input.note ?? '',
        },
      ],
    };
    const copy = [...items];
    copy[idx] = next;
    return { items: copy, result: next };
  });
}

export async function ticketStatusCounts(): Promise<Record<TicketStatus, number>> {
  const all = await readCollection<Ticket>('tickets');
  const base: Record<TicketStatus, number> = {
    OPEN: 0,
    IN_PROGRESS: 0,
    PENDING_REVIEW: 0,
    RESOLVED: 0,
    CLOSED: 0,
    REJECTED: 0,
  };
  for (const t of all) base[t.status] += 1;
  return base;
}
