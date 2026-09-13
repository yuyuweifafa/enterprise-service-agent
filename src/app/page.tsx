import Link from 'next/link';

const navItems = [
  { label: '关于我', href: '#about' },
  { label: '关键项目', href: '#self-intro' },
  { label: '教育背景', href: '#education' },
  { label: '工作经历', href: '#experience' },
  { label: '技能与爱好', href: '#skills' },
  { label: '联系我', href: '#contact' },
];

const heroTags = ['AI 产品经理', '解决方案产品', 'Agent 落地', 'B 端流程'];
const resumeHref = '/resume-yuyuwei.pdf';
const profileImage = '/profile-yuyuwei.jpg';
const researchArticleHref =
  'https://faj7xbxldsp.feishu.cn/wiki/Ywmfw7o6RiOjEdk6kd6cQw2LnOh?from=from_copylink';
const solutionPdfHref = '/xilingol-meat-digital-platform-solution.pdf';

const capabilityStories = [
  {
    index: '01',
    statement: 'AI 产品方案与服务闭环',
    intro:
      '把员工一句话诉求拆成意图识别、知识库回答、工具调用和人工兜底，让 AI 真正进入可运营的服务流程。',
    proofs: [
      {
        title: '企业级员工个人助理 Demo',
        desc: '独立搭建企业内部 AI 助理 Demo，收敛为闲聊陪伴、知识库问答、客户评审准备、IT / 行政转人工 4 类能力。重点验证 Agent 如何识别意图、调用 mock 能力、接入人工会话，并把人工处理口径沉淀回知识库。',
        href: '/chat',
        cta: '打开企业 AI 工作助理',
        external: true,
        githubHref: 'https://github.com/yuyuweifafa/enterprise-service-agent',
      },
    ],
    imageTitle: 'AI 服务流程',
    imageHint: '从员工目标到 AI 回答、工具调用、人工接入和知识沉淀。',
    insightImages: [
      {
        src: '/employee-ai-assistant-home.png',
        alt: '企业 AI 工作助理员工端首页截图',
        label: 'AI ASSISTANT DEMO',
        title: '企业级员工个人助理',
      },
    ],
  },
  {
    index: '02',
    statement: '业务理解与流程设计',
    intro:
      '在真实业务里拆供需、拆流程、拆角色协同，把复杂履约问题抽象成可管理、可度量的产品机制。',
    proofs: [
      {
        title: '作业帮 1V1 资源调度',
        desc: '面对试听课排课黄金时段拥堵、闲时资源空转的问题，我把教师非标时间抽象成“红绿灯库存”，设计“锁时段不锁人”的预约机制，并推动销售侧、教师侧和中台流程协同调整，最终排课成功率从 60% 提升到 80%，教师空转率降低 20%。',
      },
      {
        title: 'LingoAce 教师 App & 教管排班设置',
        desc: '从 0 到 1 完成教师 App 的需求调研、产品设计、UI 设计和上线推进；在产研资源不足时，自闭环完成生产级教管排班设置前后端页面，并走完整上线流程。',
      },
    ],
    imageTitle: '业务提效项目',
    imageHint: '资源调度与教师服务 App 截图。',
    images: [
      { src: '/resource-heatmap.png', alt: '试听课资源热力图' },
      { src: '/teacher-app-time.png', alt: '教师 App 时间管理截图' },
    ],
  },
  {
    index: '03',
    statement: '客户方案与行业表达',
    intro:
      '能把行业判断、客户场景、平台能力和交付价值组织成可沟通、可汇报、可推进的解决方案。',
    proofs: [
      {
        title: 'AI 流程改造行业研究',
        desc: '我认为 AI 流程改造不是做一个 Agent，而是重新设计一条业务闭环。真正的价值要落到流程是否跑通，以及人效、周期、满意度、投诉率或 GMV 是否发生变化。',
        href: researchArticleHref,
        cta: '阅读全文',
        external: true,
      },
      {
        title: '锡林郭勒盟肉类数产融合服务平台解决方案',
        desc: '在鑫创数科期间，我参与撰写面向客户的产业数字化解决方案，把客户场景、平台能力、业务流程和交付价值组织成可沟通、可汇报、可推进的方案文本。',
        href: solutionPdfHref,
        cta: '查看方案',
      },
    ],
    imageTitle: '方案与研究',
    imageHint: '行业研究框架与客户解决方案。',
    insightImages: [
      {
        src: '/ai-flow-preview.png',
        alt: 'AI 服务流程分流白板图',
        label: 'AI RESEARCH',
        title: '从 Agent 到业务闭环',
      },
      {
        src: '/solution-platform-preview.png',
        alt: '锡林郭勒盟肉类数产融合服务平台方案架构图',
        label: 'SOLUTION',
        title: '从产业链到平台方案',
      },
    ],
  },
  {
    index: '04',
    statement: '内容表达与用户感知',
    intro:
      '关注产品、观点和内容如何被用户理解、记住和愿意继续看下去，长期训练文案、视觉呈现和用户兴趣判断。',
    proofs: [
      {
        title: '小红书美食账号',
        desc: '个人运营小红书美食博主账号，目前累计 5000 粉。这个经历让我长期练习选题、标题、文案、内容节奏和用户反馈判断，也补足了产品经理在表达和营销侧的能力。',
      },
    ],
    imageTitle: '账号配图占位',
    imageHint: '可放小红书主页、内容数据或代表笔记截图。',
    xhsImage: { src: '/xiaohongshu-profile.jpg', alt: '小红书账号主页截图' },
  },
];

