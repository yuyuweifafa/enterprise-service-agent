#!/usr/bin/env node
/**
 * 本地假的 OpenAI 兼容大模型服务，用于在没有 API Key 的情况下验证 LLM 链路。
 *
 * 它做三件事：
 * 1. 按 tool_choice 返回结构化的意图识别结果（模拟 function calling）
 * 2. 按 briefing 内容返回一段回复（模拟回复生成）
 * 3. 可以按需注入错误，用来验证超时 / 限流 / 401 时的降级行为
 *
 *   node scripts/fake-llm-server.mjs [port]
 *
 * 注入错误的方式：请求头 x-fake-mode = timeout | 429 | 401 | 500 | malformed | empty
 * 或启动时设环境变量 FAKE_MODE 让所有请求都走该模式。
 */
import http from 'node:http';

const PORT = Number(process.argv[2] ?? 8123);

/** 关键词 → 意图 id + 槽位，覆盖 smoke 用到的场景 */
const SCENARIOS = [
  {
    match: (q) => /住宿|报销标准|能报多少|差旅标准/.test(q) && !/提交|帮我报/.test(q),
    intents: [{ id: 'fin.reimburse_policy', confidence: 0.92, slots: { category: '住宿' } }],
  },
  {
    match: (q) => /密码/.test(q) && /年假|请假/.test(q),
    intents: [
      { id: 'it.password_reset', confidence: 0.94, slots: { system: 'OA' } },
      { id: 'hr.leave_apply', confidence: 0.89, slots: { leaveType: '年假', startDate: '2026-09-07', days: 3 } },
    ],
  },
  {
    match: (q) => /蓝屏|报修|坏了/.test(q),
    intents: [{ id: 'it.device_repair', confidence: 0.9, slots: { device: '笔记本' } }],
  },
  {
    match: (q) => /生产数据库|生产库|只读权限/.test(q),
    intents: [
      { id: 'it.data_permission', confidence: 0.95, slots: { system: '生产数据库', env: '生产' } },
    ],
  },
  {
    match: (q) => /参展|清关|海关/.test(q),
    intents: [], // 模拟"目录里没有匹配意图"
    unmatched: true,
  },
  {
    match: (q) => /提交一笔报销|帮我报销/.test(q) && !/\d/.test(q),
    intents: [{ id: 'fin.reimburse_submit', confidence: 0.88, slots: {} }],
  },
  {
    match: (q) => /报销/.test(q) && /\d/.test(q),
    // intents 允许写成函数，这样能用到匹配时的原文
    intents: (q) => [
      {
        id: 'fin.reimburse_submit',
        confidence: 0.91,
        slots: { amount: Number(/(\d+)/.exec(q)?.[1] ?? 0), category: '差旅' },
      },
    ],
  },
  {
    // 故意返回一个配置里不存在的意图 id，用于验证白名单过滤
    match: (q) => /测试非法意图/.test(q),
    intents: [{ id: 'evil.not_in_catalog', confidence: 0.99, slots: {} }],
  },
  {
    // 故意返回不合规的槽位值，用于验证类型强制转换与拒绝
    match: (q) => /测试脏槽位/.test(q),
    intents: [
      {
        id: 'fin.reimburse_submit',
        confidence: 0.9,
        slots: { amount: '8600元', category: '不存在的类别' },
      },
    ],
  },
];

