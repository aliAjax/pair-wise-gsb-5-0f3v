export type Dep = {
  id: string;
  productId: string;
  name: string;
  version: string;
  license: string;
  channel: string;
};

export type Product = {
  id: string;
  name: string;
  code: string;
  desc: string;
  allow: string[]; // 产品规则：直接放行的许可证
  deny: string[]; // 产品规则：一律阻断的许可证
  channelDeny: Record<string, string[]>; // 渠道级禁令：渠道 -> 禁止的许可证
};

export type Waiver = {
  id: string;
  productId: string;
  name: string;
  version: string;
  channel: string; // 放行只对该 名称+版本+渠道 生效，换渠道需重判
  approver: string; // 裁定人
  reason: string; // 依据
  createdAt: number;
  expiresAt: number; // 到期自动恢复阻断
};

export type Status = 'pass' | 'waived' | 'block';

export type Effective = {
  status: Status;
  decider: string;
  basis: string;
  waiver?: Waiver;
  expired?: Waiver;
};

export type Store = {
  products: Product[];
  deps: Dep[];
  waivers: Waiver[];
  pid: string;
};

export const STORE_KEY = 'license-lens-v2';

export const CHANNELS = ['npm 官方', '内部镜像', '手动引入', 'CDN'];

export const LICENSES = [
  'MIT',
  'Apache-2.0',
  'BSD-3-Clause',
  'ISC',
  'Python-2.0',
  'LGPL-3.0',
  'GPL-3.0',
  'AGPL-3.0',
  'SSPL-1.0',
  'CC-BY-SA-4.0',
  '未知',
];

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const DAY = 864e5;

/** 第一级：产品规则判定（不含任何豁免） */
export function ruleVerdict(p: Product, d: Dep): { status: 'pass' | 'block'; basis: string } {
  if (p.deny.includes(d.license)) return { status: 'block', basis: `产品规则禁止 ${d.license}` };
  const ch = p.channelDeny[d.channel] || [];
  if (ch.includes(d.license)) return { status: 'block', basis: `渠道规则：${d.channel} 禁止 ${d.license}` };
  if (p.allow.includes(d.license)) return { status: 'pass', basis: `产品规则允许 ${d.license}` };
  return { status: 'block', basis: `${d.license} 不在产品允许清单，需逐项限时放行` };
}

export function matchWaiver(w: Waiver, productId: string, d: Dep) {
  return w.productId === productId && w.name === d.name && w.version === d.version && w.channel === d.channel;
}

/** 当前有效结论 = 产品规则 + 未过期豁免；过期豁免自动失效并恢复阻断 */
export function effectiveOf(p: Product, d: Dep, waivers: Waiver[], now: number): Effective {
  const v = ruleVerdict(p, d);
  if (v.status === 'pass') return { status: 'pass', decider: '产品规则', basis: v.basis };
  const w = waivers.find((w) => matchWaiver(w, p.id, d));
  if (w && w.expiresAt > now) return { status: 'waived', decider: w.approver, basis: w.reason, waiver: w };
  if (w)
    return {
      status: 'block',
      decider: '产品规则',
      basis: `${v.basis}；限时放行已于 ${fmtTime(w.expiresAt)} 到期，恢复阻断`,
      expired: w,
    };
  return { status: 'block', decider: '产品规则', basis: v.basis };
}

