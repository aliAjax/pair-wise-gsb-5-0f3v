import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Ban, Check, CheckCircle2, Download, FileCode2, FileText,
  History, Hourglass, PackagePlus, RefreshCw, Scale, Search, ShieldCheck,
  TimerOff, Trash2, Upload, User,
} from 'lucide-react';
import {
  effectiveFor, exemptionActive, isBlocking, itemFingerprint, staleExemptionFor,
} from './license/engine';
import { parseManifest, rowsToItems } from './license/manifest';
import { buildReport, downloadMarkdown, formatTime, remainingLabel } from './license/report';
import { BASELINE_RULES, CHANNELS, CHANNEL_ORDER, PRODUCTS } from './license/rules';
import { loadStore, saveStore } from './license/storage';
import type {
  ChannelId, Effective, Exemption, Item, ProductDef, Verdict,
} from './license/types';

type FilterKey = 'all' | 'blocking' | 'exempt' | 'allow';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'blocking', label: '阻断中' },
  { key: 'exempt', label: '限时放行' },
  { key: 'allow', label: '规则放行' },
];

const KIND_BADGE: Record<Effective['kind'], { text: string; cls: string }> = {
  allow: { text: '规则放行', cls: 'allow' },
  block: { text: '规则阻断', cls: 'block' },
  review: { text: '待裁定', cls: 'review' },
  exempt: { text: '限时放行', cls: 'exempt' },
};

const LICENSE_OPTIONS = [
  'MIT', 'BSD-3-Clause', 'Apache-2.0', 'ISC', 'MPL-2.0', 'LGPL-2.1',
  'GPL-2.0', 'GPL-3.0', 'AGPL-3.0', 'SSPL-1.0', 'BUSL-1.1', 'Unknown',
];

