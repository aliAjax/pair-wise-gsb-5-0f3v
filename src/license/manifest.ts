import { CHANNELS } from './rules';
import type { ChannelId, Item } from './types';

export interface ParsedRow {
  name: string;
  version: string;
  license: string;
  channel: ChannelId | null;
  rawChannel?: string;
}

export interface ParseResult {
  rows: ParsedRow[];
  errors: string[];
}

const LICENSE_ALIASES: Record<string, string> = {
  mit: 'MIT',
  bsd: 'BSD-3-Clause',
  'bsd-3-clause': 'BSD-3-Clause',
  'bsd 3-clause': 'BSD-3-Clause',
  'new bsd': 'BSD-3-Clause',
  apache: 'Apache-2.0',
  'apache 2': 'Apache-2.0',
  'apache-2.0': 'Apache-2.0',
  'apache2': 'Apache-2.0',
  isc: 'ISC',
  mpl: 'MPL-2.0',
  'mpl-2.0': 'MPL-2.0',
  mpl2: 'MPL-2.0',
  'mozilla public license 2.0': 'MPL-2.0',
  lgpl: 'LGPL-2.1',
  'lgpl-2.1': 'LGPL-2.1',
  'lgpl 2.1': 'LGPL-2.1',
  gpl: 'GPL-3.0',
  'gpl-2': 'GPL-2.0',
  'gpl-2.0': 'GPL-2.0',
  'gpl2': 'GPL-2.0',
  'gpl-3': 'GPL-3.0',
  'gpl-3.0': 'GPL-3.0',
  'gpl3': 'GPL-3.0',
  agpl: 'AGPL-3.0',
  'agpl-3.0': 'AGPL-3.0',
  'agpl3': 'AGPL-3.0',
  sspl: 'SSPL-1.0',
  'sspl-1.0': 'SSPL-1.0',
  busl: 'BUSL-1.1',
  'busl-1.1': 'BUSL-1.1',
};

const KNOWN_LICENSES = new Set([
  'MIT', 'BSD-3-Clause', 'Apache-2.0', 'ISC', 'MPL-2.0', 'LGPL-2.1',
  'GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'SSPL-1.0', 'BUSL-1.1',
]);

export function normalizeLicense(raw: string): string {
  const key = raw.trim().toLowerCase();
  const alias = LICENSE_ALIASES[key];
  if (alias) return alias;
  const canonical = raw.trim().replace(/_/g, '-');
  if (KNOWN_LICENSES.has(canonical)) return canonical;
  return raw.trim() || 'Unknown';
}

export function normalizeChannel(raw: string): ChannelId | null {
  const key = raw.trim().toLowerCase();
  for (const [id, meta] of Object.entries(CHANNELS) as [ChannelId, { aliases: string[] }][]) {
    if (id === key || meta.aliases.includes(key)) return id;
  }
  return null;
}

/**
 * 解析清单文本。支持：
 * - 带表头的 CSV / TSV（表头识别：名称/版本/许可证/渠道，中英文均可）
 * - 无表头时按列顺序：名称, 版本, 许可证, 渠道
 * - 部分行用空格分隔（name@version license channel 这类简写）
 */
export function parseManifest(text: string): ParseResult {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return { rows: [], errors: ['清单为空'] };

  const splitLine = (line: string): string[] => {
    if (line.includes('\t')) return line.split('\t').map((s) => s.trim());
    if (line.includes(',')) return line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    return line.split(/\s+/).map((s) => s.trim());
  };

  let cols: Record<number, 'name' | 'version' | 'license' | 'channel'> | null = null;
  const firstCells = splitLine(lines[0]).map((c) => c.toLowerCase());
  // 仅用纯表头词识别表头（不含 apache2 这类许可证别名），且名称列与版本列必须同时出现
  const headerHit = firstCells
    .map((c): 'name' | 'version' | 'license' | 'channel' | null => {
      if (['name', '名称', '依赖', '依赖名称', '包名', 'package', 'pkg'].includes(c)) return 'name';
      if (['version', '版本', 'ver'].includes(c)) return 'version';
      if (['license', '许可证', '许可', '协议', 'spdx'].includes(c)) return 'license';
      if (['channel', '渠道', '发布渠道', '分发渠道', 'source', '来源'].includes(c)) return 'channel';
      return null;
    });
  if (headerHit.includes('name') && headerHit.includes('version')) {
    cols = {};
    headerHit.forEach((f, idx) => { if (f) cols![idx] = f; });
  }

  const dataLines = cols ? lines.slice(1) : lines;

  const rows: ParsedRow[] = [];
  dataLines.forEach((line, i) => {
    const cells = splitLine(line);
    const raw = { name: '', version: '', license: '', channel: '' };
    // 列数不足且首格为 name@version：版本内嵌，其余格按 许可证、渠道 顺序对齐
    const shortForm = cells.length >= 2 && cells[0].includes('@')
      && (cols ? cells.length < Object.keys(cols).length : cells.length < 4);
    if (shortForm) {
      raw.name = cells[0];
      [raw.license, raw.channel] = [cells[1] ?? '', cells[2] ?? ''];
    } else if (cols) {
      for (const [idxStr, field] of Object.entries(cols)) {
        raw[field] = cells[Number(idxStr)] ?? '';
      }
    } else {
      [raw.name, raw.version, raw.license, raw.channel] = [
        cells[0] ?? '', cells[1] ?? '', cells[2] ?? '', cells[3] ?? '',
      ];
    }

    let name = raw.name;
    let version = raw.version;
    // 版本列为空时，从 name@version 中拆出版本（@scope/pkg@1.0 -> @scope/pkg / 1.0）
    if (!version && name.includes('@')) {
      const at = name.lastIndexOf('@');
      version = name.slice(at + 1);
      name = name.slice(0, at);
    }
    const licenseRaw = raw.license;
    const channelRaw = raw.channel;

    if (!name) {
      errors.push(`第 ${i + (cols ? 2 : 1)} 行缺少依赖名称，已跳过`);
      return;
    }
    const channel = normalizeChannel(channelRaw);
    if (channelRaw && !channel) {
      errors.push(`第 ${i + (cols ? 2 : 1)} 行「${name}」的渠道「${channelRaw}」无法识别，请选择：商店 / 私有化 / SaaS / 开源`);
    }
    rows.push({
      name,
      version: version || '未标注',
      license: normalizeLicense(licenseRaw),
      channel,
      rawChannel: channelRaw || undefined,
    });
  });

  return { rows, errors };
}

export function rowsToItems(rows: ParsedRow[], productId: string, channel: ChannelId): Item[] {
  return rows.map((r) => {
    const ch = r.channel ?? channel;
    return {
      id: `${productId}:${r.name}@${r.version}:${ch}:${Math.random().toString(36).slice(2, 8)}`,
      productId,
      name: r.name,
      version: r.version,
      license: r.license,
      channel: ch,
    };
  });
}
