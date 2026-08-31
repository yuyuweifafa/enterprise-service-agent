#!/usr/bin/env node
/**
 * 端到端冒烟测试：把 Demo 的 6 条主路径 + 工单/审批/看板 API 跑一遍，
 * 断言每条路径产出的意图数、风险等级、动作与产物都符合预期。
 *
 *   npm run dev                  # 另开终端起服务
 *   npm run smoke                # 默认 http://localhost:3000
 *   npm run smoke -- http://localhost:3111
 */

const BASE = process.argv[2] ?? 'http://localhost:3000';

let pass = 0;
let fail = 0;

function check(name, cond, detail = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${detail ? `  ← ${detail}` : ''}`);
  }
}

async function api(path, init) {
  const res = await fetch(new URL(path, BASE), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function chat(message, employeeId) {
  const { status, body } = await api('/api/agent/chat', {
    method: 'POST',
    body: JSON.stringify({ message, employeeId }),
  });
  if (status !== 200) throw new Error(`chat 失败 ${status}: ${JSON.stringify(body)}`);
  return body.data;
}

console.log(`\n目标服务：${BASE}\n`);

// ── 前置：本套断言基于规则引擎的确定性行为，跑在 llm 引擎上会误报 ──────────
{
  const { body } = await api('/api/config');
  const engine = body?.data?.engine;
  if (engine !== 'mock') {
    console.error(
      [
        `当前应用运行在 "${engine}" 引擎上，本测试套件断言的是规则引擎的确定性行为（置信度、动作集、槽位抽取结果）。`,
        '大模型有随机性，跑在 llm 引擎上会产生误报。',
        '',
        '请用规则引擎启动应用后重跑：',
        '  AGENT_ENGINE=mock npm run dev',
        '或把 .env.local 里的 AGENT_ENGINE 改为 mock。',
        '',
        'LLM 路径请用 npm run smoke:llm（跑在本地假模型服务上，结果确定）。',
      ].join('\n'),
    );
    process.exit(1);
  }
}

// ── 场景 1：低风险，直接答复 ──────────────────────────────────────────────
console.log('场景 ① 低风险 · 直接答复');
{
  const r = await chat('出差去成都，住宿一晚最多能报多少钱？', 'E1005');
  check('风险判为 LOW', r.overallRisk === 'LOW', r.overallRisk);
  check('识别为财务域', r.intents[0]?.domain === 'FINANCE', r.intents[0]?.domain);
  check('命中知识库并给出引用', r.intents[0]?.citations.length > 0);
  check('不需要人工介入', r.needsHumanReview === false);
  check('未创建工单', !r.intents[0]?.artifacts.ticketId);
  check('引用了费用报销制度', r.intents[0]?.citations.some((c) => c.docId === 'FIN-KB-001'));
}

// ── 场景 2：多意图 ────────────────────────────────────────────────────────
console.log('\n场景 ② 多意图 · 一句话两件事');
{
  const r = await chat('OA 密码忘了怎么重置？另外我 9 月 7 日想请 3 天年假', 'E1001');
  check('拆出 2 个意图', r.intents.length === 2, `实际 ${r.intents.length}`);
  const domains = r.intents.map((i) => i.domain).sort();
  check('分别落在 IT 与 HR', domains.join(',') === 'HR,IT', domains.join(','));
  const leave = r.intents.find((i) => i.id === 'hr.leave_apply');
  check('识别到请假申请意图', Boolean(leave), r.intents.map((i) => i.id).join(','));
  check('抽到天数槽位 = 3', leave?.slots.days === 3, JSON.stringify(leave?.slots));
  check('抽到开始日期槽位', typeof leave?.slots.startDate === 'string', JSON.stringify(leave?.slots));
  check('请假意图创建了工单', Boolean(leave?.artifacts.ticketId), JSON.stringify(leave?.artifacts));
}

// ── 场景 3：中风险，自动建单 ──────────────────────────────────────────────
console.log('\n场景 ③ 中风险 · 自动建单');
let mediumTicketId = null;
{
  const r = await chat('我的笔记本这两天一直蓝屏，帮我报修一下', 'E1001');
  check('风险判为 MEDIUM', r.overallRisk === 'MEDIUM', r.overallRisk);
  check('动作包含创建工单', r.intents[0]?.actions.includes('create_ticket'));
  mediumTicketId = r.intents[0]?.artifacts.ticketId ?? null;
  check('返回工单号', Boolean(mediumTicketId));
  check('未创建人工确认任务', !r.intents[0]?.artifacts.approvalId);
}

// ── 场景 4：高风险，人工确认 ──────────────────────────────────────────────
console.log('\n场景 ④ 高风险 · 人工确认（试用期员工）');
let approvalId = null;
{
  const r = await chat('帮我开通生产数据库的只读权限，我要查订单表', 'E1003');
  check('风险判为 HIGH', r.overallRisk === 'HIGH', r.overallRisk);
  const intent = r.intents[0];
  check('命中 R001 生产环境规则', intent?.risk.reasons.some((x) => x.ruleId === 'R001'));
  check(
    '命中 R009 试用期升级规则',
    intent?.risk.reasons.some((x) => x.ruleId === 'R009'),
    intent?.risk.reasons.map((x) => x.ruleId).join(','),
  );
  check('需要人工介入', r.needsHumanReview === true);
  check('创建了工单', Boolean(intent?.artifacts.ticketId));
  approvalId = intent?.artifacts.approvalId ?? null;
  check('创建了人工确认任务', Boolean(approvalId), JSON.stringify(intent?.artifacts));
  check('查过权限系统', intent?.toolCalls.some((t) => t.toolId === 'it.get_permissions'));
  check('回复中明确不能直接开通', r.reply.includes('不能'));
}

// ── 场景 5：未命中，知识沉淀 ──────────────────────────────────────────────
console.log('\n场景 ⑤ 未命中 · 知识沉淀');
{
  const r = await chat('下个月带样机去德国参展，海关清关手续怎么办？', 'E1002');
  const intent = r.intents[0];
  check('知识库未命中', intent?.knowledgeHit === false, `topScore=${intent?.topScore}`);
  check('动作包含沉淀知识缺口', intent?.actions.includes('record_gap'), intent?.actions.join(','));
  check('动作包含转人工', intent?.actions.includes('handoff'));
  check('产出知识缺口编号', Boolean(intent?.artifacts.gapId), JSON.stringify(intent?.artifacts));
  check('回复中不编造答案', r.reply.includes('没有') || r.reply.includes('未'));
  check('命中 R010 未命中规则', intent?.risk.reasons.some((x) => x.ruleId === 'R010'));
}

// ── 场景 6：槽位缺失，主动追问 ────────────────────────────────────────────
console.log('\n场景 ⑥ 槽位缺失 · 主动追问');
{
  const r = await chat('帮我提交一笔报销', 'E1004');
  const intent = r.intents[0];
  check('识别为提交报销单', intent?.id === 'fin.reimburse_submit', intent?.id ?? 'null');
  check('检测到缺失必填槽位', (intent?.missingSlots.length ?? 0) > 0);
  check('动作为追问而不是建单', intent?.actions.join(',') === 'clarify', intent?.actions.join(','));
  check('未创建工单', !intent?.artifacts.ticketId);
  check('回复里问了金额', r.reply.includes('金额'));
}

// ── 场景 7：金额触发高风险升级 ────────────────────────────────────────────
console.log('\n场景 ⑦ 金额阈值 · 自动升级为高风险');
{
  const r = await chat('帮我提交一笔 8600 元的差旅报销', 'E1005');
  const intent = r.intents[0];
  check('抽到金额 8600', intent?.slots.amount === 8600, JSON.stringify(intent?.slots));
  check('风险升级为 HIGH', r.overallRisk === 'HIGH', r.overallRisk);
  check('命中 R005 金额规则', intent?.risk.reasons.some((x) => x.ruleId === 'R005'));
}

// ── 场景 8：闲聊前置拦截 ──────────────────────────────────────────────────
console.log('\n场景 ⑧ 闲聊 / 无实义输入不进主管线');
{
  const before = await api('/api/tickets');
  const gapsBefore = await api('/api/knowledge/gaps');

  for (const [text, expectKind] of [
    ['你好', 'chitchat.greeting'],
    ['谢谢', 'chitchat.thanks'],
    ['好的', 'chitchat.ack'],
    ['？？？', 'input.too_short'],
    ['你是谁', 'chitchat.identity'],
  ]) {
    const r = await chat(text, 'E1001');
    check(
      `「${text}」命中 ${expectKind}`,
      r.prefilter?.kind === expectKind,
      `实际 ${r.prefilter?.kind ?? '未拦截'}`,
    );
    check(`「${text}」没走意图识别`, r.intents.length === 0);
    check(`「${text}」风险为 LOW 且无需人工`, r.overallRisk === 'LOW' && !r.needsHumanReview);
  }

  const after = await api('/api/tickets');
  const gapsAfter = await api('/api/knowledge/gaps');
  check('闲聊未产生任何工单', after.body.data.length === before.body.data.length, `${before.body.data.length}→${after.body.data.length}`);
  check('闲聊未沉淀任何知识缺口', gapsAfter.body.data.length === gapsBefore.body.data.length);

  // 关键反向用例：带问候前缀的真实诉求不能被误拦
  const real = await chat('你好，我要申请 VPN 权限', 'E1001');
  check('「你好，我要申请 VPN 权限」未被误拦', real.prefilter === null, JSON.stringify(real.prefilter));
  check('该诉求正常识别为 VPN 申请', real.intents[0]?.id === 'it.vpn_access', real.intents[0]?.id ?? 'null');

  const logs = await api('/api/logs?limit=50');
  const st = logs.body.data.filter((l) => l.kind === 'smalltalk');
  check('闲聊已记日志并标记 kind=smalltalk', st.length >= 5, `${st.length} 条`);

  const metrics = await api('/api/metrics?days=14');
  check(
    '闲聊被剔除在看板口径之外',
    (metrics.body.data.smallTalkExcluded ?? 0) >= 5,
    `smallTalkExcluded=${metrics.body.data.smallTalkExcluded}`,
  );
}

// ── 场景 9：域外请求（这三条是实测发现的真实 bug，固化成回归用例）──────────
console.log('\n场景 ⑨ 域外请求不进主管线，也不算知识缺口');
{
  const tBefore = await api('/api/tickets');
  const gBefore = await api('/api/knowledge/gaps');

  for (const [text, expectKind] of [
    ['今天天气怎么样', 'scope.weather'],
    ['帮我写一段Python冒泡排序', 'scope.coding'],
    ['推荐个附近的午饭', 'scope.personal_life'],
    ['帮我翻译成英文', 'scope.general_knowledge'],
    ['今天股价涨了吗', 'scope.market_news'],
  ]) {
    const r = await chat(text, 'E1001');
    check(`「${text}」判为域外 ${expectKind}`, r.prefilter?.kind === expectKind, `实际 ${r.prefilter?.kind ?? '未拦截'}`);
    check(`「${text}」类型为 out_of_scope`, r.prefilter?.type === 'out_of_scope');
    check(`「${text}」回复里说明了服务范围`, /IT|HR|财务|行政/.test(r.reply));
    check(`「${text}」未调用大模型`, (r.llm?.calls ?? 0) === 0, `calls=${r.llm?.calls}`);
  }

  const tAfter = await api('/api/tickets');
  const gAfter = await api('/api/knowledge/gaps');
  check('域外请求未产生工单', tAfter.body.data.length === tBefore.body.data.length, `${tBefore.body.data.length}→${tAfter.body.data.length}`);
  check(
    '域外请求未沉淀知识缺口（公司不会为天气写制度）',
    gAfter.body.data.length === gBefore.body.data.length,
    `${gBefore.body.data.length}→${gAfter.body.data.length}`,
  );

  // 关键对照：域内但知识缺失 —— 必须沉淀缺口 + 建单，不能和域外混为一谈
  const inScope = await chat('下个月带样机去德国参展，海关清关手续怎么办？', 'E1002');
  check('域内知识缺失仍走主管线', inScope.prefilter === null, JSON.stringify(inScope.prefilter));
  check('域内知识缺失沉淀了知识缺口', Boolean(inScope.intents[0]?.artifacts.gapId));
  check(
    '域内知识缺失建了工单（兜底路径必须有人跟进）',
    Boolean(inScope.intents[0]?.artifacts.ticketId),
    JSON.stringify(inScope.intents[0]?.artifacts),
  );
  check('域内知识缺失的回复不编造制度', /没有找到|未找到/.test(inScope.reply), inScope.reply.slice(0, 50));

  // 反向：含域外词但其实是正常诉求，不能被误拦
  const notOos = await chat('我要申请代码仓库的访问权限', 'E1001');
  check('「申请代码仓库权限」未被误判为域外', notOos.prefilter === null, JSON.stringify(notOos.prefilter));

  const metrics = await api('/api/metrics?days=14');
  check(
    '域外请求被剔除在看板口径外',
    (metrics.body.data.smallTalkExcluded ?? 0) >= 5,
    `smallTalkExcluded=${metrics.body.data.smallTalkExcluded}`,
  );
}

// ── 工单 API ─────────────────────────────────────────────────────────────
console.log('\n工单 API');
{
  const { body } = await api('/api/tickets');
  check('列表可读', Array.isArray(body?.data) && body.data.length > 0);
  check('包含刚创建的工单', body.data.some((t) => t.id === mediumTicketId), mediumTicketId ?? '-');

  const patched = await api(`/api/tickets/${mediumTicketId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'IN_PROGRESS', actor: 'smoke-test', note: '冒烟测试推进' }),
  });
  check('可推进状态', patched.body?.data?.status === 'IN_PROGRESS', JSON.stringify(patched.body));
  check('时间线追加了一条', patched.body?.data?.timeline?.length >= 2);

  const missing = await api('/api/tickets/TK-NOT-EXIST', {
    method: 'PATCH',
    body: JSON.stringify({ status: 'CLOSED' }),
  });
  check('不存在的工单返回 404', missing.status === 404, String(missing.status));

  const badBody = await api('/api/tickets', { method: 'POST', body: JSON.stringify({ title: '' }) });
  check('入参非法返回 400', badBody.status === 400, String(badBody.status));
  check('错误码为 INVALID_REQUEST', badBody.body?.error?.code === 'INVALID_REQUEST');
}

