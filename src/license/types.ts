// 产品级许可证审查台领域模型

/** 规则引擎的原始裁定：放行 / 阻断 / 需人工裁定（阻断项的一种） */
export type Verdict = 'allow' | 'block' | 'review';

/** 发布渠道：同一许可证在不同渠道下结论可能不同 */
export type ChannelId = 'store' | 'onprem' | 'saas' | 'oss';

/** 一条清单依赖的当前有效结论 */
export type EffectiveKind = 'allow' | 'block' | 'review' | 'exempt';

export interface RuleEntry {
  verdict: Verdict;
  basis: string;
}

/** 全局基线规则：某许可证在四个渠道下的默认结论 */
export interface BaselineRule {
  id: string;
  license: string;
  map: Record<ChannelId, RuleEntry>;
}

/** 产品级覆盖规则：只写需要覆盖的渠道，未覆盖的渠道继续走基线 */
export interface ProductOverride {
  id: string;
  license: string;
  map: Partial<Record<ChannelId, RuleEntry>>;
}

export interface ProductDef {
  id: string;
  code: string;
  name: string;
  desc: string;
  overrides: ProductOverride[];
}

/** 清单条目：名称 + 版本 + 许可证 + 渠道，归属于一个产品 */
export interface Item {
  id: string;
  productId: string;
  name: string;
  version: string;
  license: string;
  channel: ChannelId;
}

/**
 * 限时放行单（逐项裁定）。
 * fingerprint 绑定 name|version|license|channel：
 * 到期 -> 失效重新阻断；任一维度变化（含同一版本换渠道）-> 指纹不符，必须重判。
 */
export interface Exemption {
  id: string;
  productId: string;
  itemId: string;
  fingerprint: string;
  reason: string;
  approver: string;
  grantedAt: number;
  expiresAt: number;
  revoked?: boolean;
}

export interface RuleResult {
  verdict: Verdict;
  ruleId: string;
  basis: string;
  source: 'product' | 'baseline' | 'default';
}

export interface Effective {
  kind: EffectiveKind;
  rule: RuleResult;
  active?: Exemption;
}

export interface Store {
  items: Item[];
  exemptions: Exemption[];
  approver: string;
  activeProductId?: string;
  selectedId?: string;
}