function buildIntentResponse(userText) {
  const hit = SCENARIOS.find((s) => s.match(userText));
  const list = hit ? (typeof hit.intents === 'function' ? hit.intents(userText) : hit.intents) : [];
  const payload = hit
    ? { intents: list.map((i) => ({ ...i, query: userText })), unmatched: Boolean(hit.unmatched) }
    : { intents: [], unmatched: true };

  return {
    id: 'chatcmpl-fake-intent',
    object: 'chat.completion',
    model: 'fake-glm',
    choices: [
      {
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_fake_1',
              type: 'function',
              function: { name: 'submit_intents', arguments: JSON.stringify(payload) },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 1200, completion_tokens: 90, total_tokens: 1290 },
  };
}

function buildComposeResponse(briefing) {
  // 模拟一个"看过 briefing 才能写出来"的回复：把关键事实抄进去，
  // 这样 smoke 测试可以断言模型确实拿到了工单号、风险结论与引用。
  const ticket = /已创建工单 (TK-[\d-]+)/.exec(briefing)?.[1];
  const approval = /已创建人工确认任务 (AP-[\d-]+)/.exec(briefing)?.[1];
  const gap = /待补充知识 (GAP-\d+)/.exec(briefing)?.[1];
  const noHit = /知识库没有命中任何制度依据/.test(briefing);
  const high = /风险判定（已由规则引擎确定，不可更改）：HIGH/.test(briefing);
  const clarifyMatch = /需要向员工追问这些信息|缺少必填信息：([^\n。]*)/.exec(briefing);
  const docTitle = /《([^》]+)》/.exec(briefing)?.[1];

  const parts = ['[FAKE-LLM]'];
  if (high) parts.push('这类操作我不能直接为你执行，已转人工确认。');
  if (clarifyMatch && /缺少必填信息/.test(briefing)) {
    parts.push(`还需要你补充：${clarifyMatch[1]}。补齐后我立刻提交。`);
  }
  if (noHit) {
    parts.push('我没有找到明确的制度依据，不方便给你一个可能出错的答案，已转人工跟进。');
  } else if (docTitle) {
    parts.push(`依据《${docTitle}》的规定处理。`);
  }
  if (ticket) parts.push(`已创建工单 ${ticket}。`);
  if (approval) parts.push(`人工确认任务 ${approval} 已生成。`);
  if (gap) parts.push(`已记录为待补充知识 ${gap}。`);

  return {
    id: 'chatcmpl-fake-compose',
    object: 'chat.completion',
    model: 'fake-glm',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: { role: 'assistant', content: parts.join(' ') },
      },
    ],
    usage: { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020 },
  };
}

/** 当前全局故障注入模式，可通过 POST /mode 在运行时切换（供自动化测试用） */
let currentMode = process.env.FAKE_MODE ?? 'ok';

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'fake-glm', object: 'model' }] }));
    return;
  }

  // 运行时切换故障模式：POST /mode {"mode":"429"}
  if (req.method === 'POST' && req.url === '/mode') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        const { mode } = JSON.parse(raw);
        currentMode = mode ?? 'ok';
        console.log(`[fake-llm] 故障模式切换为：${currentMode}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ mode: currentMode }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'bad json' } }));
      }
    });
    return;
  }

  if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
    return;
  }

  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const mode = req.headers['x-fake-mode'] ?? currentMode;

    if (mode === 'timeout') return; // 永不响应，触发客户端超时
    if (mode === '401' || mode === '429' || mode === '500') {
      res.writeHead(Number(mode), { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `fake ${mode}` } }));
      return;
    }
    if (mode === 'malformed') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('this-is-not-json');
      return;
    }
    if (mode === 'empty') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '' } }],
          usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
        }),
      );
      return;
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'bad request json' } }));
      return;
    }

    const isIntentCall = Array.isArray(body.tools) && body.tools.length > 0;
    const userMsg = [...(body.messages ?? [])].reverse().find((m) => m.role === 'user');
    const payload = isIntentCall
      ? buildIntentResponse(userMsg?.content ?? '')
      : buildComposeResponse(userMsg?.content ?? '');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
});

server.listen(PORT, () => {
  console.log(`[fake-llm] OpenAI 兼容假服务已启动：http://localhost:${PORT}`);
  console.log(`[fake-llm] 用法：LLM_BASE_URL=http://localhost:${PORT} LLM_API_KEY=fake LLM_MODEL=fake-glm AGENT_ENGINE=llm npm run dev`);
});