// ── 审批 API：人工确认闭环 ────────────────────────────────────────────────
console.log('\n人工审核闭环');
{
  const before = await api(`/api/approvals/${approvalId}`);
  check('审批任务可读', before.body?.data?.status === 'PENDING', JSON.stringify(before.body?.data?.status));
  check('带上了 Agent 判定依据', (before.body?.data?.riskReasons?.length ?? 0) > 0);
  check('带上了引用来源', (before.body?.data?.agentEvidence?.citations?.length ?? 0) > 0);

  const ticketId = before.body?.data?.ticketId;
  const decided = await api(`/api/approvals/${approvalId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'REJECTED',
      reviewer: 'smoke-test',
      decisionNote: '改授数仓脱敏视图，无需生产库权限',
    }),
  });
  check('可驳回', decided.body?.data?.status === 'REJECTED', JSON.stringify(decided.body));

  const ticket = await api(`/api/tickets/${ticketId}`);
  check('决策回写到工单状态', ticket.body?.data?.status === 'REJECTED', ticket.body?.data?.status);
  check(
    '决策说明写入工单时间线',
    ticket.body?.data?.timeline?.some((e) => e.note?.includes('脱敏视图')),
  );

  const again = await api(`/api/approvals/${approvalId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'APPROVED', reviewer: 'smoke-test' }),
  });
  check('重复处理被拒绝（409）', again.status === 409, String(again.status));
}

