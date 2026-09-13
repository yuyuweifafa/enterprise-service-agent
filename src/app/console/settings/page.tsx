'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui';
import { cn } from '@/lib/format';

type CapabilityStatus = 'live' | 'mock' | 'entry' | 'limited';

interface Capability {
  id: string;
  title: string;
  scope: string;
  status: CapabilityStatus;
  owner: string;
  examples: string[];
  tools: Array<{ name: string; state: CapabilityStatus; desc: string }>;
}

const STATUS_TEXT: Record<CapabilityStatus, string> = {
  live: '已接入',
  mock: '模拟能力',
  entry: '流程入口',
  limited: '知识兜底',
};

const STATUS_CLASS: Record<CapabilityStatus, string> = {
  live: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  mock: 'border-blue-200 bg-blue-50 text-blue-700',
  entry: 'border-amber-200 bg-amber-50 text-amber-700',
  limited: 'border-slate-200 bg-slate-50 text-slate-600',
};

const CAPABILITIES: Capability[] = [
  {
    id: 'companion',
    title: '非服务类对话',
    scope: '支持自然闲聊、情绪陪伴、轻量规划；超范围功能请求只说明暂不支持，不进入知识库和人工队列。',
    status: 'live',
    owner: '小助',
    examples: ['你好可爱啊', '今天有点烦', '帮我写一段 Python'],
    tools: [
      { name: '大模型回复', state: 'live', desc: '直接生成自然回应，保持员工陪伴感。' },
      { name: '服务边界判断', state: 'live', desc: '识别闲聊与超范围功能请求，不污染知识缺口和人工队列。' },
    ],
  },
  {
    id: 'knowledge',
    title: '知识库问答',
    scope: '回答 IT、行政、HR、财务的制度和操作类问题；没有依据时明确提示并沉淀缺口。',
    status: 'live',
    owner: '知识运营',
    examples: ['VPN 怎么开', '电脑登录不上怎么办', '会议室怎么约', '报销标准是什么'],
    tools: [
      { name: '知识库检索', state: 'live', desc: '检索制度、流程和常见问题答案。' },
      { name: '知识缺口沉淀', state: 'live', desc: '未命中的问题自动进入待补充清单。' },
      { name: '满意度反馈', state: 'live', desc: '员工点“没用”后可转 IT / 行政人工。' },
    ],
  },
  {
    id: 'customer-review',
    title: '客户评审准备',
    scope: '一个做深的个人工作助手场景：把一句目标拆成会议、资料、提醒和建议。',
    status: 'mock',
    owner: '产品配置',
    examples: ['我明天要参加客户评审，帮我准备一下事项'],
    tools: [
      { name: '日程空闲时间', state: 'mock', desc: '模拟读取明天空闲时间。' },
      { name: '会议室查询 / 预定', state: 'mock', desc: '模拟查找并锁定会议室。' },
      { name: '历史资料搜索', state: 'mock', desc: '模拟查客户历史会议和文档。' },
      { name: '提醒推送', state: 'mock', desc: '模拟把客户联系提醒写入日程。' },
      { name: '天气 / 着装建议', state: 'mock', desc: '根据出行和天气生成准备建议。' },
    ],
  },
  {
    id: 'handoff',
    title: 'IT / 行政人工接入',
    scope: '只保留两个真实人工方向：IT 和行政。人工能看到原会话、摘要、员工档案和快捷入口。',
    status: 'live',
    owner: '服务团队',
    examples: ['电脑还是登录不上', '门禁卡丢了', '会议室设备坏了'],
    tools: [
      { name: '同岗分配', state: 'mock', desc: 'IT 问题只分给 IT，行政问题只分给行政。' },
      { name: '会话摘要', state: 'live', desc: '进入人工前自动整理上下文。' },
      { name: '建议回复', state: 'mock', desc: '给服务人员一版可编辑回复。' },
    ],
  },
  {
    id: 'flow-entry',
    title: 'HR / 财务流程入口',
    scope: '不做人工后台，只解释制度并给企业已有系统入口，避免 Demo 过重。',
    status: 'entry',
    owner: '企业系统',
    examples: ['我想请假', '客户餐费怎么报销'],
    tools: [
      { name: '假期余额查询', state: 'mock', desc: '模拟展示年假、调休余额。' },
      { name: '请假流程入口', state: 'entry', desc: '展示按钮，不模拟后续审批。' },
      { name: '报销流程入口', state: 'entry', desc: '展示按钮，不模拟财务审批。' },
    ],
  },
];

const ROUTE_STEPS = [
  '员工输入一句话',
  '识别意图与目标',
  '拆成可执行事项',
  '调用知识库 / Skill / 模拟工具',
  '回答、提醒或转人工',
  '后台沉淀结果',
];

const HANDOFF_RULES = [
  { title: 'IT 问题', desc: '电脑、VPN、账号、权限等问题，知识库无法解决或员工点“没用”时进入 IT 人工。' },
  { title: '行政问题', desc: '会议室、门禁、工位、办公用品等问题，涉及现场确认时进入行政人工。' },
  { title: 'HR / 财务', desc: '默认不进人工队列，只给制度说明和企业已有流程入口。' },
  { title: '知识未命中', desc: '先记录知识缺口；如果属于 IT / 行政且影响员工继续工作，再建议人工接入。' },
];

