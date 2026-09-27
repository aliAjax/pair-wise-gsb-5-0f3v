import { seedItems } from './rules';
import type { Store } from './types';

const KEY = 'license-lens:review-console:v1';

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Store>;
      if (Array.isArray(parsed.items) && Array.isArray(parsed.exemptions)) {
        return {
          items: parsed.items,
          exemptions: parsed.exemptions,
          approver: parsed.approver ?? '',
          activeProductId: parsed.activeProductId,
          selectedId: parsed.selectedId,
        };
      }
    }
  } catch {
    // 数据损坏时重新播种，不阻塞审查台使用
  }
  return { items: seedItems(), exemptions: [], approver: '' };
}

export function saveStore(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // 隐私模式等场景下静默失败，不影响当前会话审查
  }
}
