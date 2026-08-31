import type { Citation, Employee, RiskAssessment } from '@/lib/types';
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
    case 'it.vpn_access':
    case 'it.data_permission':
      facts.push(
        `你的档案：${employee.department} / ${employee.title} / ${employee.level}，在职状态 ${employee.status === 'PROBATION' ? '试用期' : '正式'}。`,
      );
      break;
    default:
      break;
  }
  return facts;
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
}

export function buildAnswer(input: BuildAnswerInput): string {
  const { citations, employee, intentId, missingSlots, risk } = input;

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
      '我已把这个问题记为待补充知识，并转交人工跟进。',
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
  parts.push('Agent 未执行任何变更动作，等待人工确认 / 驳回 / 接管。');
  return parts.join('\n');
}
