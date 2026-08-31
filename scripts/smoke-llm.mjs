#!/usr/bin/env node
/**
 * LLM 路径专项测试。跑在「假的 OpenAI 兼容服务」上，所以不花钱、不需要 API Key、结果确定。
 *
 * 验证的不是"模型答得好不好"（那不该用断言测），而是工程正确性：
 *   - 大模型的输出被正确解析、白名单过滤、类型强制转换
 *   - 风险分级 / 工单 / 审批仍然由规则决定，模型改不了
 *   - System Prompt 真的被送进去了
 *   - 各种失败模式（超时/限流/401/脏响应/空回复）都能如实降级而不是伪装成大模型
 *
 * 用法（三个终端）：
 *   1) npm run llm:fake
 *   2) npm run dev:llm-fake
 *   3) npm run smoke:llm
 */

const APP = process.env.APP_URL ?? 'http://localhost:3000';
const FAKE = process.env.FAKE_LLM_URL ?? 'http://localhost:8123';

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

async function chat(message, employeeId = 'E1001') {
  const res = await fetch(new URL('/api/agent/chat', APP), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, employeeId }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`chat 失败 ${res.status}: ${JSON.stringify(body)}`);
  return body.data;
}

/** 让假服务在下一批请求里注入指定故障 */
async function setFakeMode(mode) {
  const res = await fetch(new URL('/mode', FAKE), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(`设置 fake mode 失败：${res.status}`);
  modeDirty = mode !== 'ok';
}

console.log(`\n应用：${APP}\n假模型服务：${FAKE}\n`);

// 无论本次运行怎么结束（通过 / 断言失败 / 抛异常 / Ctrl-C），都把假服务的故障模式复位。
// 踩过的坑：某次运行在 timeout 模式下崩溃，假服务停在「永不响应」状态，
// 之后所有测试和手工验证全部挂死，排查了半天才发现是上一次留下的。
let modeDirty = false;
const resetFakeMode = async () => {
  if (!modeDirty) return;
  try {
    await fetch(new URL('/mode', FAKE), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'ok' }),
    });
    modeDirty = false;
  } catch {
    console.error(`\n⚠️ 无法复位假服务故障模式，请手动执行：\n   curl -X POST ${FAKE}/mode -d '{"mode":"ok"}' -H 'Content-Type: application/json'`);
  }
};
process.on('exit', () => {
  if (modeDirty) {
    console.error(`\n⚠️ 假服务可能停在故障模式，请手动复位：\n   curl -X POST ${FAKE}/mode -d '{"mode":"ok"}' -H 'Content-Type: application/json'`);
  }
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await resetFakeMode();
    process.exit(130);
  });
}

// ── 前置：确认当前确实跑在 llm 引擎上 ────────────────────────────────────
console.log('前置检查');
{
  const cfg = await (await fetch(new URL('/api/config', APP))).json();
  check('应用配置为 llm 引擎', cfg.data?.engine === 'llm', `实际 ${cfg.data?.engine}`);
  if (cfg.data?.engine !== 'llm') {
    console.log('\n请用 npm run dev:llm-fake 启动应用后再跑本测试。');
    process.exit(1);
  }
  check('System Prompt 非空', (cfg.data?.systemPromptChars ?? 0) > 500, `${cfg.data?.systemPromptChars} 字`);
}

// ── 1. 大模型正常路径 ────────────────────────────────────────────────────
console.log('\n① 大模型正常路径');
{
  const r = await chat('出差去成都，住宿一晚最多能报多少钱？', 'E1005');
  check('engine 标为 llm', r.engine === 'llm', r.engine);
  check('未发生降级', r.degraded === false);
  check('回复由假模型生成', r.reply.includes('[FAKE-LLM]'), r.reply.slice(0, 40));
  check('统计了 token 用量', (r.llm?.totalTokens ?? 0) > 0, JSON.stringify(r.llm));
  check('两次调用（意图 + 合成）', r.llm?.calls === 2, String(r.llm?.calls));
  check('采用了模型给的置信度', r.intents[0]?.confidence === 0.92, String(r.intents[0]?.confidence));
  check('链路里有大模型步骤', r.trace.some((s) => s.stage === 'llm' && s.status === 'OK'));
  check(
    '链路记录了 System Prompt 已注入',
    r.trace.some((s) => s.stage === 'llm' && /System Prompt/.test(s.detail)),
  );
  check('知识检索仍然执行', r.intents[0]?.citations.length > 0);
}

// ── 2. 多意图（模型返回 2 个）────────────────────────────────────────────
console.log('\n② 多意图拆解');
{
  const r = await chat('OA 密码忘了怎么重置？另外我 9 月 7 日想请 3 天年假', 'E1001');
  check('拆出 2 个意图', r.intents.length === 2, String(r.intents.length));
  const leave = r.intents.find((i) => i.id === 'hr.leave_apply');
  check('模型抽到了天数', leave?.slots.days === 3, JSON.stringify(leave?.slots));
  check('模型抽到了日期', leave?.slots.startDate === '2026-09-07', JSON.stringify(leave?.slots));
  check('请假意图建了工单', Boolean(leave?.artifacts.ticketId));
}

