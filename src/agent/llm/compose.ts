import type { AgentActionType, Citation, Employee, RiskAssessment, ToolCallRecord } from '@/lib/types';
import { getConfig, type LlmRuntimeConfig, type SkillDef } from '@/server/config';
import { chatCompletion, type LlmUsage } from './client';

/**
 * 大模型版回复合成。**config/system-prompt.md 在这里真正生效。**
 *
 * 关键设计：模型只负责「把已经定好的结论说清楚」，不负责做决策。
 * 风险等级、是否需要人工、是否记录知识缺口，都是规则引擎在上游算完的，
 * 通过 briefing 以事实形式喂给模型。模型不能改这些结论，只能组织语言。
 *
 * 这样做的原因：企业内部服务台答错的代价是真实的。
 * 让模型自由决定"要不要给你开生产库权限"没法审计，也没法回归测试。
 */

export interface LlmComposeInput {
  question: string;
  intentLabel: string;
  intentId: string | null;
  employee: Employee | null;
  skill: SkillDef;
  citations: Citation[];
  slots: Record<string, unknown>;
  missingSlots: Array<{ name: string; label: string }>;
  risk: RiskAssessment;
  actions: AgentActionType[];
  artifacts: { ticketId?: string; flowEntry?: string; gapId?: string };
  toolCalls: ToolCallRecord[];
}

export interface LlmComposeResult {
  reply: string;
  usage: LlmUsage;
  durationMs: number;
}

/** 把上游算好的确定性结论整理成事实清单 */
function buildBriefing(input: LlmComposeInput): string {
  const cfg = getConfig();
  const lines: string[] = [];

  lines.push(`员工原话：${input.question}`);
  lines.push(`本次要回应的诉求：${input.intentLabel}（${input.intentId ?? 'UNKNOWN'}）`);

  if (input.employee) {
    const e = input.employee;
    const remaining = Number((e.annualLeaveTotal - e.annualLeaveUsed).toFixed(1));
    lines.push(
      `员工档案（可引用，但不要透露他人信息）：${e.name} / ${e.department} / ${e.title} / ${e.level} / ` +
        `${e.status === 'PROBATION' ? '试用期' : '正式'} / 入职 ${e.hireDate} / 办公地 ${e.location} / ` +
      `直属上级 ${e.managerName ?? '未配置'} / 成本中心 ${e.costCenter} / ` +
        `年假额度 ${e.annualLeaveTotal} 天已用 ${e.annualLeaveUsed} 天剩余 ${remaining} 天 / 可用调休 ${e.compTimeDays} 天`,
    );
  }

  if (Object.keys(input.slots).length > 0) {
    lines.push(
      `已抽取的关键信息：${Object.entries(input.slots).map(([k, v]) => `${k}=${String(v)}`).join('，')}`,
    );
  }

  const usefulToolCalls = input.toolCalls.filter((t) => t.status === 'OK' && t.summary);
  if (usefulToolCalls.length > 0) {
    lines.push('');
    lines.push('已读取的系统上下文（这是事实，回复时必须纳入判断）：');
    usefulToolCalls.forEach((t) => {
      lines.push(`- ${t.toolName}：${t.summary}`);
    });
  }

  if (input.citations.length > 0) {
    lines.push('');
    lines.push('检索到的制度依据（**只能用这些内容作答**）：');
    input.citations.forEach((c, i) => {
      lines.push(`[${i + 1}] 《${c.title}》「${c.section}」（${c.docId}，相似度 ${c.score}）`);
      lines.push(`    ${c.snippet}`);
    });
  } else if (!input.skill.knowledgeRequired) {
    lines.push('');
    lines.push('检索结果：这类诉求不依赖知识库，可直接陪伴、拆解目标或调用 mock 工具。');
  } else {
    lines.push('');
    lines.push('检索结果：**知识库没有命中任何制度依据**。');
  }

  lines.push('');
  lines.push(
    `风险判定（已由规则引擎确定，不可更改）：${input.risk.level} —— ${cfg.risk.levels[input.risk.level]?.policy ?? ''}`,
  );
  if (input.risk.reasons.length > 0) {
    lines.push(
      `命中规则：${input.risk.reasons.map((r) => `${r.ruleId} ${r.name}`).join('；')}`,
    );
  }
  lines.push(`处理去向：${input.skill.handoffTeam}`);

  lines.push('');
  lines.push('系统已经执行的动作（如实告知员工，不要多说也不要少说）：');
  if (input.actions.includes('clarify')) {
    const writeCalls = input.toolCalls.filter((t) => t.status === 'OK' && t.summary && t.endpoint.startsWith('POST'));
    if (writeCalls.length > 0) {
      writeCalls.forEach((t) => lines.push(`- ${t.toolName}：${t.summary}`));
    } else {
      lines.push('- 未执行最终提交动作。');
    }
    lines.push(`- 还缺少必填信息：${input.missingSlots.map((s) => s.label).join('、')}。需要向员工追问这些信息。`);
  } else {
    if (input.artifacts.gapId) {
      lines.push(`- 已把这个问题记为待补充知识 ${input.artifacts.gapId}，会进入知识运营补充`);
    }
    if (input.actions.includes('handoff')) {
      lines.push(`- 已标记 ${input.skill.handoffTeam} 人工介入，对方可查看历史聊天和 Agent 判断依据`);
    }
    if (input.actions.length === 1 && input.actions[0] === 'answer') {
      lines.push('- 无需建单，直接答复或展示流程入口即可');
    }
  }

  return lines.join('\n');
}