const DURATIONS: { label: string; ms: number; test?: boolean }[] = [
  { label: '5 分钟', ms: 5 * 60_000, test: true },
  { label: '2 小时', ms: 2 * 3600_000 },
  { label: '1 天', ms: 24 * 3600_000 },
  { label: '7 天', ms: 7 * 24 * 3600_000 },
  { label: '30 天', ms: 30 * 24 * 3600_000 },
];

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toLocalInput(ts: number): string {
  const d = new Date(ts - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

export default function App() {
  const [store, setStore] = useState(loadStore);
  const [now, setNow] = useState(() => Date.now());
  const [productId, setProductId] = useState<string>(
    store.activeProductId && PRODUCTS.some((p) => p.id === store.activeProductId)
      ? store.activeProductId
      : PRODUCTS[0].id,
  );
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [selectedId, setSelectedId] = useState<string | null>(
    () => (store.selectedId && store.items.some((i) => i.id === store.selectedId) ? store.selectedId! : null),
  );
  const [grantItem, setGrantItem] = useState<Item | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const selectProduct = (id: string) => {
    setProductId(id);
    // 切到某产品时，只恢复属于该产品的选中项，避免详情面板跨产品
    setSelectedId((cur) => (cur && store.items.some((i) => i.id === cur && i.productId === id) ? cur : null));
  };

  useEffect(() => saveStore({ ...store, activeProductId: productId, selectedId: selectedId ?? undefined }), [store, productId, selectedId]);
  // 选中条目被删除后，清空悬空选择
  useEffect(() => {
    if (selectedId && !store.items.some((i) => i.id === selectedId)) setSelectedId(null);
  }, [store.items, selectedId]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const t = setInterval(tick, 5000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const product = PRODUCTS.find((p) => p.id === productId)!;

  const effMap = useMemo(() => {
    const m = new Map<string, Effective>();
    for (const item of store.items) m.set(item.id, effectiveFor(item, store.exemptions, now));
    return m;
  }, [store.items, store.exemptions, now]);

  const productItems = useMemo(
    () => store.items.filter((i) => i.productId === productId),
    [store.items, productId],
  );

  const perProductBlocking = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of store.items) {
      if (isBlocking(effMap.get(item.id)!.kind)) {
        counts.set(item.productId, (counts.get(item.productId) ?? 0) + 1);
      }
    }
    return counts;
  }, [store.items, effMap]);

  const counts = useMemo(() => {
    let allow = 0, exempt = 0, blocking = 0;
    for (const item of productItems) {
      const k = effMap.get(item.id)!.kind;
      if (k === 'allow') allow++;
      else if (k === 'exempt') exempt++;
      if (isBlocking(k)) blocking++;
    }
    return { total: productItems.length, allow, exempt, blocking };
  }, [productItems, effMap]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return productItems.filter((item) => {
      const k = effMap.get(item.id)!.kind;
      if (filter === 'blocking' && !isBlocking(k)) return false;
      if (filter === 'exempt' && k !== 'exempt') return false;
      if (filter === 'allow' && k !== 'allow') return false;
      if (!q) return true;
      return `${item.name} ${item.version} ${item.license} ${CHANNELS[item.channel].label}`.toLowerCase().includes(q);
    });
  }, [productItems, effMap, filter, query]);

  const selected = productItems.find((i) => i.id === selectedId)
    ?? store.items.find((i) => i.id === selectedId)
    ?? null;

  const updateItem = (id: string, patch: Partial<Item>) =>
    setStore((s) => ({ ...s, items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));

  const deleteItem = (id: string) => {
    setStore((s) => ({
      ...s,
      items: s.items.filter((i) => i.id !== id),
      exemptions: s.exemptions.filter((e) => e.itemId !== id),
    }));
  };

  const grantExemption = (item: Item, approver: string, reason: string, expiresAt: number) => {
    const ex: Exemption = {
      id: uid('EX'),
      productId: item.productId,
      itemId: item.id,
      fingerprint: itemFingerprint(item),
      approver: approver.trim(),
      reason: reason.trim(),
      grantedAt: Date.now(),
      expiresAt,
    };
    setStore((s) => ({
      ...s,
      approver: approver.trim(),
      // 同一条目旧放行一律撤销留痕，保证同一时刻只有一张生效放行
      exemptions: [
        ...s.exemptions.map((e) => (e.itemId === item.id && !e.revoked ? { ...e, revoked: true } : e)),
        ex,
      ],
    }));
    setGrantItem(null);
  };

  const revokeExemption = (exId: string) =>
    setStore((s) => ({
      ...s,
      exemptions: s.exemptions.map((e) => (e.id === exId ? { ...e, revoked: true } : e)),
    }));

  const importItems = (incoming: Item[]) =>
    setStore((s) => ({ ...s, items: [...s.items, ...incoming] }));

  const exportReport = () => {
    const md = buildReport({ productId, items: productItems, exemptions: store.exemptions, now });
    downloadMarkdown(`license-review-${product.code}-${new Date().toISOString().slice(0, 10)}.md`, md);
  };

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <div className="brand-icon"><ShieldCheck size={18} /></div>
          <div><b>License Lens</b><small>PRODUCT REVIEW CONSOLE</small></div>
        </div>
        <div className="nav-title">产品审查台</div>
        {PRODUCTS.map((p) => {
          const n = perProductBlocking.get(p.id) ?? 0;
          return (
            <button
              key={p.id}
              className={`nav product-nav${p.id === productId ? ' active' : ''}`}
              onClick={() => selectProduct(p.id)}
            >
              <FileCode2 size={15} />
              <span className="pn-text"><b>{p.name}</b><small>{p.code} · {p.desc}</small></span>
              {n > 0
                ? <em className="badge-bad">{n}</em>
                : <em className="badge-ok"><Check size={11} /></em>}
            </button>
          );
        })}
        <div className="aside-bottom">
          <div className="mini-card">
            <Hourglass size={16} />
            <div>
              <b>限时放行到期自动阻断</b>
              <small>放行单按 名称/版本/许可证/渠道 绑定，换渠道或改版须重判</small>
            </div>
          </div>
          <label className="approver-box">
            <User size={13} />
            <input
              value={store.approver}
              onChange={(e) => setStore((s) => ({ ...s, approver: e.target.value }))}
              placeholder="当前裁定人姓名"
            />
          </label>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <div className="crumb">REVIEW / <b>{product.code}</b></div>
            <h1>{product.name} · 发布前许可证审查</h1>
            <p>{product.desc} —— 先套产品规则，再逐项限时放行；到期自动重新阻断。</p>
          </div>
          <div className="head-actions">
            <button className="outline" onClick={() => setShowImport(true)}><Upload size={15} />导入清单</button>
            <button className="outline" onClick={() => setShowRules(true)}><Scale size={15} />产品规则</button>
            <button className="primary" onClick={exportReport}><Download size={15} />导出报告</button>
          </div>
        </header>

        <section className={`gate ${counts.blocking ? 'bad' : 'good'}`}>
          {counts.blocking ? (
            <>
              <Ban size={20} />
              <div>
                <b>发布门禁关闭：仍有 {counts.blocking} 个阻断项未清完</b>
                <p>规则阻断 / 待裁定条目必须替换、整改，或由有权人逐项限时放行后才能发版。</p>
              </div>
              <button className="gate-btn" onClick={exportReport}><FileText size={14} />导出当前结论留档</button>
            </>
          ) : (
            <>
              <CheckCircle2 size={20} />
              <div>
                <b>发布门禁开启：阻断项已清零（{counts.total} 项全部具备当前有效结论）</b>
                <p>注意限时放行条目到期后会重新阻断，发版前请再次确认有效期。</p>
              </div>
              <button className="gate-btn" onClick={exportReport}><Download size={14} />导出审查报告</button>
            </>
          )}
        </section>

        <section className="summary">
          <div><span>清单条目</span><b>{counts.total}</b><small>当前产品全部依赖</small></div>
          <div><span>规则放行</span><b className="teal">{counts.allow}</b><small>许可证 × 渠道 自动通过</small></div>
          <div><span>限时放行</span><b className="indigo">{counts.exempt}</b><small>人工豁免，到期回落</small></div>
          <div><span>阻断中</span><b className="red">{counts.blocking}</b><small>规则阻断 + 待裁定</small></div>
        </section>

        <section className="workspace">
          <div className="table-pane">
            <div className="pane-head">
              <div>
                <h2>{product.name} 依赖清单</h2>
                <p>结论随发布渠道变化；同一版本换渠道必须重新判定</p>
              </div>
              <div className="tools">
                <div className="search">
                  <Search size={15} />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索名称 / 许可证" />
                </div>
              </div>
            </div>
            <div className="chips">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={`chip${filter === f.key ? ' on' : ''}`}
                  onClick={() => setFilter(f.key)}
                >{f.label}</button>
              ))}
            </div>
            <div className="table">
              <div className="tr th">
                <span>依赖名称</span><span>版本</span><span>许可证</span><span>渠道</span><span>当前结论</span><span>有效期</span>
              </div>
              {filtered.length === 0 && (
                <div className="empty-row">
                  <PackagePlus size={18} />
                  <span>没有匹配条目，点击右上角「导入清单」加入依赖</span>
                </div>
              )}
              {filtered.map((item) => {
                const eff = effMap.get(item.id)!;
                const badge = KIND_BADGE[eff.kind];
                return (
                  <button
                    key={item.id}
                    className={`tr${selectedId === item.id ? ' selected' : ''}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <span className="dep-name">{item.name}</span>
                    <span className="muted">{item.version}</span>
                    <span><i className="license">{item.license}</i></span>
                    <span className="channel-cell">{CHANNELS[item.channel].short}</span>
                    <span className={`kbadge ${badge.cls}`}>
                      {eff.kind === 'allow' && <Check size={12} />}
                      {eff.kind === 'block' && <Ban size={12} />}
                      {eff.kind === 'review' && <AlertTriangle size={12} />}
                      {eff.kind === 'exempt' && <TimerOff size={12} />}
                      {badge.text}
                    </span>
                    <span className="muted small">
                      {eff.kind === 'exempt' && eff.active ? remainingLabel(eff.active.expiresAt, now) : '—'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <DetailPane
            key={selected?.id ?? 'none'}
            product={product}
            item={selected && selected.productId === productId ? selected : null}
            eff={selected ? effMap.get(selected.id) ?? null : null}
            exemptions={store.exemptions}
            now={now}
            approver={store.approver}
            onUpdate={updateItem}
            onDelete={deleteItem}
            onGrant={(it) => setGrantItem(it)}
            onRevoke={revokeExemption}
          />
        </section>
      </main>

      {grantItem && (
        <GrantModal
          item={grantItem}
          defaultApprover={store.approver}
          onClose={() => setGrantItem(null)}
          onGrant={grantExemption}
        />
      )}
      {showImport && (
        <ImportModal
          product={product}
          onClose={() => setShowImport(false)}
          onImport={(incoming) => { importItems(incoming); setShowImport(false); }}
        />
      )}
      {showRules && <RulesModal product={product} onClose={() => setShowRules(false)} />}
    </div>
  );
}

/* ---------------- 逐项审查面板 ---------------- */

function DetailPane(props: {
  product: ProductDef;
  item: Item | null;
  eff: Effective | null;
  exemptions: Exemption[];
  now: number;
  approver: string;
  onUpdate: (id: string, patch: Partial<Item>) => void;
  onDelete: (id: string) => void;
  onGrant: (item: Item) => void;
  onRevoke: (exId: string) => void;
}) {
  const { product, item, eff, exemptions, now, onUpdate, onDelete, onGrant, onRevoke } = props;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Item | null>(null);

  if (!item || !eff) {
    return (
      <div className="detail placeholder">
        <Scale size={30} />
        <b>选择一条依赖开始审查</b>
        <p>先按产品规则自动判定；阻断项可以由安全 / 法务逐项限时放行，放行记录随条目持久保存。</p>
      </div>
    );
  }

  const stale = staleExemptionFor(item, exemptions, now);
  const history = exemptions.filter((e) => e.itemId === item.id).sort((a, b) => b.grantedAt - a.grantedAt);
  const blocking = isBlocking(eff.kind);

  const startEdit = () => { setDraft({ ...item }); setEditing(true); };
  const commitEdit = () => {
    if (!draft) return;
    onUpdate(item.id, {
      name: draft.name.trim() || item.name,
      version: draft.version.trim() || item.version,
      license: draft.license,
      channel: draft.channel,
    });
    setEditing(false);
  };

  const sourceLabel =
    eff.rule.source === 'product' ? '产品规则覆盖' : eff.rule.source === 'baseline' ? '全局基线规则' : '默认策略';

  return (
    <div className="detail">
      <div className="detail-head">
        <div className="detail-icon"><FileCode2 size={20} /></div>
        <div>
          <span>SELECTED DEPENDENCY</span>
          <h2>{item.name}</h2>
        </div>
        {!editing && (
          <div className="head-btns">
            <button className="icon-btn" title="编辑名称/版本/许可证/渠道" onClick={startEdit}><RefreshCw size={14} /></button>
            <button className="icon-btn danger" title="移出清单" onClick={() => onDelete(item.id)}><Trash2 size={14} /></button>
          </div>
        )}
      </div>

      {editing && draft ? (
        <div className="edit-form">
          <label>依赖名称<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <div className="edit-row">
            <label>版本<input value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} /></label>
            <label>许可证
              <select value={draft.license} onChange={(e) => setDraft({ ...draft, license: e.target.value })}>
                {LICENSE_OPTIONS.map((l) => <option key={l}>{l}</option>)}
              </select>
            </label>
          </div>
          <label>发布渠道
            <select value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value as ChannelId })}>
              {CHANNEL_ORDER.map((c) => <option key={c} value={c}>{CHANNELS[c].label}</option>)}
            </select>
          </label>
          {(draft.name !== item.name || draft.version !== item.version
            || draft.license !== item.license || draft.channel !== item.channel) && (
            <p className="edit-warn"><AlertTriangle size={13} /> 保存后将按新四元组重新判定；如存在有效放行单，会因指纹不符立即失效。</p>
          )}
          <div className="edit-actions">
            <button className="outline" onClick={() => setEditing(false)}>取消</button>
            <button className="primary" onClick={commitEdit}>保存并重判</button>
          </div>
        </div>
      ) : (
        <>
          <div className="detail-grid">
            <div><label>版本</label><b>{item.version}</b></div>
            <div><label>许可证</label><b>{item.license}</b></div>
            <div><label>发布渠道</label><b>{CHANNELS[item.channel].label}</b></div>
          </div>

          <div className={`finding ${eff.kind}`}>
            <div className="finding-icon">
              {eff.kind === 'allow' && <Check size={16} />}
              {eff.kind === 'block' && <Ban size={16} />}
              {eff.kind === 'review' && <AlertTriangle size={16} />}
              {eff.kind === 'exempt' && <TimerOff size={16} />}
            </div>
            <div>
              <b>
                {eff.kind === 'allow' && '规则放行：当前许可证 × 渠道可直接分发'}
                {eff.kind === 'block' && '规则阻断：不得在当前渠道发布'}
                {eff.kind === 'review' && '需人工裁定：规则表要求法务 / 安全复核'}
                {eff.kind === 'exempt' && '限时放行中：已获人工豁免'}
              </b>
              <p>
                <i className={`rule-tag ${eff.rule.source}`}>{eff.rule.ruleId} · {sourceLabel}</i>
                {eff.rule.basis}
              </p>
            </div>
          </div>

          {eff.kind === 'exempt' && eff.active && (
            <div className="exemption-card">
              <div className="ex-head">
                <TimerOff size={15} />
                <b>放行单 {eff.active.id.slice(-6)}</b>
                <span className="countdown">{remainingLabel(eff.active.expiresAt, now)}</span>
              </div>
              <div className="ex-grid">
                <div><label>裁定人</label><b>{eff.active.approver}</b></div>
                <div><label>生效时间</label><b>{formatTime(eff.active.grantedAt)}</b></div>
                <div><label>到期时间</label><b>{formatTime(eff.active.expiresAt)}</b></div>
              </div>
              <p className="ex-reason"><label>放行依据 / 理由</label>{eff.active.reason}</p>
              <p className="ex-fp"><label>绑定指纹</label><code>{eff.active.fingerprint}</code></p>
              <button className="outline danger-btn full" onClick={() => onRevoke(eff.active!.id)}>
                <Ban size={13} />撤销此放行（立即恢复阻断）
              </button>
            </div>
          )}

          {stale && (
            <div className="stale-card">
              <div className="stale-head">
                <AlertTriangle size={15} />
                <b>旧放行已失效，当前按规则重新阻断</b>
              </div>
              <StaleReason item={item} exemption={stale} now={now} />
              <p className="stale-fp">旧放行指纹 <code>{stale.fingerprint}</code><br />当前指纹 <code>{itemFingerprint(item)}</code></p>
              {blocking && (
                <button className="primary full" onClick={() => onGrant(item)}>
                  <TimerOff size={14} />按当前四元组重新裁定
                </button>
              )}
            </div>
          )}

          {blocking && eff.kind !== 'exempt' && (
            <button className="primary full grant-btn" onClick={() => onGrant(item)}>
              <TimerOff size={15} />逐项限时放行
            </button>
          )}

          {history.length > 0 && (
            <div className="history">
              <div className="history-title"><History size={13} /><span>裁定记录</span></div>
              {history.map((e) => {
                const fpMatch = e.fingerprint === itemFingerprint(item);
                const alive = exemptionActive(e, now) && fpMatch;
                return (
                  <div key={e.id} className={`history-item ${alive ? 'alive' : 'dead'}`}>
                    <div>
                      <b>{e.approver}</b>
                      <span>{formatTime(e.grantedAt)} → {formatTime(e.expiresAt)}</span>
                    </div>
                    <small>
                      {e.revoked ? '已撤销' : now >= e.expiresAt ? '已到期，已重新阻断' : !fpMatch ? '四元组变化，指纹不符，须重新裁定' : '生效中'}
                    </small>
                    <p>{e.reason}</p>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StaleReason({ item, exemption, now }: { item: Item; exemption: Exemption; now: number }) {
  if (exemption.revoked) {
    return <p>该放行单已由 {exemption.approver} 手动撤销，条目立即回落为规则结论。</p>;
  }
  if (now >= exemption.expiresAt) {
    return <p>放行已于 {formatTime(exemption.expiresAt)} 到期，系统自动恢复阻断；如需继续发布须重新裁定。</p>;
  }
  // 未到期但指纹不符：拆指纹对比，说明是哪一维变了
  const [oldName, oldVersion, oldLicense, oldChannel] = exemption.fingerprint.split('|');
  const changes: string[] = [];
  if (oldName !== item.name.toLowerCase()) changes.push(`名称 ${oldName} → ${item.name}`);
  if (oldVersion !== item.version) changes.push(`版本 ${oldVersion} → ${item.version}`);
  if (oldLicense !== item.license) changes.push(`许可证 ${oldLicense} → ${item.license}`);
  if (oldChannel !== item.channel) {
    changes.push(`渠道 ${CHANNELS[oldChannel as ChannelId]?.label ?? oldChannel} → ${CHANNELS[item.channel].label}（同一版本换渠道）`);
  }
  return <p>放行仍在有效期内，但条目已变更：{changes.join('；')}。旧放行不适用当前组合，必须重新裁定。</p>;
}

/* ---------------- 限时放行弹窗 ---------------- */

function GrantModal({ item, defaultApprover, onClose, onGrant }: {
  item: Item;
  defaultApprover: string;
  onClose: () => void;
  onGrant: (item: Item, approver: string, reason: string, expiresAt: number) => void;
}) {
  const [approver, setApprover] = useState(defaultApprover);
  const [reason, setReason] = useState('');
  const [preset, setPreset] = useState<number>(DURATIONS[2].ms);
  const [custom, setCustom] = useState(toLocalInput(Date.now() + DURATIONS[2].ms));
  const [useCustom, setUseCustom] = useState(false);
  const [touched, setTouched] = useState(false);

  const parsedExpires = useCustom ? new Date(custom).getTime() : Date.now() + preset;
  const expires = Number.isFinite(parsedExpires) ? parsedExpires : NaN;
  const valid = approver.trim().length > 0 && reason.trim().length > 0 && Number.isFinite(expires) && expires > Date.now();

  const submit = () => {
    setTouched(true);
    if (valid) onGrant(item, approver, reason, expires);
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>逐项限时放行</h2>
          <button onClick={onClose}>×</button>
        </div>
        <p className="modal-target">
          <b>{item.name}</b> {item.version} · {item.license} · {CHANNELS[item.channel].label}
        </p>
        <p className="modal-hint">
          放行仅对当前「名称 / 版本 / 许可证 / 渠道」四元组生效；到期自动恢复阻断，任一维度变化（含同版本换渠道）须重新裁定。
        </p>
        <label className="field">裁定人
          <input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="姓名，将写入审查报告" />
        </label>
        <label className="field">放行依据 / 理由
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="例如：法务已确认动态链接隔离方案（工号 / 工单号），发布前替换组件"
          />
        </label>
        <div className="field">有效期</div>
        <div className="durations">
          {DURATIONS.map((d) => (
            <button
              key={d.ms}
              className={`dur${!useCustom && preset === d.ms ? ' on' : ''}`}
              onClick={() => { setPreset(d.ms); setUseCustom(false); }}
            >{d.label}{d.test && <em>测试</em>}</button>
          ))}
          <button className={`dur custom${useCustom ? ' on' : ''}`} onClick={() => setUseCustom(true)}>自定义</button>
        </div>
        {useCustom && (
          <input
            type="datetime-local"
            className="custom-time"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        )}
        <div className="expire-preview">到期时间：{formatTime(expires)}</div>
        {touched && !valid && (
          <p className="form-err"><AlertTriangle size={13} /> 请填写裁定人和放行依据，且到期时间必须晚于当前时间。</p>
        )}
        <button className="primary full grant-confirm" onClick={submit}>
          <TimerOff size={15} />确认限时放行
        </button>
      </div>
    </div>
  );
}

/* ---------------- 导入清单弹窗 ---------------- */

const SAMPLE = `名称,版本,许可证,渠道
dayjs,1.11.13,MIT,SaaS
zlib-bindings,1.0.4,Zlib,私有化
gpl-tool,0.3.0,GPL-2.0,商店`;

function ImportModal({ product, onClose, onImport }: {
  product: ProductDef;
  onClose: () => void;
  onImport: (items: Item[]) => void;
}) {
  const [text, setText] = useState(SAMPLE);
  const [fallback, setFallback] = useState<ChannelId>('saas');

  const parsed = useMemo(() => parseManifest(text), [text]);
  const unresolvedChannel = parsed.rows.filter((r) => !r.channel).length;

  const doImport = () => {
    onImport(rowsToItems(parsed.rows, product.id, fallback));
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>导入依赖清单 · {product.name}</h2>
          <button onClick={onClose}>×</button>
        </div>
        <p className="modal-hint">
          支持 CSV / TSV，表头支持「名称 / 版本 / 许可证 / 渠道」中英文；也支持 <code>name@version,许可证,渠道</code> 简写。
          许可证别名（GPL3、Apache2 等）与渠道别名（商店 / 私有化 / SaaS / 开源）会自动归一。
        </p>
        <textarea className="manifest-input" rows={7} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="import-meta">
          <label className="inline">未识别渠道的行默认归入
            <select value={fallback} onChange={(e) => setFallback(e.target.value as ChannelId)}>
              {CHANNEL_ORDER.map((c) => <option key={c} value={c}>{CHANNELS[c].label}</option>)}
            </select>
          </label>
          <span>识别到 {parsed.rows.length} 行{unresolvedChannel > 0 && `，其中 ${unresolvedChannel} 行渠道待归入默认值`}</span>
        </div>
        {parsed.errors.length > 0 && (
          <ul className="parse-errors">
            {parsed.errors.map((err, i) => <li key={i}><AlertTriangle size={12} />{err}</li>)}
          </ul>
        )}
        <div className="preview">
          <div className="pv-row pv-head"><span>名称</span><span>版本</span><span>许可证</span><span>渠道</span></div>
          {parsed.rows.slice(0, 6).map((r, i) => (
            <div className="pv-row" key={i}>
              <span>{r.name}</span><span>{r.version}</span><span>{r.license}</span>
              <span>{r.channel ? CHANNELS[r.channel].short : <em className="muted">默认：{CHANNELS[fallback].short}</em>}</span>
            </div>
          ))}
          {parsed.rows.length > 6 && <div className="pv-more">…其余 {parsed.rows.length - 6} 行</div>}
        </div>
        <div className="edit-actions">
          <button className="outline" onClick={onClose}>取消</button>
          <button className="primary" disabled={parsed.rows.length === 0} onClick={doImport}>
            <Upload size={14} />导入 {parsed.rows.length} 项到 {product.name}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 产品规则弹窗 ---------------- */

const VERDICT_CELL: Record<Verdict, { text: string; cls: string }> = {
  allow: { text: '放行', cls: 'allow' },
  block: { text: '阻断', cls: 'block' },
  review: { text: '复核', cls: 'review' },
};

function RulesModal({ product, onClose }: { product: ProductDef; onClose: () => void }) {
  const overrideLicenses = new Set(product.overrides.map((o) => o.license));
  const rules = [...BASELINE_RULES];

  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal wide rules-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{product.name} 产品规则表</h2>
          <button onClick={onClose}>×</button>
        </div>
        <p className="modal-hint">
          判定顺序：<b>产品覆盖规则 → 全局基线规则 → 默认阻断</b>。标「产品」的单元格为该产品政策对基线的覆盖。
        </p>
        {product.overrides.length > 0 && (
          <div className="override-list">
            {product.overrides.map((o) => (
              <div key={o.id} className="override-item">
                <b>{o.id}</b> · {o.license}
                <ul>
                  {CHANNEL_ORDER.filter((c) => o.map[c]).map((c) => (
                    <li key={c}>
                      <i className={`cell-dot ${o.map[c]!.verdict}`} />
                      {CHANNELS[c].short}：{o.map[c]!.basis}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        <div className="rules-matrix">
          <div className="rm-row rm-head">
            <span>许可证</span>
            {CHANNEL_ORDER.map((c) => <span key={c}>{CHANNELS[c].short}</span>)}
          </div>
          {rules.map((r) => (
            <div className="rm-row" key={r.id}>
              <span className="rm-lic">{r.license}</span>
              {CHANNEL_ORDER.map((c) => {
                const over = product.overrides.find((o) => o.license === r.license)?.map[c];
                const v = over ?? r.map[c];
                return (
                  <span key={c} className={`rm-cell ${VERDICT_CELL[v.verdict].cls}`} title={v.basis}>
                    {VERDICT_CELL[v.verdict].text}
                    {overrideLicenses.has(r.license) && over && <i className="rm-prod">产品</i>}
                  </span>
                );
              })}
            </div>
          ))}
          <div className="rm-row">
            <span className="rm-lic">未识别许可</span>
            {CHANNEL_ORDER.map((c) => (
              <span key={c} className="rm-cell review" title="默认策略">复核<i className="rm-prod default-tag">默认</i></span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
