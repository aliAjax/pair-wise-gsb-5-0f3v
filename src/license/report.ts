import { effectiveFor, isBlocking, itemFingerprint } from './engine';
import { CHANNELS, PRODUCTS } from './rules';
import type { ChannelId, Exemption, Item } from './types';

export function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** YYYY-MM-DD HH:mm（本地时间，审查台与报告口径一致） */
export function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const KIND_TEXT: Record<string, string> = {
  allow: '规则放行',
  block: '规则阻断',
  review: '需人工裁定（阻断中）',
  exempt: '限时放行（已豁免）',
};

/** 剩余时间，如「剩余 1 天 3 小时」「已过期」 */
export function remainingLabel(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (ms <= 0) return '已到期';
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `剩余 ${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `剩余 ${hours} 小时`;
  const days = Math.floor(hours / 24);
  return `剩余 ${days} 天`;
}

export interface ReportData {
  productId: string;
  items: Item[];
  exemptions: Exemption[];
  now: number;
}

/**
 * 导出当前审查结论。
 * 阻断项未清完时也可以导出，但报告：
 * 1) 只列「当前有效结论」——已到期 / 已撤销 / 指纹不符（换渠道等）的旧放行不会出现，条目回落为规则结论；
 * 2) 每条都带裁定人与依据；
 * 3) 报告头注明阻断项数量与发布门禁状态。
 */
export function buildReport({ productId, items, exemptions, now }: ReportData): string {
  const product = PRODUCTS.find((p) => p.id === productId);
  const eff = items.map((item) => ({ item, eff: effectiveFor(item, exemptions, now) }));
  const blockers = eff.filter(({ eff: e }) => isBlocking(e.kind));
  const passCount = eff.filter(({ eff: e }) => !isBlocking(e.kind)).length;
  const releaseReady = blockers.length === 0;

  const lines: string[] = [];
  lines.push(`# 产品许可证审查报告 · ${product?.name ?? productId}`);
  lines.push('');
  lines.push(`- 产品编号：${product?.code ?? productId}`);
  lines.push(`- 生成时间：${formatTime(now)}`);
  lines.push(`- 清单条目：${items.length} 项；当前可放行 ${passCount} 项；阻断中 ${blockers.length} 项`);
  lines.push(`- 发布门禁：**${releaseReady ? '✅ 阻断项已清零，可进入发布流程' : `⛔ 仍有 ${blockers.length} 个阻断项未清完，禁止发版`}**`);
  lines.push('');
  lines.push(`> 口径：产品规则优先于基线规则；限时放行仅在有效期内且名称/版本/许可证/渠道四者未变时有效。`);
  lines.push(`> 到期、撤销或任一维度变化（含同一版本更换发布渠道）后自动回落为规则结论，须重新裁定。`);
  lines.push('');

  const channelLabel = (ch: ChannelId) => CHANNELS[ch].label;

  // 阻断项在前，便于安全团队优先处理；其余按当前结论分组
  const groups: { title: string; rows: typeof eff }[] = [
    { title: '一、阻断项（未清完）', rows: blockers },
    { title: '二、限时放行（当前有效）', rows: eff.filter(({ eff: e }) => e.kind === 'exempt') },
    { title: '三、规则放行（当前有效）', rows: eff.filter(({ eff: e }) => e.kind === 'allow') },
  ];

  for (const group of groups) {
    lines.push(`## ${group.title}`);
    if (group.rows.length === 0) {
      lines.push('');
      lines.push('_无_');
      lines.push('');
      continue;
    }
    lines.push('');
    lines.push('| 依赖 | 版本 | 许可证 | 渠道 | 当前结论 | 裁定人 | 依据 | 放行有效期 |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const { item, eff: e } of group.rows) {
      let adjudicator: string;
      let basis: string;
      let validUntil: string;
      if (e.kind === 'exempt' && e.active) {
        adjudicator = e.active.approver;
        basis = `[${e.rule.ruleId}] ${e.rule.basis}；豁免理由：${e.active.reason}`;
        validUntil = `${formatTime(e.active.grantedAt)} ～ ${formatTime(e.active.expiresAt)}（${remainingLabel(e.active.expiresAt, now)}）`;
      } else {
        adjudicator = '规则引擎（自动裁定）';
        basis = `[${e.rule.ruleId}${e.rule.source === 'product' ? ' · 产品规则' : e.rule.source === 'baseline' ? ' · 基线规则' : ' · 默认'}] ${e.rule.basis}`;
        validUntil = '—';
      }
      lines.push(
        `| ${item.name} | ${item.version} | ${item.license} | ${channelLabel(item.channel)} | ${KIND_TEXT[e.kind]} | ${adjudicator} | ${basis.replace(/\|/g, '/')} | ${validUntil} |`,
      );
    }
    lines.push('');
  }

  // 审计：放行单指纹清单，便于核对「为什么这张放行已经不生效」
  const exemptionRows = eff
    .map(({ item }) => item)
    .flatMap((item) =>
      exemptions
        .filter((x) => x.itemId === item.id)
        .map((x) => ({ item, ex: x })),
    );
  if (exemptionRows.length > 0) {
    lines.push('## 附：放行单审计轨迹（含已失效）');
    lines.push('');
    lines.push('| 依赖 | 绑定指纹（名称/版本/许可证/渠道） | 裁定人 | 到期时间 | 状态 |');
    lines.push('|---|---|---|---|---|');
    for (const { item, ex } of exemptionRows.sort((a, b) => b.ex.grantedAt - a.ex.grantedAt)) {
      const fpMatch = ex.fingerprint === itemFingerprint(item);
      const status = ex.revoked
        ? '已撤销'
        : now >= ex.expiresAt
          ? '已到期，重新阻断'
          : !fpMatch
            ? '条目已变更（版本/许可证/渠道），须重新裁定'
            : '有效';
      lines.push(`| ${item.name} | ${ex.fingerprint} | ${ex.approver} | ${formatTime(ex.expiresAt)} | ${status} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function downloadMarkdown(filename: string, content: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
