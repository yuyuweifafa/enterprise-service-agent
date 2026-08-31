import type { Citation, Domain, Employee, RiskLevel, ToolCallRecord } from '@/lib/types';
import { getTool, type ToolDef } from '@/server/config';
import { getEmployee, listPermissions } from '@/server/repositories/employees';
import { createTicket, updateTicket } from '@/server/repositories/tickets';
import { createApproval } from '@/server/repositories/approvals';
import { recordGap } from '@/server/repositories/gaps';
import { searchKnowledge } from '@/server/knowledge';

/**
 * 工具调用层。
 *
 * 关键设计：工具的「描述 / 入参 / 端点」全部来自 config/tool-registry.json，
 * 这里只提供每个工具 id 对应的执行体。所以：
 * - 前端可以完整展示「Agent 调了哪些工具、传了什么参数、耗时多少」；
 * - 接入大模型时，直接把 registry 序列化成 function calling 的 tools 数组；
 * - 换成真实企业接口时，把执行体从「进程内 repository 调用」换成「HTTP 调用」即可。
 */

export interface ToolContext {
  employee: Employee | null;
  intent: {
    id: string | null;
    label: string;
    domain: Domain;
    title: string;
    query: string;
    slots: Record<string, unknown>;
    suggestedAction: string;
    ticketId?: string;
    gapId?: string;
    knowledgeTags: string[];
    topScore: number;
  };
  risk: {
    level: RiskLevel;
    reasons: string[];
  };
  citations: Citation[];
  handoffTeam: string;
  toolCalls: ToolCallRecord[];
  trace: Record<string, unknown>;
}

function getByPath(ctx: ToolContext, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, ctx as unknown);
}

export function resolveArgs(tool: ToolDef, ctx: ToolContext): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const def of tool.args) {
    let value: unknown;
    if (def.from === 'const') value = def.value;
    else if (def.from === 'slot') value = ctx.intent.slots[def.slot ?? def.name];
    else value = getByPath(ctx, def.path ?? def.name);
    if (value !== undefined && value !== null && value !== '') args[def.name] = value;
  }
  return args;
}

type ToolResult = { data: unknown; summary: string };

