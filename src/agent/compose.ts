import type { Citation, Employee, RiskAssessment, ToolCallRecord } from '@/lib/types';
import type { SkillDef } from '@/server/config';

/**
 * 回复合成层。
 *
 * mock 引擎不生成自由文本，而是「知识片段 + 员工档案事实 + Skill 回复骨架」拼装，
 * 保证 Demo 阶段回复稳定、可追溯、不会胡说。
 * 接入大模型后，把 buildAnswer 换成 LLM 调用，把 citations 与员工事实作为上下文传入即可。
 */

export function renderTemplate(template: string, vars: Record<string, string | undefined>): string {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function citationLine(c: Citation): string {
  return `《${c.title}》「${c.section}」：${c.snippet}`;
}

/** 针对特定意图补充「基于员工档案的事实」，让回复看起来是真的查过系统 */
function employeeFacts(intentId: string | null, employee: Employee | null): string[] {
  if (!employee) return [];
  const facts: string[] = [];
  switch (intentId) {
    case 'hr.leave_policy':
    case 'hr.leave_apply': {
      const remaining = Number((employee.annualLeaveTotal - employee.annualLeaveUsed).toFixed(1));
      facts.push(
        `你的档案：入职 ${employee.hireDate}，本年度年假额度 ${employee.annualLeaveTotal} 天，已用 ${employee.annualLeaveUsed} 天，剩余 ${remaining} 天；可用调休 ${employee.compTimeDays} 天。`,
      );
      break;
    }
    case 'fin.reimburse_policy':
    case 'fin.reimburse_submit':
      facts.push(`你的办公地为 ${employee.location}，成本中心 ${employee.costCenter}，审批人为 ${employee.managerName ?? '未配置'}。`);
      break;
    case 'it.account_login':
    case 'it.vpn_access':
    case 'it.device_issue':
    case 'admin.meeting_room':
    case 'admin.access_card':
    case 'admin.supplies_seat':
    case 'agent.goal_customer_review':
      facts.push(
        `你的档案：${employee.department} / ${employee.title} / ${employee.level}，在职状态 ${employee.status === 'PROBATION' ? '试用期' : '正式'}。`,
      );
      break;
    default:
      break;
  }
  return facts;
}

function toolSummary(input: BuildAnswerInput, toolId: string): string | null {
  return input.toolCalls.find((t) => t.toolId === toolId && t.status === 'OK')?.summary ?? null;
}

function toolEvidence(input: BuildAnswerInput, toolIds: string[]): string[] {
  return toolIds
    .map((id) => {
      const call = input.toolCalls.find((t) => t.toolId === id && t.status === 'OK' && t.summary);
      return call ? `${call.toolName}：${call.summary}` : null;
    })
    .filter(Boolean) as string[];
}

function buildFlowEntryAnswer(input: BuildAnswerInput): string {
  const balance = toolSummary(input, 'leave.get_balance');
  const references = input.citations
    .slice(0, 2)
    .map((c) => `《${c.title}》「${c.section}」`)
    .join('、');

  if (input.skill.id === 'hr.flow_entry') {
    return [
      '这类请假/调休事项需要回到公司已有流程里提交，我先帮你把前置信息整理好：',
      balance ? `- 假期余额：${balance}` : '',
      references ? `- 参考依据：${references}` : '',
      '',
      '下一步：点击「去请假流程」，在 OA 里选择假期类型、开始日期和天数即可。',
    ]
      .filter(Boolean)
      .join('\n');
  }

  return [
    '这类报销事项需要回到公司已有财务流程里提交，我先帮你把规则口径整理好：',
    references ? `- 参考依据：${references}` : '',
    '',
    '下一步：点击「去报销流程」，按费用类别补充发票、金额和事由即可。',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildCompanionAnswer(input: BuildAnswerInput): string {
  const text = input.intentLabel.includes('优先级') || input.intentLabel.includes('安排')
    ? '我在。先别把今天当成一整块压力看，我们可以把它拆成“必须推进、最好完成、可以延后”三层。你把今天手上的事项直接丢给我，我帮你排一个更顺的顺序。'
    : '我在。你可以先把紧张或烦的点说出来，我会先帮你接住情绪，再一起把下一步拆小。工作上的事不一定要一口气解决，先找一个能往前动的动作就好。';

  return text;
}

function goalPlan(intentId: string | null): string[] {
  if (intentId === 'agent.goal_customer_review') {
    return [
      '识别明天可用空闲时间，并锁定候选会议室',
      '检索客户历史会议纪要和项目资料，提取本次评审关注点',
      '检查评审方案、数据看板和风险预案是否准备完整',
      '把“联系客户确认评审时间”推送到你的日程提醒',
      '补充天气、着装和会前心态提醒',
    ];
  }
  return [
    '理解员工目标并补齐关键上下文',
    '拆解可自动推进和需要员工确认的节点',
    '必要时把 IT / 行政问题带上下文转人工',
  ];
}

function buildGoalAnswer(input: BuildAnswerInput): string {
  const references = input.citations
    .slice(0, 2)
    .map((c) => `《${c.title}》「${c.section}」`)
    .join('、');
  const facts = employeeFacts(input.intentId, input.employee);
  const tasks = goalPlan(input.intentId);
  const evidence = toolEvidence(input, [
    'calendar.find_slots',
    'meeting.find_rooms',
    'docs.search_customer_history',
    'weather.get_forecast',
    'meeting.book_room',
    'reminder.create',
  ]);

  return [
    `我理解你的目标是：${input.intentLabel}。我会把它拆成会议安排、资料检查、客户确认和会前提醒四块来处理。`,
    '',
    '我先做了这些检查：',
    ...facts.map((f) => `- 已读取上下文：${f}`),
    ...evidence.map((item) => `- ${item}`),
    references ? `- 已检索依据：${references}` : '',
    '',
    '准备结果：',
    '1. 会议安排：已检查明天可用时间，并匹配支持投屏的会议室。',
    '2. 资料准备：已读取历史资料和客户关注点，重点检查方案、数据看板和风险预案。',
    '3. 客户确认：请确认客户最终评审时间，确认后可按当前会议安排推进。',
    '4. 会前提醒：检查天气、着装和到场时间，提前进入状态。',
    '5. 下一步：优先补齐数据看板最新截图，并联系客户确认时间。',
    '',
    '需要你确认的点：客户最终时间是否锁定、资料看板是否已补最新截图。确认后我再按这个版本继续整理。',
  ].join('\n');
}

export interface BuildAnswerInput {
  intentId: string | null;
  intentLabel: string;
  citations: Citation[];
  employee: Employee | null;
  skill: SkillDef;
  slots: Record<string, unknown>;
  missingSlots: Array<{ name: string; label: string }>;
  risk: RiskAssessment;
  toolCalls: ToolCallRecord[];
}

export function buildAnswer(input: BuildAnswerInput): string {
  const { citations, employee, intentId, missingSlots, risk } = input;

  if (input.skill.id === 'companion.work') {
    return buildCompanionAnswer(input);
  }

  if (input.skill.id === 'agent.customer_review') {
    return buildGoalAnswer(input);
  }

  if (input.skill.id === 'hr.flow_entry' || input.skill.id === 'finance.flow_entry') {
    return buildFlowEntryAnswer(input);
  }

  if (risk.forcedAction === 'clarify' && missingSlots.length > 0) {
    const asked = missingSlots.map((s) => s.label).join('、');
    const known = Object.entries(input.slots)
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('，');
    return [
      `我已经把你的诉求识别为「${input.intentLabel}」${known ? `（已获取：${known}）` : ''}，但还缺少办理必需的信息：**${asked}**。`,
      '补齐后我会立刻为你提交。',
      citations.length > 0 ? `\n参考依据：${citationLine(citations[0])}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  if (citations.length === 0) {
    return [
      `关于「${input.intentLabel}」，我在知识库里没有检索到可引用的制度依据，不给你一个可能出错的答案。`,
      '我已把这个问题记为待补充知识。若这是 IT 或行政问题，你可以点「没用，转人工」，对应同事会看到这段对话和小助的判断。',
    ].join('\n');
  }

  const lines: string[] = [];
  lines.push(`关于「${input.intentLabel}」，制度依据如下：`);
  citations.slice(0, 2).forEach((c, i) => {
    lines.push(`${i + 1}. ${citationLine(c)}`);
  });

  const facts = employeeFacts(intentId, employee);
  if (facts.length > 0) lines.push('', ...facts);

  return lines.join('\n');
}

export function buildSuggestedAction(input: BuildAnswerInput): string {
  const { citations, risk, skill, intentLabel, slots } = input;
  if (skill.id === 'agent.customer_review') {
    return [
      `目标：${intentLabel}`,
      `风险判定：${risk.level}（${risk.reasons.map((r) => r.ruleId).join('、') || '按目标编排基线'}）`,
      `执行方式：Agent 直接拆解并调用日程、会议室、资料、天气和提醒等 mock 能力`,
      `子任务建议：${goalPlan(input.intentId).join('；')}`,
    ].join('\n');
  }
  const parts: string[] = [];
  parts.push(`诉求：${intentLabel}`);
  if (Object.keys(slots).length > 0) {
    parts.push(`关键信息：${Object.entries(slots).map(([k, v]) => `${k}=${String(v)}`).join('，')}`);
  }
  parts.push(`风险判定：${risk.level}（${risk.reasons.map((r) => r.ruleId).join('、') || '按 Skill 基线'}）`);
  parts.push(`处理团队：${skill.handoffTeam}`);
  if (citations.length > 0) {
    parts.push(
      `建议按以下依据处理：${citations
        .slice(0, 2)
        .map((c) => `${c.docId}#${c.section}`)
        .join('、')}`,
    );
  } else {
    parts.push('知识库无依据，需人工判断并补充制度。');
  }
  parts.push('Agent 未执行真实系统变更；HR/财务回到流程入口，IT/行政可在需要时转人工。');
  return parts.join('\n');
}