// ── 3. 关键：模型改不了风险判定 ──────────────────────────────────────────
console.log('\n③ 风险分级仍由规则掌控（模型无权改）');
{
  const r = await chat('帮我开通生产数据库的只读权限，我要查订单表', 'E1003');
  check('engine 为 llm', r.engine === 'llm');
  check('风险仍判为 HIGH', r.overallRisk === 'HIGH', r.overallRisk);
  const rules = r.intents[0]?.risk.reasons.map((x) => x.ruleId) ?? [];
  check('命中 R001（生产环境）', rules.includes('R001'), rules.join(','));
  check('命中 R009（试用期升级）', rules.includes('R009'), rules.join(','));
  check('仍然创建了人工确认任务', Boolean(r.intents[0]?.artifacts.approvalId));
  check('需人工介入', r.needsHumanReview === true);
  check('回复里带上了工单号', /TK-\d{8}-\d{4}/.test(r.reply), r.reply.slice(0, 80));
  check('回复里带上了审批任务号', /AP-\d{8}-\d{4}/.test(r.reply));
}

// ── 4. 白名单过滤：模型发明的意图必须被丢弃 ──────────────────────────────
console.log('\n④ 模型发明的意图被白名单拦掉');
{
  const r = await chat('测试非法意图', 'E1001');
  check(
    '未采用不存在的 intent id',
    r.intents.every((i) => i.id !== 'evil.not_in_catalog'),
    r.intents.map((i) => i.id).join(','),
  );
  check('落到兜底 Skill', r.intents[0]?.skillId === 'fallback.handoff', r.intents[0]?.skillId);
  check('链路里记录了丢弃动作', r.trace.some((s) => /丢弃/.test(s.detail)));
}

// ── 5. 脏槽位：类型强制转换与拒绝 ────────────────────────────────────────
console.log('\n⑤ 脏槽位被清洗');
{
  const r = await chat('测试脏槽位 报销', 'E1004');
  const i = r.intents[0];
  check('"8600元" 被转成数字 8600', i?.slots.amount === 8600, JSON.stringify(i?.slots));
  check('非法枚举值被拒绝', i?.slots.category === undefined, JSON.stringify(i?.slots));
  check('链路里记录了拒绝原因', r.trace.some((s) => /不在可选值内/.test(s.detail)));
  check('金额触发 R005 升级为 HIGH', r.overallRisk === 'HIGH', r.overallRisk);
}

// ── 6. 未命中：模型说没匹配 + 知识库也没命中 ─────────────────────────────
console.log('\n⑥ 未命中沉淀');
{
  const r = await chat('下个月带样机去德国参展，海关清关手续怎么办？', 'E1002');
  const i = r.intents[0];
  check('落到兜底 Skill', i?.skillId === 'fallback.handoff', i?.skillId);
  check('知识库未命中', i?.knowledgeHit === false, `topScore=${i?.topScore}`);
  check('沉淀了知识缺口', Boolean(i?.artifacts.gapId), JSON.stringify(i?.artifacts));
  check('回复中没有编造制度', /没有找到明确的制度依据/.test(r.reply), r.reply.slice(0, 60));
}

// ── 7. 各种失败模式：必须如实降级，不能伪装成大模型 ──────────────────────
console.log('\n⑦ 失败降级（关键：不能标称 llm 而实际跑规则）');
for (const [mode, label] of [
  ['429', '限流'],
  ['401', '鉴权失败'],
  ['500', '服务端错误'],
  ['malformed', '响应非 JSON'],
  ['empty', '空回复'],
  ['timeout', '超时'],
]) {
  await setFakeMode(mode);
  const r = await chat('出差去成都，住宿一晚最多能报多少钱？', 'E1005');
  const ok =
    r.engine === 'mock' &&
    r.degraded === true &&
    typeof r.degradedReason === 'string' &&
    r.degradedReason.length > 0 &&
    r.requestedEngine === 'llm' &&
    !r.reply.includes('[FAKE-LLM]');
  check(
    `${label}（${mode}）如实降级为规则引擎`,
    ok,
    `engine=${r.engine} degraded=${r.degraded} reason=${(r.degradedReason ?? '').slice(0, 60)}`,
  );
  check(`${label}：业务结论依然正确`, r.overallRisk === 'LOW' && r.intents[0]?.citations.length > 0);
  check(`${label}：链路里有 ERROR 步骤说明原因`, r.trace.some((s) => s.status === 'ERROR'));
}
await setFakeMode('ok');

// ── 8. 恢复正常 ──────────────────────────────────────────────────────────
console.log('\n⑧ 故障恢复后自动回到大模型');
{
  const r = await chat('出差去成都，住宿一晚最多能报多少钱？', 'E1005');
  check('engine 回到 llm', r.engine === 'llm', r.engine);
  check('未降级', r.degraded === false);
}

console.log('\n────────────────────────────────');
console.log(`通过 ${pass}，失败 ${fail}`);
if (fail > 0) process.exitCode = 1;