const education = [
  {
    time: '2023.09 - 2025.07',
    degree: '工商管理 / 硕士研究生',
    school: '北京邮电大学',
    note: '关注企业经营、组织协同与数字化转型中的产品化机会。',
    image: '/bupt-campus.jpg',
  },
  {
    time: '2014.09 - 2018.07',
    degree: '通信工程 / 本科',
    school: '商丘师范学院',
    note: '工程背景帮助我更快理解系统边界、数据流和技术协作方式。',
    image: '/shangqiu-normal-university.jpg',
  },
];

const timeline = [
  {
    time: '2026.03 - 至今',
    company: 'LingoAce',
    role: '产品经理',
    desc: '负责教师管理及教师服务相关产品建设，重点围绕服务效率、业务自动化及 AI 应用落地开展产品工作。',
  },
  {
    time: '2024.01 - 2025.08',
    company: '作业帮',
    role: '业务产品经理',
    desc: '负责 1V1 业务履约中台建设，围绕课程、收款、订单、排课、履约等关键功能推动流程标准化和线上闭环。',
  },
  {
    time: '2021.04 - 2022.04',
    company: '百度',
    role: '产品运营',
    desc: '主导内部一站式员工服务台 0-1 建设，梳理 30+ 类 IT 服务目录，并推动软件资产管理和成本优化。',
  },
  {
    time: '2019.06 - 2023.08',
    company: '伟东云教育 / 鑫创数科',
    role: '产品运营 / 产品经理',
    desc: '参与智慧校园、精准教学、央国企数字化转型等项目，积累教育科技与解决方案经验。',
  },
];

const skillGroups = [
  {
    title: 'AI 产品',
    items: ['AI Agent', 'RAG 知识库', 'Skills', 'MCP 工具调用', 'Prompt', '人机协同'],
  },
  {
    title: 'B 端产品',
    items: ['流程标准化', '中台建设', '工单体系', '履约闭环', '权限边界', '业财一致性'],
  },
  {
    title: '业务能力',
    items: ['成本优化', '资源调度', '服务效率', '供需匹配', '指标设计', '上线推进'],
  },
];

