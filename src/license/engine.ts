import { BASELINE_RULES, PRODUCTS } from './rules';
import type {
  ChannelId,
  Effective,
  Exemption,
  Item,
  ProductDef,
  RuleResult,
  Verdict,
} from './types';

/** 放行单与结论的指纹：名称、版本、许可证、渠道四元组。任一变化（含同版本换渠道）即失效。 */
export function fingerprintOf(name: string, version: string, license: string, channel: ChannelId): string {
  return [name.trim().toLowerCase(), version.trim(), license.trim(), channel].join('|');
}

export function itemFingerprint(item: Pick<Item, 'name' | 'version' | 'license' | 'channel'>): string {
  return fingerprintOf(item.name, item.version, item.license, item.channel);
}

const DEFAULT_RULE: RuleResult = {
  verdict: 'review',
  ruleId: 'DEFAULT-UNKNOWN',
  basis: '未识别许可证，基线规则表中无匹配项，默认阻断等待法务裁定',
  source: 'default',
};

/** 先查产品覆盖规则，再查基线规则，都没有则走默认阻断 */
export function evaluateRule(productId: string, license: string, channel: ChannelId): RuleResult {
  const product: ProductDef | undefined = PRODUCTS.find((p) => p.id === productId);
  const override = product?.overrides.find((o) => o.license === license)?.map[channel];
  if (override) {
    const o = product!.overrides.find((x) => x.license === license)!;
    return { ...override, ruleId: o.id, source: 'product' };
  }

  const baseline = BASELINE_RULES.find((r) => r.license === license)?.map[channel];
  if (baseline) {
    const r = BASELINE_RULES.find((x) => x.license === license)!;
    return { ...baseline, ruleId: r.id, source: 'baseline' };
  }
  return DEFAULT_RULE;
}

/** 放行单是否仍在有效期内（撤销/到期均不算）。放行授予即生效，grantedAt 仅作记录。 */
export function exemptionActive(e: Exemption, now: number): boolean {
  return !e.revoked && now < e.expiresAt;
}

/** 针对某条目当前有效的放行单：必须未撤销、未到期、指纹完全一致 */
export function activeExemptionFor(item: Item, exemptions: Exemption[], now: number): Exemption | undefined {
  const fp = itemFingerprint(item);
  return exemptions
    .filter((e) => e.itemId === item.id && exemptionActive(e, now) && e.fingerprint === fp)
    .sort((a, b) => b.grantedAt - a.grantedAt)[0];
}

/**
 * 该条目是否挂着「已失效的旧放行」：
 * 到期 / 已撤销 / 指纹不符（换渠道、改版本、改许可证）。用于提示必须重新裁定。
 */
export function staleExemptionFor(item: Item, exemptions: Exemption[], now: number): Exemption | undefined {
  const fp = itemFingerprint(item);
  const latest = exemptions
    .filter((e) => e.itemId === item.id)
    .sort((a, b) => b.grantedAt - a.grantedAt)[0];
  if (!latest) return undefined;
  if (exemptionActive(latest, now) && latest.fingerprint === fp) return undefined;
  return latest;
}

/** 条目当前有效结论：有效放行单优先（限时放行），否则用规则裁定 */
export function effectiveFor(item: Item, exemptions: Exemption[], now: number): Effective {
  const rule = evaluateRule(item.productId, item.license, item.channel);
  const active = activeExemptionFor(item, exemptions, now);
  if (active) return { kind: 'exempt', rule, active };
  return { kind: rule.verdict, rule };
}

export function isBlocking(kind: Effective['kind']): boolean {
  return kind === 'block' || kind === 'review';
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  allow: '规则放行',
  block: '规则阻断',
  review: '需人工裁定',
};
