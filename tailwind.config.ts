import type { Config } from 'tailwindcss';

/**
 * 配色采用「CSS 变量 + 语义 token」两层结构：
 * - 变量值定义在 src/app/globals.css 的 :root 里（唯一改色入口）
 * - 这里只做语义命名，组件里写 text-ink-muted / bg-surface-2 这种语义类，不写具体色号
 *
 * 好处：换整套配色（或以后加回暗色主题）只改 globals.css 的变量，组件一行都不用动。
 * 用 rgb(var(--x) / <alpha-value>) 的写法是为了让 bg-surface/60 这类透明度修饰符继续可用。
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        /** 页面底色 */
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        /** 卡片 / 面板底色 */
        surface: 'rgb(var(--surface) / <alpha-value>)',
        /** 次级填充：表头、按钮、标签底色 */
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        /** 分割线与边框 */
        line: 'rgb(var(--line) / <alpha-value>)',
        /** 文字四级层次：标题 → 正文 → 标签 → 元信息 */
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          soft: 'rgb(var(--ink-soft) / <alpha-value>)',
          muted: 'rgb(var(--ink-muted) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          soft: 'rgb(var(--brand-soft) / <alpha-value>)',
          /** 浅底上的品牌色文字（保证对比度达标） */
          ink: 'rgb(var(--brand-ink) / <alpha-value>)',
          /** 品牌色浅底 */
          wash: 'rgb(var(--brand-wash) / <alpha-value>)',
        },
        risk: {
          low: '#16a34a',
          medium: '#d97706',
          high: '#dc2626',
        },
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        raised: '0 4px 12px -2px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.06)',
      },
    },
  },
  plugins: [],
};

export default config;
