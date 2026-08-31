import { getConfig } from '@/server/config';
import { ok, withErrorHandling } from '@/server/http';

/**
 * GET /api/config — 暴露当前生效的 Agent 配置（Skill / 风险规则 / 工具注册表摘要）。
 * 面试演示时可以直接打开这个接口，说明「能力是配置出来的，不是写死在代码里的」。
 */
export const GET = withErrorHandling(async () => {
  const cfg = getConfig();
  return ok({
    engine: cfg.app.agent.engine,
    app: cfg.app.app,
    retrieval: cfg.app.retrieval,
    intents: {
      version: cfg.intents.version,
      count: cfg.intents.intents.length,
      domains: cfg.intents.domains,
      list: cfg.intents.intents.map((i) => ({
        id: i.id,
        domain: i.domain,
        label: i.label,
        skill: i.skill,
        examples: i.examples,
      })),
    },
    skills: {
      version: cfg.skills.version,
      list: cfg.skills.skills.map((s) => ({
        id: s.id,
        name: s.name,
        domain: s.domain,
        baseRisk: s.baseRisk,
        defaultAction: s.defaultAction,
        tools: s.tools,
        handoffTeam: s.handoffTeam,
        /** 大模型模式下的 Skill 级追加指令是否已配置 */
        hasPrompt: Boolean(s.prompt?.trim()),
        promptChars: s.prompt?.trim().length ?? 0,
      })),
    },
    risk: {
      version: cfg.risk.version,
      levels: cfg.risk.levels,
      rules: cfg.risk.rules.map((r) => ({ id: r.id, name: r.name, when: r.when, effect: r.effect })),
    },
    tools: {
      version: cfg.tools.version,
      list: cfg.tools.tools.map((t) => ({
        id: t.id,
        name: t.name,
        endpoint: `${t.method} ${t.endpoint}`,
        sideEffect: t.sideEffect,
        requiresApproval: t.requiresApproval,
      })),
    },
    /** 三处 prompt 的装载情况，方便确认改动是否生效 */
    prompts: {
      systemPrompt: { file: 'config/system-prompt.md', chars: cfg.systemPrompt.length, usedBy: '回复生成（llm）' },
      intentPrompt: { file: 'config/intent-prompt.md', chars: cfg.intentPrompt.length, usedBy: '意图识别（llm）' },
      skillPrompts: {
        file: 'config/agent-skills.json → skills[].prompt',
        configured: cfg.skills.skills.filter((s) => Boolean(s.prompt?.trim())).length,
        total: cfg.skills.skills.length,
        usedBy: '回复生成（llm），按命中的 Skill 追加',
      },
      replyTemplates: {
        file: 'config/agent-skills.json → skills[].replyTemplate',
        usedBy: '回复生成（mock 规则引擎），与上面三项互不影响',
      },
    },
    systemPromptChars: cfg.systemPrompt.length,
  });
});