const ASSIGNMENT_RULES = [
  { title: '先按部门路由', desc: '小助先判断问题属于 IT 还是行政，再进入对应部门队列。' },
  { title: '只在同岗内分配', desc: 'IT 处理人只接 IT 会话，行政处理人只接行政会话，不跨部门接单。' },
  { title: '再看处理人负载', desc: '同一部门内优先分给当前待处理更少、能力更匹配的人。' },
  { title: '允许主管改派', desc: 'AI 给建议，后台可手动改派给同部门其他处理人，避免规则误判。' },
];

export default function SettingsPage() {
  const [selectedId, setSelectedId] = useState(CAPABILITIES[2].id);
  const selected = CAPABILITIES.find((item) => item.id === selectedId) ?? CAPABILITIES[0];

  return (
    <div className="space-y-4">
      <PageHeader
        title="设置"
        description="统一管理小助的服务范围、Skill 能力、转人工规则、分配规则和流程入口。对话记录只负责看发生了什么，规则都收在这里。"
      />

      <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <div className="space-y-2">
          {CAPABILITIES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                'w-full rounded-2xl border bg-white p-4 text-left shadow-[0_14px_34px_rgba(51,112,255,0.06)] transition',
                selected.id === item.id
                  ? 'border-[#3370ff] ring-4 ring-[#3370ff]/10'
                  : 'border-[#dbe5ff] hover:border-[#a8bcff]',
              )}
              onClick={() => setSelectedId(item.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[#172033]">{item.title}</h2>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#64748b]">{item.scope}</p>
                </div>
                <span className={cn('chip shrink-0', STATUS_CLASS[item.status])}>{STATUS_TEXT[item.status]}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-2xl border border-[#dbe5ff] bg-white shadow-[0_18px_42px_rgba(51,112,255,0.08)]">
          <div className="h-1 bg-[linear-gradient(90deg,#3370ff,#7c3aed,#14b8a6,#f59e0b)]" />
          <div className="grid gap-4 p-5 lg:grid-cols-[1fr_300px]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold text-[#172033]">{selected.title}</h2>
                <span className={cn('chip', STATUS_CLASS[selected.status])}>{STATUS_TEXT[selected.status]}</span>
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#52637a]">{selected.scope}</p>

              <div className="mt-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#94a3b8]">典型员工表达</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selected.examples.map((example) => (
                    <span key={example} className="rounded-full border border-[#dbe5ff] bg-[#f8fbff] px-3 py-1.5 text-xs font-medium text-[#52637a]">
                      {example}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2">
                {selected.tools.map((tool) => (
                  <div key={tool.name} className="rounded-2xl border border-[#e6ecfa] bg-[#fbfdff] p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-[#172033]">{tool.name}</h3>
                      <span className={cn('chip', STATUS_CLASS[tool.state])}>{STATUS_TEXT[tool.state]}</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-[#64748b]">{tool.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <aside className="rounded-2xl border border-[#dbe5ff] bg-[linear-gradient(160deg,#f8fbff,#ffffff)] p-4">
              <h3 className="text-sm font-semibold text-[#172033]">处理链路</h3>
              <div className="mt-4 space-y-3">
                {ROUTE_STEPS.map((step, index) => (
                  <div key={step} className="flex gap-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#eef4ff] text-xs font-semibold text-[#3370ff]">
                      {index + 1}
                    </span>
                    <div className="min-w-0 border-b border-[#e6ecfa] pb-3 text-sm font-medium text-[#253858] last:border-b-0">
                      {step}
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-4">
        <CompactCard title="服务边界清晰" value="4 类能力" text="闲聊、知识问答、客户评审准备、IT/行政人工接入。" />
        <CompactCard title="Demo 不做过重" value="5 个模拟工具" text="只把个人工作助手的关键动作演出来。" />
        <CompactCard title="人工范围收敛" value="2 个方向" text="IT 和行政接入人工，HR/财务保留流程入口。" />
        <CompactCard title="能力可迭代" value="持续沉淀" text="问题答不上时进入知识运营，不让同类问题反复卡住。" />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <RulePanel title="转人工规则" items={HANDOFF_RULES} />
        <RulePanel title="分配规则" items={ASSIGNMENT_RULES} />
      </section>
    </div>
  );
}

function CompactCard({ title, value, text }: { title: string; value: string; text: string }) {
  return (
    <div className="rounded-2xl border border-[#dbe5ff] bg-white p-4 shadow-[0_14px_34px_rgba(51,112,255,0.07)]">
      <div className="text-xs font-medium text-[#64748b]">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-[#172033]">{value}</div>
      <p className="mt-2 text-xs leading-relaxed text-[#71819a]">{text}</p>
    </div>
  );
}

function RulePanel({ title, items }: { title: string; items: Array<{ title: string; desc: string }> }) {
  return (
    <section className="rounded-2xl border border-[#dbe5ff] bg-white p-4 shadow-[0_18px_42px_rgba(51,112,255,0.08)]">
      <h2 className="text-sm font-semibold text-[#172033]">{title}</h2>
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div key={item.title} className="rounded-xl border border-[#e6ecfa] bg-[#f8fbff] p-3">
            <div className="text-sm font-semibold text-[#172033]">{item.title}</div>
            <p className="mt-1 text-xs leading-relaxed text-[#64748b]">{item.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