const handlers: Record<string, (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>> = {
  'hr.get_employee': async (args) => {
    const employee = await getEmployee(String(args.employeeId ?? ''));
    return {
      data: employee,
      summary: employee
        ? `${employee.name} / ${employee.department} / ${employee.level} / ${employee.status}`
        : '未找到该工号',
    };
  },

  'it.get_permissions': async (args) => {
    const rows = await listPermissions(
      String(args.employeeId ?? ''),
      args.system ? String(args.system) : undefined,
    );
    return {
      data: rows,
      summary: rows.length
        ? rows.map((r) => `${r.system}: ${r.status}`).join('；')
        : '无匹配的权限记录',
    };
  },

  'kb.search': async (args, ctx) => {
    // 只用员工的原始问题检索，**不要把意图的 knowledgeTags 拼进 query**。
    //
    // 这里踩过一个坑：早期把 tags 混进查询文本，本意是"帮助检索"，实际是在污染 query——
    // 意图识别正确时 tags 只是重复了问题里已有的信息（收益极小），
    // 意图识别错误时，错误的 tags 会让那篇文档的每个章节都命中 keywords 而被推过相似度阈值，
    // 于是 knowledgeHit 变成 true，未命中兜底（R010 + 知识缺口沉淀）就永远不触发了。
    // 实测案例：「带样机去德国参展的清关手续」被误判为出差意图后，
    // tags ["出差","订票"] 让出差文档全部过阈值，Agent 自信地答了订票流程。
    // tags 还会参与片段选择打分，导致引用到章节里不相关的段落。
    const hits = searchKnowledge(String(args.q ?? ''), {
      domain: args.domain as Domain | undefined,
    });
    return {
      data: hits,
      summary: hits.length
        ? `命中 ${hits.length} 条，最高分 ${hits[0].score}（${hits[0].docId}#${hits[0].section}）`
        : `未命中（最高分 ${ctx.intent.topScore}）`,
    };
  },

  'ticket.create': async (args, ctx) => {
    const ticket = await createTicket({
      employeeId: String(args.employeeId ?? 'UNKNOWN'),
      employeeName: ctx.employee?.name ?? '未知员工',
      domain: (args.domain as Domain) ?? 'UNKNOWN',
      intentId: (args.intentId as string) ?? null,
      title: String(args.title ?? ctx.intent.label),
      description: String(args.description ?? ctx.intent.query),
      riskLevel: (args.riskLevel as RiskLevel) ?? 'MEDIUM',
      assigneeTeam: ctx.handoffTeam,
      source: 'AGENT',
      slots: (args.slots as Record<string, unknown>) ?? {},
      citations: ctx.citations.map((c) => ({ docId: c.docId, title: c.title, section: c.section })),
      linkedGapId: ctx.intent.gapId ?? null,
    });
    ctx.intent.ticketId = ticket.id;
    return { data: ticket, summary: `已创建工单 ${ticket.id}（${ticket.assigneeTeam} / ${ticket.priority}）` };
  },

  'ticket.update_status': async (args) => {
    const ticket = await updateTicket(String(args.ticketId ?? ''), {
      status: args.status as never,
      note: args.note ? String(args.note) : undefined,
      actor: 'AGENT',
    });
    return {
      data: ticket,
      summary: ticket ? `工单 ${ticket.id} → ${ticket.status}` : '未找到工单',
    };
  },

  'approval.create': async (args, ctx) => {
    const approval = await createApproval({
      ticketId: (args.ticketId as string) ?? ctx.intent.ticketId ?? null,
      employeeId: String(args.employeeId ?? 'UNKNOWN'),
      employeeName: ctx.employee?.name ?? '未知员工',
      domain: (args.domain as Domain) ?? 'UNKNOWN',
      intentId: (args.intentId as string) ?? null,
      title: String(args.title ?? ctx.intent.label),
      riskLevel: (args.riskLevel as RiskLevel) ?? 'HIGH',
      riskReasons: (args.riskReasons as string[]) ?? ctx.risk.reasons,
      suggestedAction: String(args.suggestedAction ?? ctx.intent.suggestedAction),
      reviewerTeam: ctx.handoffTeam,
      agentEvidence: {
        employeeSnapshot: ctx.employee
          ? {
              status: ctx.employee.status,
              hireDate: ctx.employee.hireDate,
              department: ctx.employee.department,
              level: ctx.employee.level,
            }
          : {},
        citations: ctx.citations.map((c) => ({
          docId: c.docId,
          title: c.title,
          section: c.section,
          score: c.score,
        })),
        toolCalls: ctx.toolCalls.map((t) => ({
          toolId: t.toolId,
          status: t.status,
          durationMs: t.durationMs,
          summary: t.summary,
        })),
      },
    });
    return { data: approval, summary: `已创建人工确认任务 ${approval.id}（${approval.reviewerTeam}）` };
  },

  'kb.record_gap': async (args, ctx) => {
    const gap = await recordGap({
      question: String(args.question ?? ctx.intent.query),
      domain: (args.domain as Domain) ?? 'UNKNOWN',
      intentId: (args.intentId as string) ?? null,
      employeeId: args.employeeId ? String(args.employeeId) : undefined,
      topScore: ctx.intent.topScore,
    });
    ctx.intent.gapId = gap.id;
    return {
      data: gap,
      summary: `已沉淀知识缺口 ${gap.id}（累计出现 ${gap.occurrences} 次）`,
    };
  },
};

export async function executeTool(
  toolId: string,
  ctx: ToolContext,
  argOverrides: Record<string, unknown> = {},
): Promise<{ record: ToolCallRecord; data: unknown }> {
  const tool = getTool(toolId);
  const started = Date.now();

  if (!tool) {
    const record: ToolCallRecord = {
      toolId,
      toolName: toolId,
      endpoint: '-',
      args: argOverrides,
      status: 'ERROR',
      durationMs: 0,
      error: `tool-registry.json 中不存在工具 ${toolId}`,
    };
    ctx.toolCalls.push(record);
    return { record, data: null };
  }

  const args = { ...resolveArgs(tool, ctx), ...argOverrides };
  const missing = tool.args.filter((a) => a.required && args[a.name] === undefined).map((a) => a.name);
  if (missing.length > 0) {
    const record: ToolCallRecord = {
      toolId,
      toolName: tool.name,
      endpoint: `${tool.method} ${tool.endpoint}`,
      args,
      status: 'SKIPPED',
      durationMs: Date.now() - started,
      error: `缺少必填入参: ${missing.join(', ')}`,
    };
    ctx.toolCalls.push(record);
    return { record, data: null };
  }

  const handler = handlers[toolId];
  if (!handler) {
    const record: ToolCallRecord = {
      toolId,
      toolName: tool.name,
      endpoint: `${tool.method} ${tool.endpoint}`,
      args,
      status: 'SKIPPED',
      durationMs: Date.now() - started,
      error: '该工具尚未实现执行体',
    };
    ctx.toolCalls.push(record);
    return { record, data: null };
  }

  try {
    const { data, summary } = await handler(args, ctx);
    const record: ToolCallRecord = {
      toolId,
      toolName: tool.name,
      endpoint: `${tool.method} ${tool.endpoint}`,
      args,
      status: 'OK',
      durationMs: Date.now() - started,
      summary,
    };
    ctx.toolCalls.push(record);
    return { record, data };
  } catch (err) {
    const record: ToolCallRecord = {
      toolId,
      toolName: tool.name,
      endpoint: `${tool.method} ${tool.endpoint}`,
      args,
      status: 'ERROR',
      durationMs: Date.now() - started,
      error: (err as Error).message,
    };
    ctx.toolCalls.push(record);
    return { record, data: null };
  }
}