// ── 知识缺口 ─────────────────────────────────────────────────────────────
console.log('\n知识缺口沉淀');
{
  const { body } = await api('/api/knowledge/gaps');
  check('缺口列表可读', Array.isArray(body?.data) && body.data.length > 0);
  const clearance = body.data.find((g) => g.question.includes('清关') || g.question.includes('参展'));
  check('参展清关问题已沉淀', Boolean(clearance), body.data.map((g) => g.id).join(','));

  // 换个说法再问一次，验证「相似问题累加而不是新建条目」
  // （不依赖 seed 预置数据，自己制造两次命中）
  const gapCountBefore = body.data.length;
  const occBefore = clearance?.occurrences ?? 0;
  await chat('带样机去德国参展，海关清关手续要怎么弄？', 'E1002');
  const after = await api('/api/knowledge/gaps');
  const clearanceAfter = after.body.data.find(
    (g) => g.question.includes('清关') || g.question.includes('参展'),
  );
  check(
    '相似问题累加次数而非新建条目',
    clearanceAfter?.occurrences === occBefore + 1 && after.body.data.length === gapCountBefore,
    `occurrences ${occBefore}→${clearanceAfter?.occurrences}，条目数 ${gapCountBefore}→${after.body.data.length}`,
  );

  const advanced = await api(`/api/knowledge/gaps/${clearance.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'DRAFTING' }),
  });
  check('可推进为拟稿中', advanced.body?.data?.status === 'DRAFTING');
}

// ── 其他 mock API ────────────────────────────────────────────────────────
console.log('\n其他 mock API');
{
  const emp = await api('/api/employees/E1003');
  check('查询员工信息', emp.body?.data?.name === '陈可', JSON.stringify(emp.body?.data?.name));
  check('带出权限列表', Array.isArray(emp.body?.data?.permissions));

  const emp404 = await api('/api/employees/E9999');
  check('员工不存在返回 404', emp404.status === 404, String(emp404.status));

  const perm = await api('/api/permissions?employeeId=E1003&system=生产');
  check('按系统过滤权限', perm.body?.data?.[0]?.status === 'NONE', JSON.stringify(perm.body?.data));

  const kb = await api('/api/knowledge');
  check('知识库文档已索引', (kb.body?.meta?.totalDocs ?? 0) >= 10, JSON.stringify(kb.body?.meta));

  const logs = await api('/api/logs?limit=5');
  check('处理日志可读', Array.isArray(logs.body?.data) && logs.body.data.length > 0);
  const traceId = logs.body.data[0].traceId;
  const rated = await api('/api/logs', {
    method: 'PATCH',
    body: JSON.stringify({ traceId, feedback: 'up' }),
  });
  check('可对回答打分', rated.body?.data?.feedback === 'up');

  const cfg = await api('/api/config');
  check('配置接口可读', cfg.body?.data?.engine === 'mock', JSON.stringify(cfg.body?.data?.engine));
  check('意图规则已加载', (cfg.body?.data?.intents?.count ?? 0) >= 20);
  check('工具注册表已加载', (cfg.body?.data?.tools?.list?.length ?? 0) >= 8);
}

// ── 看板指标 ─────────────────────────────────────────────────────────────
console.log('\n效果看板');
{
  const { body } = await api('/api/metrics?days=14');
  const m = body?.data;
  check('返回指标', Boolean(m));
  check('解决率在 0~1 之间', m.rates.resolutionRate > 0 && m.rates.resolutionRate <= 1, String(m.rates.resolutionRate));
  check('命中率在 0~1 之间', m.rates.knowledgeHitRate > 0 && m.rates.knowledgeHitRate <= 1);
  check('转人工率在 0~1 之间', m.rates.escalationRate > 0 && m.rates.escalationRate <= 1);
  check('解决率 + 转人工率 ≈ 1', Math.abs(m.rates.resolutionRate + m.rates.escalationRate - 1) < 0.02);
  check('有节省工时', m.savings.savedHours > 0, String(m.savings.savedHours));
  check('趋势数据点齐全', m.trend.length === m.range.days, `${m.trend.length}/${m.range.days}`);
  check('职能域分布非空', m.byDomain.length > 0);
  check('风险分布合计 100%', Math.abs(m.riskDistribution.reduce((s, r) => s + r.share, 0) - 1) < 0.02);
  check('平均响应时间为正', m.responseTime.avgLatencyMs > 0);
}

console.log('\n────────────────────────────────');
console.log(`通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exitCode = 1;