export function fmtTime(t: number) {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtRemain(exp: number, now: number) {
  const ms = exp - now;
  if (ms <= 0) return '已到期';
  const h = Math.floor(ms / 3.6e6);
  const m = Math.ceil((ms % 3.6e6) / 6e4);
  if (h >= 24) return `${Math.floor(h / 24)} 天 ${h % 24} 小时`;
  return `${h} 小时 ${m} 分`;
}

export const parseList = (t: string) =>
  t
    .split(/[,，、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** 从清单文本识别 名称/版本/许可证/渠道：支持 JSON 数组、`name@version 许可证 渠道`、逗号分隔 */
export function parseManifest(text: string): Omit<Dep, 'id' | 'productId'>[] {
  const t = text.trim();
  if (!t) return [];
  try {
    const j = JSON.parse(t);
    if (Array.isArray(j))
      return j
        .map((o) => ({
          name: String(o.name ?? '').trim(),
          version: String(o.version ?? '1.0.0').trim(),
          license: String(o.license ?? '未知').trim(),
          channel: String(o.channel ?? 'npm 官方').trim(),
        }))
        .filter((o) => o.name);
  } catch {
    /* fall through to line parsing */
  }
  return t
    .split(/\n+/)
    .map((line) => {
      if (line.includes(',')) {
        const parts = line.split(',').map((s) => s.trim());
        let [n, v, l, c] = parts;
        if (n && n.includes('@') && !v) {
          const i = n.lastIndexOf('@');
          v = n.slice(i + 1);
          n = n.slice(0, i);
        }
        return { name: n || '', version: v || '1.0.0', license: l || '未知', channel: c || 'npm 官方' };
      }
      // 空格分隔：name[@version] 许可证 渠道（渠道可含空格，如 "npm 官方"）
      const parts = line.split(/\s+/).filter(Boolean);
      let n = parts.shift() || '';
      let v = '';
      const i = n.lastIndexOf('@');
      if (i > 0) {
        v = n.slice(i + 1);
        n = n.slice(0, i);
      }
      if (!v) v = parts.shift() || '';
      const l = parts.shift() || '';
      return { name: n, version: v || '1.0.0', license: l || '未知', channel: parts.join(' ') || 'npm 官方' };
    })
    .filter((d) => d.name);
}

/** 导出报告：只列当前有效结论（过期豁免按阻断呈现），含裁定人与依据 */
export function buildReport(p: Product, deps: Dep[], waivers: Waiver[], now: number): string {
  const rows = deps.map((d) => ({ d, e: effectiveOf(p, d, waivers, now) }));
  const blocks = rows.filter((r) => r.e.status === 'block');
  const label = (e: Effective) =>
    e.status === 'pass' ? '通过' : e.status === 'waived' ? `限时放行（至 ${fmtTime(e.waiver!.expiresAt)}）` : '阻断';
  return [
    `# ${p.name} · 许可证审查报告`,
    '',
    `- 生成时间：${fmtTime(now)}`,
    `- 产品规则：允许 ${p.allow.join('、') || '（空）'}；禁止 ${p.deny.join('、') || '（空）'}`,
    ...Object.entries(p.channelDeny)
      .filter(([, v]) => v.length)
      .map(([k, v]) => `- 渠道规则：${k} 禁止 ${v.join('、')}`),
    '',
    blocks.length
      ? `> ⚠️ 尚有 ${blocks.length} 项阻断未清，本报告仅列当前有效结论。`
      : `> ✅ 全部依赖均有当前有效结论。`,
    '',
    '| 依赖 | 版本 | 渠道 | 许可证 | 有效结论 | 裁定人 | 依据 |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(({ d, e }) => `| ${d.name} | ${d.version} | ${d.channel} | ${d.license} | ${label(e)} | ${e.decider} | ${e.basis} |`),
    '',
  ].join('\n');
}

export function loadStore(): Store {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || '');
    if (s && Array.isArray(s.products) && s.products.length) return s;
  } catch {
    /* corrupted storage -> reseed */
  }
  return seedStore();
}

export function seedStore(): Store {
  const now = Date.now();
  const products: Product[] = [
    {
      id: 'aurora',
      name: 'Aurora Web',
      code: 'AURORA-WEB',
      desc: '面向公网的前端发布渠道',
      allow: ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC'],
      deny: ['GPL-3.0', 'AGPL-3.0', 'SSPL-1.0'],
      channelDeny: { CDN: ['BSD-3-Clause', 'CC-BY-SA-4.0'], 手动引入: ['LGPL-3.0'] },
    },
    {
      id: 'data-api',
      name: 'Data API',
      code: 'DATA-API',
      desc: '服务端接口，内部署不对外分发',
      allow: ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC', 'Python-2.0'],
      deny: ['GPL-3.0', 'AGPL-3.0', 'SSPL-1.0', 'LGPL-3.0'],
      channelDeny: {},
    },
    {
      id: 'desktop',
      name: 'Desktop Client',
      code: 'DESKTOP-CLIENT',
      desc: '闭源分发的桌面安装包',
      allow: ['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC'],
      deny: ['GPL-3.0', 'AGPL-3.0', 'LGPL-3.0', 'SSPL-1.0', 'CC-BY-SA-4.0'],
      channelDeny: {},
    },
  ];
  const dep = (
    productId: string,
    name: string,
    version: string,
    license: string,
    channel: string,
  ): Dep => ({ id: uid(), productId, name, version, license, channel });
  const deps: Dep[] = [
    dep('aurora', 'react', '18.3.1', 'MIT', 'npm 官方'),
    dep('aurora', 'lodash', '4.17.21', 'MIT', 'npm 官方'),
    dep('aurora', 'chart.js', '4.4.4', 'MIT', '内部镜像'),
    dep('aurora', 'highlight.js', '11.10.0', 'BSD-3-Clause', 'npm 官方'),
    dep('aurora', 'highlight.js', '11.10.0', 'BSD-3-Clause', 'CDN'),
    dep('aurora', 'legacy-parser', '2.1.0', 'GPL-3.0', '手动引入'),
    dep('aurora', 'old-template', '1.4.0', 'GPL-3.0', 'npm 官方'),
    dep('data-api', 'express', '4.19.2', 'MIT', 'npm 官方'),
    dep('data-api', 'pymongo', '4.8.0', 'Apache-2.0', '内部镜像'),
    dep('data-api', 'redis-client', '5.0.0', 'MIT', 'npm 官方'),
    dep('data-api', 'mongo-driver', '2.6.0', 'SSPL-1.0', '内部镜像'),
    dep('desktop', 'electron', '31.0.0', 'MIT', 'npm 官方'),
    dep('desktop', 'sqlite-binding', '5.1.7', 'BSD-3-Clause', '内部镜像'),
    dep('desktop', 'video-codec', '3.2.1', 'LGPL-3.0', '手动引入'),
    dep('desktop', 'updater', '1.9.0', 'CC-BY-SA-4.0', 'CDN'),
  ];
  const waivers: Waiver[] = [
    {
      id: uid(),
      productId: 'aurora',
      name: 'legacy-parser',
      version: '2.1.0',
      channel: '手动引入',
      approver: '王岚（安全团队）',
      reason: '仅用于内部构建脚本，不随产品分发，发版前移除',
      createdAt: now - 2 * DAY,
      expiresAt: now + 3 * DAY,
    },
    {
      id: uid(),
      productId: 'aurora',
      name: 'old-template',
      version: '1.4.0',
      channel: 'npm 官方',
      approver: '王岚（安全团队）',
      reason: '临时兼容旧页面，限期替换',
      createdAt: now - 8 * DAY,
      expiresAt: now - DAY, // 已过期：演示到期自动恢复阻断
    },
  ];
  return { products, deps, waivers, pid: 'aurora' };
}
