import type { Domain, RiskLevel, Ticket, TicketStatus } from '@/lib/types';
import { mutate, readCollection } from '../store';

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

export interface UpdateTicketInput {
  status?: TicketStatus;
  assignee?: string | null;
  assigneeTeam?: string;
  note?: string;
  actor?: string;
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