export default function PortfolioPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#fbfcff] text-[#20242c]">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[linear-gradient(125deg,rgba(255,255,255,0.98)_0%,rgba(240,249,255,0.84)_30%,rgba(250,244,255,0.78)_58%,rgba(255,252,236,0.72)_78%,rgba(241,255,251,0.86)_100%)]" />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-45 [background-image:linear-gradient(rgba(226,232,240,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(226,232,240,0.36)_1px,transparent_1px)] [background-size:56px_56px]" />

      <nav className="sticky top-5 z-30 mx-auto flex w-[min(1120px,calc(100%-32px))] items-center justify-between rounded-2xl border border-white/80 bg-white/82 px-4 py-3 shadow-[0_20px_70px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <Link href="#about" className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-[#20242c] text-sm font-semibold text-white">
            YY
          </span>
          <span className="text-sm font-semibold tracking-[0.22em]">PORTFOLIO</span>
        </Link>
        <div className="hidden items-center gap-1 lg:flex">
          {navItems.map((item, index) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-full px-4 py-2 text-xs font-medium transition ${
                index === 0 ? 'bg-[#20242c] text-white shadow-sm' : 'text-[#5f6675] hover:bg-white/90 hover:text-[#20242c]'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <a
          href={resumeHref}
          download
          className="rounded-2xl bg-[#20242c] px-5 py-3 text-sm font-semibold text-white shadow-[0_14px_34px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:bg-[#111827]"
        >
          下载简历
        </a>
      </nav>

      <section id="about" className="mx-auto grid min-h-[calc(100vh-92px)] w-[min(1120px,calc(100%-32px))] items-center gap-10 py-12 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/72 px-4 py-2 text-sm text-[#5f6675] shadow-sm backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-[#61d2aa]" />
            HELLO / 你好
          </div>
          <h1 className="mt-8 text-[64px] font-black leading-[0.95] tracking-[-0.02em] text-[#20242c] sm:text-[86px] lg:text-[104px]">
            Hi,
            <br />
            我是禹钰炜
          </h1>
          <p className="mt-6 text-2xl font-semibold text-[#7e5dd5] md:text-3xl">AI 解决方案产品经理 / AI 产品经理</p>
          <div className="mt-7 max-w-2xl rounded-2xl border border-white/80 bg-white/72 px-5 py-4 text-sm leading-7 text-[#4f5867] shadow-sm backdrop-blur">
            擅长把复杂业务流程拆清楚，设计 AI Agent、知识库、工具调用和人工协同的服务闭环，并用可体验 Demo 验证方案可行性。
          </div>
          <div className="mt-7 flex flex-wrap gap-2">
            {heroTags.map((tag) => (
              <span key={tag} className="rounded-xl border border-white/80 bg-white/78 px-4 py-2 text-sm font-medium text-[#4f5867] shadow-sm">
                {tag}
              </span>
            ))}
          </div>
          <div className="mt-9 flex flex-wrap gap-4">
            <Link href="#self-intro" className="rounded-2xl bg-[#20242c] px-7 py-4 text-sm font-semibold text-white shadow-[0_18px_35px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5">
              查看关键项目
            </Link>
            <Link href="#contact" className="rounded-2xl border border-white/90 bg-white/82 px-7 py-4 text-sm font-semibold text-[#4f5867] shadow-sm transition hover:bg-white">
              联系我
            </Link>
          </div>
        </div>

        <div className="relative min-h-[560px]">
          <div className="absolute inset-x-4 top-2 h-[500px] rounded-[56px] border border-white/70 bg-[linear-gradient(135deg,rgba(224,247,250,0.64),rgba(248,239,255,0.7)_48%,rgba(255,247,214,0.58))] shadow-[0_30px_100px_rgba(15,23,42,0.08)]" />
          <div className="absolute left-16 top-24 h-[390px] w-[320px] rotate-3 rounded-[40px] border border-white/80 bg-white/48 shadow-[0_30px_90px_rgba(15,23,42,0.1)] backdrop-blur-xl" />
          <div className="absolute left-24 top-5 h-[460px] w-[330px] overflow-hidden rounded-[44px] border border-white/90 bg-white/86 shadow-[0_30px_100px_rgba(15,23,42,0.14)]">
            <img
              src={profileImage}
              alt="禹钰炜个人照片"
              className="h-full w-full object-cover object-[center_42%]"
            />
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(36,33,29,0.16))]" />
          </div>
          <div className="absolute right-6 top-80 w-44 rounded-3xl border border-white/80 bg-white/78 p-5 shadow-[0_18px_45px_rgba(15,23,42,0.1)] backdrop-blur">
            <p className="text-xs font-semibold tracking-[0.18em] text-[#8a7a54]">NOW</p>
            <p className="mt-2 text-lg font-bold text-[#20242c]">AI × 流程改造</p>
            <p className="mt-2 text-xs leading-5 text-[#5f6675]">正在把复杂业务拆成可落地的 AI 产品。</p>
          </div>
          <div className="absolute bottom-8 left-0 rounded-full border border-white/80 bg-white/78 px-5 py-3 text-sm font-medium text-[#5f6675] shadow-sm backdrop-blur">
            继续下滑，探索更多
          </div>
        </div>
      </section>

      <section id="self-intro" className="mx-auto w-[min(1120px,calc(100%-32px))] py-16">
        <div>
          <p className="text-sm font-semibold tracking-[0.22em] text-[#7b8494]">01 / SELECTED WORK</p>
          <h2 className="mt-4 text-5xl font-semibold tracking-[-0.02em] text-[#20242c]">从问题到结果</h2>
          <p className="mt-5 max-w-3xl text-sm leading-7 text-[#5f6675]">
            围绕“AI 解决方案产品经理 / AI 产品经理”这条主线，下面这些项目分别证明我的 AI 产品方案、业务流程设计、客户方案表达和内容感知能力。
          </p>
        </div>
        <div className="mt-10 space-y-7">
          {capabilityStories.map((story) => (
            <article
              key={story.statement}
              className="grid gap-6 rounded-[34px] border border-white/85 bg-white/78 p-6 shadow-[0_25px_85px_rgba(15,23,42,0.08)] backdrop-blur-xl lg:grid-cols-[0.9fr_1.1fr]"
            >
              <div className="flex min-h-72 flex-col justify-between rounded-[26px] border border-white/90 bg-[linear-gradient(135deg,rgba(255,255,255,0.9),rgba(224,247,250,0.5),rgba(249,244,255,0.58))] p-7">
                <div>
                  <span className="rounded-2xl bg-[#20242c] px-4 py-2 text-sm font-semibold text-white">{story.index}</span>
                  <h3 className="mt-8 text-3xl font-semibold leading-tight text-[#20242c]">{story.statement}</h3>
                  <p className="mt-4 text-sm leading-7 text-[#5f6675]">{story.intro}</p>
                </div>
                {'insightImages' in story && story.insightImages ? (
                  <div className="mt-8 space-y-3 rounded-[24px] border border-white/85 bg-[linear-gradient(135deg,rgba(229,240,255,0.95),rgba(255,255,255,0.84),rgba(232,249,242,0.68))] p-3 shadow-sm">
                    {story.insightImages.map((image, imageIndex) => (
                      <div key={image.src} className="relative h-40 overflow-hidden rounded-[20px] bg-white shadow-sm">
                        <img
                          src={image.src}
                          alt={image.alt}
                          className={`absolute inset-0 h-full w-full object-cover ${
                            imageIndex === 0 ? 'object-[center_42%]' : 'scale-[1.04] object-top'
                          }`}
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,rgba(255,255,255,0),rgba(255,255,255,0.95)_40%,rgba(255,255,255,0.98))] px-4 pb-3 pt-12">
                          <p className="text-xs font-semibold tracking-[0.16em] text-[#4b72d9]">{image.label}</p>
                          <p className="mt-1 text-base font-semibold text-[#20242c]">{image.title}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : 'xhsImage' in story && story.xhsImage ? (
                  <div className="mt-8 overflow-hidden rounded-[24px] border border-white/85 bg-[linear-gradient(135deg,rgba(255,49,88,0.16),rgba(255,255,255,0.82),rgba(204,245,241,0.45))] p-3 shadow-sm">
                    <div className="relative h-72 overflow-hidden rounded-[20px] bg-[#15151a]">
                      <img
                        src={story.xhsImage.src}
                        alt={story.xhsImage.alt}
                        className="absolute inset-0 h-full w-full scale-[1.38] object-cover object-[center_24%] saturate-[1.08]"
                      />
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(21,21,26,0.04),rgba(21,21,26,0.08)_48%,rgba(255,255,255,0.92))]" />
                      <div className="absolute bottom-3 left-3 right-3 rounded-2xl border border-white/65 bg-white/88 px-4 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.16)] backdrop-blur">
                        <p className="text-xs font-semibold tracking-[0.18em] text-[#ff3158]">XIAOHONGSHU</p>
                        <p className="mt-1 text-lg font-semibold text-[#20242c]">5000 粉美食账号</p>
                        <p className="mt-1 text-xs leading-5 text-[#5f6675]">内容选题、标题文案与用户反馈的长期训练场。</p>
                      </div>
                    </div>
                  </div>
                ) : 'images' in story && story.images ? (
                  <div className="mt-8 grid grid-cols-2 gap-3">
                    {story.images.map((image) => (
                      <div
                        key={image.src}
                        className="overflow-hidden rounded-[22px] border border-white/85 bg-[#f5f7ff] p-2 shadow-sm"
                      >
                        <img
                          src={image.src}
                          alt={image.alt}
                          className="h-72 w-full object-cover object-top"
                        />
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-col justify-center gap-4 p-1 lg:p-4">
                {story.proofs.map((proof) => (
                  <div key={proof.title} className="rounded-2xl border border-white/85 bg-white/82 px-5 py-5">
                    <h4 className="text-xl font-semibold text-[#20242c]">{proof.title}</h4>
                    <p className="mt-3 text-sm leading-7 text-[#4f5867]">{proof.desc}</p>
                    {'href' in proof && proof.href ? (
                      <div className="mt-5 flex flex-wrap gap-3">
                        <a
                          href={proof.href}
                          target={'external' in proof && proof.external ? '_blank' : undefined}
                          rel={'external' in proof && proof.external ? 'noreferrer' : undefined}
                          className="inline-flex items-center gap-2 rounded-2xl bg-[#20242c] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5"
                        >
                          {proof.cta}
                          <span aria-hidden>→</span>
                        </a>
                        {'githubHref' in proof && proof.githubHref ? (
                          <a
                            href={proof.githubHref}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-2 rounded-2xl border border-[#d8deea] bg-white px-5 py-3 text-sm font-semibold text-[#20242c] transition hover:-translate-y-0.5 hover:border-[#20242c]"
                          >
                            GitHub 源码
                            <span aria-hidden>→</span>
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="education" className="mx-auto w-[min(1120px,calc(100%-32px))] py-16">
        <div className="text-center">
          <p className="text-sm font-semibold tracking-[0.22em] text-[#7b8494]">02 / LEARNING PATH</p>
          <h2 className="mt-4 text-5xl font-semibold tracking-[-0.02em] text-[#20242c]">我的学习坐标</h2>
        </div>
        <div className="mt-12 grid gap-6 rounded-[38px] border border-white/85 bg-white/72 p-6 shadow-[0_30px_100px_rgba(15,23,42,0.08)] backdrop-blur-xl md:grid-cols-2">
          {education.map((item) => (
            <article key={item.school} className="min-h-80 rounded-[28px] border border-white/90 bg-white/86 p-8 shadow-sm">
              {item.image ? (
                <img
                  src={item.image}
                  alt={item.school}
                  className="h-44 w-full rounded-3xl object-cover object-center"
                />
              ) : (
                <div className="h-44 rounded-3xl bg-[linear-gradient(135deg,rgba(126,93,213,0.18),rgba(97,210,170,0.22),rgba(249,213,109,0.2))]" />
              )}
              <p className="mt-8 text-sm font-semibold text-[#8a7a54]">{item.time}</p>
              <p className="mt-2 text-sm text-[#5f6675]">{item.degree}</p>
              <h3 className="mt-4 text-3xl font-semibold text-[#20242c]">{item.school}</h3>
              <p className="mt-5 text-sm leading-7 text-[#5f6675]">{item.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="experience" className="mx-auto w-[min(1120px,calc(100%-32px))] py-16">
        <div className="text-center">
          <p className="text-sm font-semibold tracking-[0.22em] text-[#7b8494]">03 / THE PRACTITIONER</p>
          <h2 className="mt-4 text-5xl font-semibold tracking-[-0.02em] text-[#20242c]">我在真实现场做过什么</h2>
          <p className="mx-auto mt-5 max-w-2xl text-sm leading-7 text-[#5f6675]">
            不是只做原型和功能点，而是在教育、企业服务和内部管理场景中，把复杂流程拆成系统可以承接、业务可以运营的产品闭环。
          </p>
        </div>
        <div className="relative mt-12 grid gap-6 md:grid-cols-2">
          {timeline.map((item, index) => (
            <article
              key={`${item.company}-${item.time}`}
              className={`rounded-[26px] border border-white/90 bg-white/82 p-7 shadow-[0_18px_55px_rgba(15,23,42,0.07)] backdrop-blur ${
                index % 2 === 1 ? 'md:translate-y-14' : ''
              }`}
            >
              <p className="text-sm font-semibold text-[#65a995]">{item.time}</p>
              <h3 className="mt-3 text-2xl font-semibold text-[#20242c]">{item.company}</h3>
              <p className="mt-1 text-sm font-medium text-[#7e5dd5]">{item.role}</p>
              <p className="mt-5 text-sm leading-7 text-[#5f6675]">{item.desc}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="skills" className="mx-auto w-[min(1120px,calc(100%-32px))] py-16">
        <div className="text-center">
          <p className="text-sm font-semibold tracking-[0.22em] text-[#7b8494]">04 / SKILLS</p>
          <h2 className="mt-4 text-5xl font-semibold tracking-[-0.02em] text-[#20242c]">技能与关注方向</h2>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {skillGroups.map((group) => (
            <article key={group.title} className="rounded-[28px] border border-white/90 bg-white/82 p-6 shadow-[0_18px_55px_rgba(15,23,42,0.07)] backdrop-blur">
              <h3 className="text-xl font-semibold text-[#20242c]">{group.title}</h3>
              <div className="mt-5 flex flex-wrap gap-2">
                {group.items.map((item) => (
                  <span key={item} className="rounded-xl bg-white/90 px-3 py-2 text-xs font-medium text-[#4f5867] shadow-sm">
                    {item}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="contact" className="mx-auto w-[min(1120px,calc(100%-32px))] py-16 pb-24">
        <div className="grid gap-7 rounded-[34px] border border-white/90 bg-[linear-gradient(135deg,rgba(255,255,255,0.9),rgba(232,248,255,0.62),rgba(253,246,255,0.66))] p-8 text-[#20242c] shadow-[0_25px_85px_rgba(15,23,42,0.09)] backdrop-blur-xl md:grid-cols-[1.2fr_0.8fr] md:p-10">
          <div>
            <p className="text-sm font-semibold tracking-[0.22em] text-[#7b8494]">CONTACT</p>
            <h2 className="mt-4 text-4xl font-semibold leading-tight">期待聊聊 AI 解决方案产品、Agent 落地和 B 端流程改造。</h2>
            <p className="mt-5 text-sm leading-7 text-[#5f6675]">意向城市：北京 / 意向岗位：AI 解决方案产品经理、AI 产品经理</p>
          </div>
          <div className="space-y-3 text-sm">
            <a className="block rounded-2xl border border-white/85 bg-white/76 px-5 py-4 text-[#4f5867] shadow-sm transition hover:bg-white" href="mailto:vivianyu_1996@foxmail.com">
              vivianyu_1996@foxmail.com
            </a>
            <a className="block rounded-2xl border border-white/85 bg-white/76 px-5 py-4 text-[#4f5867] shadow-sm transition hover:bg-white" href="tel:15038090738">
              15038090738
            </a>
            <a className="block rounded-2xl border border-white/85 bg-white/76 px-5 py-4 text-[#4f5867] shadow-sm transition hover:bg-white" href="https://github.com/yuyuweifafa/enterprise-service-agent">
              GitHub / enterprise-service-agent
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
