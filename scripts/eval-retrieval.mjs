#!/usr/bin/env node
/**
 * 检索质量回归脚本。
 *
 * 用一组「问题 → 期望命中的文档」的样例，跑一遍检索，输出 Top1 命中率与逐条明细。
 * 调完 config/app.config.json 里的 retrieval 参数、或往 knowledge/ 里加了文档之后跑一次，
 * 就能知道是变好了还是变差了。
 *
 *   npm run dev            # 另开一个终端先起服务
 *   node scripts/eval-retrieval.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? 'http://localhost:3000';

/** expect = null 表示这条本来就应该「未命中」，用来守住未命中沉淀这条路径 */
const CASES = [
  { q: '出差去成都，住宿一晚最多能报多少钱', domain: 'FINANCE', expect: 'FIN-KB-001' },
  { q: '打车费能不能报销', domain: 'FINANCE', expect: 'FIN-KB-001' },
  { q: '公司开票信息是什么', domain: 'FINANCE', expect: 'FIN-KB-002' },
  { q: '预算外的付款要走什么审批', domain: 'FINANCE', expect: 'FIN-KB-003' },
  { q: '年假有多少天', domain: 'HR', expect: 'HR-KB-001' },
  { q: '婚假能休几天', domain: 'HR', expect: 'HR-KB-001' },
  { q: '社保怎么从上海转到杭州', domain: 'HR', expect: 'HR-KB-002' },
  { q: '公积金能提取吗', domain: 'HR', expect: 'HR-KB-002' },
  { q: '转正流程需要准备什么材料', domain: 'HR', expect: 'HR-KB-003' },
  { q: '离职要提前多久通知', domain: 'HR', expect: 'HR-KB-003' },
  { q: '发薪日是哪天', domain: 'HR', expect: 'HR-KB-004' },
  { q: 'OA 密码忘了怎么重置', domain: 'IT', expect: 'IT-KB-001' },
  { q: '账号被锁了怎么解锁', domain: 'IT', expect: 'IT-KB-001' },
  { q: 'VPN 权限怎么申请', domain: 'IT', expect: 'IT-KB-002' },
  { q: '生产数据库权限怎么申请', domain: 'IT', expect: 'IT-KB-003' },
  { q: '要批量导出客户名单', domain: 'IT', expect: 'IT-KB-003' },
  { q: '笔记本蓝屏了怎么报修', domain: 'IT', expect: 'IT-KB-004' },
  { q: '申请一个 IDEA 正版授权', domain: 'IT', expect: 'IT-KB-004' },
  { q: '工牌丢了怎么补办', domain: 'ADMIN', expect: 'ADM-KB-001' },
  { q: '会议室怎么预定', domain: 'ADMIN', expect: 'ADM-KB-002' },
  { q: '想领两包打印纸', domain: 'ADMIN', expect: 'ADM-KB-002' },
  { q: '下周去北京出差怎么订票', domain: 'ADMIN', expect: 'ADM-KB-003' },
  { q: '带样机去德国参展的清关手续怎么办', domain: null, expect: null },
  { q: '公司有没有员工持股计划', domain: null, expect: null },
  { q: '公司年会在哪个城市办', domain: null, expect: null },
  { q: '能不能帮我订一份下午茶', domain: null, expect: null },
  // 这条会命中报销制度文档（合理），但该文档里确实没有外币汇率章节，
  // 属于「命中了文档但答不了问题」的情况，由知识缺口 GAP-0004 跟进补写。
  { q: '外币报销的汇率按哪天算', domain: 'FINANCE', expect: 'FIN-KB-001' },
];

let hit = 0;
let expectedMissOk = 0;
let expectedMissTotal = 0;
const failures = [];

for (const c of CASES) {
  const url = new URL('/api/knowledge/search', BASE);
  url.searchParams.set('q', c.q);
  if (c.domain) url.searchParams.set('domain', c.domain);

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`请求失败 ${res.status}：${c.q}`);
    process.exitCode = 1;
    continue;
  }
  const body = await res.json();
  const top = body.data[0];

  if (c.expect === null) {
    expectedMissTotal += 1;
    const ok = body.data.length === 0;
    if (ok) expectedMissOk += 1;
    else failures.push(`应未命中但命中了：「${c.q}」→ ${top.docId}#${top.section} (${top.score})`);
    console.log(
      `${ok ? '✓' : '✗'} [应未命中] ${c.q}  → ${
        ok ? `未命中（原始最高分 ${body.meta.peekTopScore}）` : `${top.docId} ${top.score}`
      }`,
    );
    continue;
  }

  const ok = top?.docId === c.expect;
  if (ok) hit += 1;
  else failures.push(`Top1 错误：「${c.q}」期望 ${c.expect}，实际 ${top ? `${top.docId} (${top.score})` : '未命中'}`);
  console.log(
    `${ok ? '✓' : '✗'} ${c.q}  → ${top ? `${top.docId}#${top.section} ${top.score}` : '未命中'}  (期望 ${c.expect})`,
  );
}

const positive = CASES.filter((c) => c.expect !== null).length;
console.log('\n────────────────────────────────');
console.log(`Top1 命中率：${hit}/${positive} = ${((hit / positive) * 100).toFixed(1)}%`);
console.log(`未命中判定正确：${expectedMissOk}/${expectedMissTotal}`);
if (failures.length > 0) {
  console.log('\n未通过的样例：');
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