function buildInstruction(input: LlmComposeInput): string {
  // Skill 级追加指令：来自 config/agent-skills.json 的 prompt 字段。
  // 全局约束写在 config/system-prompt.md，这里写「这一类诉求特有的注意事项」。
  const skillPrompt = input.skill.prompt?.trim();

  const rules: string[] = [
    '现在用中文写一段面向该员工的回复。要求：',
    '1. 先给结论和下一步，再给依据。',
    '2. 引用制度时写成《文档标题》「章节名」的形式，不允许只写「根据公司规定」。',
    '3. **只能使用上面给出的制度片段内容**。金额、天数、时限、审批链路必须与片段一致，不得推测或补充片段里没有的数字。',
    '3.1 **不得自行推断对应关系**。制度表格里如果分了档位（员工/经理/总监、一类/二类城市、不同司龄区间），而片段里没有写明「员工的职级/城市/司龄属于哪一档」，就不要替员工判断属于哪档 —— 列出适用的档位让他自己对照，或说明需要向对应团队确认。擅自映射看起来很专业，但答错的代价由员工承担。',
    '4. 不要复述风险等级、规则编号、Skill 名称这些内部术语，员工看不懂也不该看到。',
    '5. 如果上面提供了已执行工具、提醒、知识缺口或人工介入记录，必须如实告知员工；不要编造工单号、审批号或真实系统提交结果。',
    '6. 不透露任何其他员工的薪酬、绩效、证件号等信息。',
    '7. 长度控制在 300 字以内，简洁、确定、可执行。不要用「可能」「或许」这类模糊表达，除非确实不确定并说明原因。',
    '8. 直接输出回复正文，不要加「以下是回复」这类前缀，不要用 JSON。',
  ];

  if (input.citations.length === 0 && input.skill.knowledgeRequired) {
    rules.push(
      '9. 知识库没有依据，所以必须如实说明「没有找到明确的制度依据」，并告知已记录知识缺口。**绝对不能凭常识编造制度内容。** IT/行政类问题可以提示转人工，HR/财务回到流程入口。',
    );
  }
  if (input.risk.level === 'HIGH') {
    rules.push(
      '9. 这是当前 Demo 不自动处理的事项，必须明确告诉员工不能直接执行；HR/财务回到公司既有流程，IT/行政才提示人工介入。',
    );
  }
  if (input.actions.includes('clarify')) {
    rules.push('9. 这轮的目的是追问缺失信息，不要假装已经办好，也不要编造工单号。');
  }
  if (input.skill.id === 'agent.customer_review') {
    rules.push(
      '9. 这是客户评审准备工作流。回复必须先展示处理思路：说明你把目标拆成会议安排、资料检查、客户确认、会前提醒四块；再说明你查了日程、会议室、历史资料、天气和提醒；最后给清单。最终清单必须分条展示，按「会议安排 / 资料准备 / 客户确认 / 会前提醒 / 下一步」组织，不要写成一整段，不要写成工单处理。',
    );
  }
  if (input.skill.id === 'companion.work') {
    rules.push(
      '9. 这是工作陪伴或轻量梳理，不需要制度依据，也不要说知识库没命中。语气自然一点，像靠谱同事一样接住情绪并给一个下一步。',
    );
  }

  if (skillPrompt) {
    rules.push('', `## 本类诉求（${input.skill.name}）的额外要求`, skillPrompt);
  }

  return rules.join('\n');
}

export async function composeReplyLlm(
  input: LlmComposeInput,
  cfg: LlmRuntimeConfig,
): Promise<LlmComposeResult> {
  const { systemPrompt } = getConfig();

  const res = await chatCompletion(cfg, {
    messages: [
      {
        role: 'system',
        content:
          systemPrompt.trim().length > 0
            ? systemPrompt
            : '你是小助，员工个人工作助手，面向员工提供工作陪伴、知识库问答、客户评审准备和 IT/行政人工兜底。',
      },
      {
        role: 'user',
        content: `${buildBriefing(input)}\n\n---\n\n${buildInstruction(input)}`,
      },
    ],
  });

  const reply = res.content.trim();
  if (!reply) {
    throw new Error('大模型返回了空回复');
  }

  return { reply, usage: res.usage, durationMs: res.durationMs };
}
