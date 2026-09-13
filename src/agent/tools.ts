import type { Citation, Domain, Employee, RiskLevel, ToolCallRecord } from '@/lib/types';
import { getTool, type ToolDef } from '@/server/config';
import { getEmployee } from '@/server/repositories/employees';
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

  'calendar.find_slots': async (args, ctx) => {
    const date = String(args.date ?? '明天');
    const location = ctx.employee?.location ?? '当前办公地';
    return {
      data: [
        { date, start: '10:00', end: '11:00', status: 'FREE' },
        { date, start: '15:00', end: '16:00', status: 'FREE' },
      ],
      summary: `${date} ${location} 可用空闲时间：10:00-11:00、15:00-16:00`,
    };
  },

  'meeting.find_rooms': async (args, ctx) => {
    const location = String(args.location ?? ctx.employee?.location ?? '上海');
    const date = String(args.date ?? '明天');
    const headcount = Number(args.headcount ?? 6);
    return {
      data: [
        { room: `${location} · 湖畔会议室`, capacity: 6, slot: '15:00-16:00', equipment: ['投屏', '视频会议'] },
        { room: `${location} · 星云会议室`, capacity: 8, slot: '10:00-11:00', equipment: ['投影', '白板'] },
      ],
      summary: `${date} 已找到适合 ${headcount} 人的会议室：${location} · 湖畔会议室 15:00-16:00，可投屏和视频会议；备选 ${location} · 星云会议室 10:00-11:00`,
    };
  },

  'docs.search_customer_history': async () => {
    return {
      data: {
        customer: '示例客户',
        lastMeetingConcerns: ['排课成功率', '教师资源利用率', '上线风险', '数据看板口径'],
        materialChecklist: [
          { name: '评审方案文档', status: 'READY' },
          { name: '排课成功率数据看板', status: 'NEEDS_UPDATE' },
          { name: '上线风险与兜底预案', status: 'READY' },
        ],
      },
      summary: '已阅读历史会议纪要和项目文档：客户上次重点关注排课成功率、教师资源利用率、上线风险；本次材料中评审方案和风险预案已准备，数据看板需补最新截图',
    };
  },

  'weather.get_forecast': async (args) => {
    const location = String(args.location ?? '当前城市');
    const date = String(args.date ?? '明天');
    return {
      data: { location, date, condition: '多云', low: 24, high: 29, commute: '通勤舒适' },
      summary: `${date} ${location} 多云，24-29°C，通勤舒适；建议商务休闲、浅色上装，提前 10 分钟到会议室调整状态`,
    };
  },

  'leave.get_balance': async (_args, ctx) => {
    const annualRemaining = ctx.employee
      ? Number((ctx.employee.annualLeaveTotal - ctx.employee.annualLeaveUsed).toFixed(1))
      : 0;
    const compTimeDays = ctx.employee?.compTimeDays ?? 0;
    return {
      data: { annualRemaining, compTimeDays },
      summary: `年假剩余 ${annualRemaining} 天，可用调休 ${compTimeDays} 天`,
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

  'meeting.book_room': async (args, ctx) => {
    const date = String(args.date ?? '明天');
    const employeeName = ctx.employee?.name ?? '员工';
    return {
      data: {
        bookingId: 'MR-20260904-001',
        room: `${ctx.employee?.location ?? '上海'} · 湖畔会议室`,
        date,
        slot: '15:00-16:00',
        status: 'HELD',
      },
      summary: `已为 ${employeeName} 锁定 ${date} 15:00-16:00 的${ctx.employee?.location ?? '上海'} · 湖畔会议室，客户时间确认后可自动调整或释放`,
    };
  },

  'reminder.create': async (args) => {
    const title = String(args.title ?? '工作提醒');
    const date = String(args.date ?? '明天');
    return {
      data: { reminderId: 'REM-20260904-001', title, date, due: '18:00' },
      summary: `已推送日程提醒：今天 18:00 前联系客户确认 ${date} 评审时间，并在会前检查资料`,
    };
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
