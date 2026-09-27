import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Boxes,
  Check,
  Clock3,
  Download,
  FileCode2,
  Hourglass,
  Info,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  CHANNELS,
  LICENSES,
  STORE_KEY,
  Dep,
  Product,
  Status,
  Effective,
  Store,
  buildReport,
  effectiveOf,
  fmtRemain,
  fmtTime,
  loadStore,
  parseList,
  parseManifest,
  uid,
} from './license';

const licColor = (l: string) =>
  l === 'MIT'
    ? '#35b995'
    : l.startsWith('BSD')
      ? '#6d9ee8'
      : /^(GPL|AGPL|LGPL|SSPL)/.test(l)
        ? '#ec8c75'
        : l === 'Apache-2.0'
          ? '#b18ee4'
          : '#8fa0a5';

const DURATIONS = [
  { h: 24, label: '24 小时' },
  { h: 72, label: '3 天' },
  { h: 168, label: '7 天' },
  { h: 720, label: '30 天' },
];

function Pill({ s }: { s: Status }) {
  if (s === 'pass')
    return (
      <span className="status ok">
        <Check size={13} /> 通过
      </span>
    );
  if (s === 'waived')
    return (
      <span className="status waived">
        <Hourglass size={13} /> 放行中
      </span>
    );
  return (
    <span className="status risk">
      <Ban size={13} /> 阻断
    </span>
  );
}

function DetailPanel({
  dep,
  eff,
  now,
  onClose,
  onWaive,
  onRevoke,
  onChannel,
}: {
  dep: Dep;
  eff: Effective;
  now: number;
  onClose: () => void;
  onWaive: (dep: Dep, approver: string, reason: string, hours: number) => void;
  onRevoke: (dep: Dep) => void;
  onChannel: (dep: Dep, channel: string) => void;
}) {
  const [approver, setApprover] = useState('');
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState(72);
  const w = eff.waiver;
  return (
    <div className="detail">
      <div className="detail-head">
        <div className="detail-icon" style={{ background: licColor(dep.license) + '1c', color: licColor(dep.license) }}>
          <FileCode2 size={20} />
        </div>
        <div>
          <span>SELECTED DEPENDENCY</span>
          <h2>{dep.name}</h2>
        </div>
        <button className="close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="detail-grid">
        <div>
          <label>版本</label>
          <b>{dep.version}</b>
        </div>
        <div>
          <label>发布渠道</label>
          <select className="channel-sel" value={dep.channel} onChange={(e) => onChannel(dep, e.target.value)}>
            {CHANNELS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label>许可证</label>
          <b>{dep.license}</b>
        </div>
      </div>
      <p className="channel-hint">
        <Info size={12} /> 结论按「名称 + 版本 + 渠道」判定：同一版本换渠道将按新渠道重新判定，原渠道的放行不随迁。
      </p>

      {eff.status === 'pass' && (
        <div className="finding ok">
          <div className="finding-icon">
            <Check size={16} />
          </div>
          <div>
            <b>规则通过，可随本产品发布</b>
            <p>{eff.basis}。</p>
          </div>
        </div>
      )}

      {eff.status === 'waived' && w && (
        <div className="finding waived">
          <div className="finding-icon">
            <Hourglass size={16} />
          </div>
          <div>
            <b>
              限时放行中 · 剩余 {fmtRemain(w.expiresAt, now)}
              <span className="countdown">
                <Clock3 size={11} /> {fmtTime(w.expiresAt)} 到期
              </span>
            </b>
            <p>
              依据：{w.reason}。到期后自动恢复阻断，仅对「{dep.name}@{dep.version} · {dep.channel}」生效。
            </p>
            <button className="revoke" onClick={() => onRevoke(dep)}>
              撤销放行
            </button>
          </div>
        </div>
      )}

      {eff.status === 'block' && (
        <>
          <div className="finding risk">
            <div className="finding-icon">
              <Ban size={16} />
            </div>
            <div>
              <b>已阻断，不得随本产品发布</b>
              <p>{eff.basis}。</p>
              {eff.expired && (
                <p className="expired-note">
                  上一豁免（{eff.expired.approver}）已于 {fmtTime(eff.expired.expiresAt)} 到期，已自动恢复阻断。
                </p>
              )}
            </div>
          </div>
          <div className="waiver-form">
            <div className="wf-title">
              <Clock3 size={14} /> 逐项限时放行
            </div>
            <input value={approver} onChange={(e) => setApprover(e.target.value)} placeholder="裁定人，如：王岚（安全团队）" />
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="放行依据，如：仅构建期使用，不随安装包分发"
              rows={2}
            />
            <div className="wf-row">
              <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                {DURATIONS.map((d) => (
                  <option key={d.h} value={d.h}>
                    {d.label}
                  </option>
                ))}
              </select>
              <button
                className="primary"
                disabled={!approver.trim() || !reason.trim()}
                onClick={() => {
                  onWaive(dep, approver.trim(), reason.trim(), hours);
                  setApprover('');
                  setReason('');
                }}
              >
                限时放行
              </button>
            </div>
            <small>到期后自动恢复阻断；换版本或换渠道需重新裁定。</small>
          </div>
        </>
      )}

      <div className="full-license">
        <div>
          <Info size={15} />
          <span>判定信息</span>
        </div>
        <p>
          <b>裁定人：</b>
          {eff.decider}
        </p>
        <p>
          <b>依据：</b>
          {eff.basis}
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [store, setStore] = useState<Store>(loadStore);
  const { products, deps, waivers, pid } = store;
  const [sel, setSel] = useState<string>(''); // '' = 未选择
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'全部' | Status>('全部');
  const [modal, setModal] = useState<'none' | 'add' | 'import' | 'rules'>('none');
  const [now, setNow] = useState(() => Date.now());

  // 添加依赖表单
  const [aName, setAName] = useState('');
  const [aVersion, setAVersion] = useState('1.0.0');
  const [aLicense, setALicense] = useState('MIT');
  const [aChannel, setAChannel] = useState(CHANNELS[0]);
  // 导入清单
  const [manifest, setManifest] = useState('');
  // 规则编辑
  const [rAllow, setRAllow] = useState('');
  const [rDeny, setRDeny] = useState('');
  const [rChannel, setRChannel] = useState<Record<string, string>>({});

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }, [store]);

  const product = products.find((p) => p.id === pid) || products[0];
  const pdeps = useMemo(() => deps.filter((d) => d.productId === product.id), [deps, product.id]);
  const effOf = (d: Dep) => effectiveOf(product, d, waivers, now);

  const counts: Record<Status, number> = { pass: 0, waived: 0, block: 0 };
  pdeps.forEach((d) => counts[effOf(d).status]++);
  const waivedExps = pdeps.map((d) => effOf(d).waiver?.expiresAt).filter((t): t is number => !!t);
  const nearestExp = waivedExps.length ? Math.min(...waivedExps) : 0;
  const expiredCount = pdeps.filter((d) => effOf(d).expired).length;
  const pct = pdeps.length ? Math.round((counts.pass / pdeps.length) * 100) : 100;

  const filtered = pdeps.filter(
    (d) =>
      (filter === '全部' || effOf(d).status === filter) &&
      `${d.name}${d.license}${d.channel}${d.version}`.toLowerCase().includes(query.toLowerCase()),
  );
  const current = (sel && pdeps.find((d) => d.id === sel)) || null;

  const blockCountOf = (p: Product) =>
    deps.filter((d) => d.productId === p.id && effectiveOf(p, d, waivers, now).status === 'block').length;

  const update = (fn: (s: Store) => Store) => setStore((s) => fn(s));
  const switchProduct = (id: string) => {
    update((s) => ({ ...s, pid: id }));
    setSel('');
    setFilter('全部');
    setQuery('');
  };
  const addDep = () => {
    if (!aName.trim()) return;
    const nd: Dep = {
      id: uid(),
      productId: product.id,
      name: aName.trim(),
      version: aVersion.trim() || '1.0.0',
      license: aLicense,
      channel: aChannel,
    };
    update((s) => ({ ...s, deps: [...s.deps, nd] }));
    setSel(nd.id);
    setAName('');
    setModal('none');
  };
  const parsed = useMemo(() => parseManifest(manifest), [manifest]);
  const importDeps = () => {
    if (!parsed.length) return;
    const nds = parsed.map((o) => ({ ...o, id: uid(), productId: product.id }));
    update((s) => ({ ...s, deps: [...s.deps, ...nds] }));
    setManifest('');
    setModal('none');
  };
  const waive = (dep: Dep, approver: string, reason: string, hours: number) => {
    const w = {
      id: uid(),
      productId: product.id,
      name: dep.name,
      version: dep.version,
      channel: dep.channel,
      approver,
      reason,
      createdAt: Date.now(),
      expiresAt: Date.now() + hours * 3.6e6,
    };
    update((s) => ({
      ...s,
      waivers: [
        ...s.waivers.filter(
          (o) => !(o.productId === w.productId && o.name === w.name && o.version === w.version && o.channel === w.channel),
        ),
        w,
      ],
    }));
  };
  const revoke = (dep: Dep) =>
    update((s) => ({
      ...s,
      waivers: s.waivers.filter(
        (o) => !(o.productId === product.id && o.name === dep.name && o.version === dep.version && o.channel === dep.channel),
      ),
    }));
  const changeChannel = (dep: Dep, channel: string) =>
    update((s) => ({ ...s, deps: s.deps.map((d) => (d.id === dep.id ? { ...d, channel } : d)) }));
  const openRules = () => {
    setRAllow(product.allow.join(' '));
    setRDeny(product.deny.join(' '));
    setRChannel(Object.fromEntries(CHANNELS.map((c) => [c, (product.channelDeny[c] || []).join(' ')])));
    setModal('rules');
  };
  const saveRules = () => {
    const channelDeny: Record<string, string[]> = {};
    CHANNELS.forEach((c) => {
      const list = parseList(rChannel[c] || '');
      if (list.length) channelDeny[c] = list;
    });
    update((s) => ({
      ...s,
      products: s.products.map((p) =>
        p.id === product.id ? { ...p, allow: parseList(rAllow), deny: parseList(rDeny), channelDeny } : p,
      ),
    }));
    setModal('none');
  };
  const exportReport = () => {
    const md = buildReport(product, pdeps, waivers, now);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `${product.code}-license-report.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <div className="brand-icon">
            <ShieldCheck size={18} />
          </div>
          <div>
            <b>License Lens</b>
            <small>product-level review</small>
          </div>
        </div>
        <div className="nav-title">PRODUCTS</div>
        {products.map((p) => (
          <button key={p.id} className={p.id === product.id ? 'nav active' : 'nav'} onClick={() => switchProduct(p.id)}>
            <Boxes size={16} />
            {p.name}
            {blockCountOf(p) > 0 && <span className="red">{blockCountOf(p)}</span>}
          </button>
        ))}
        <div className="nav-title">审查台</div>
        <button className={filter === '全部' ? 'nav active' : 'nav'} onClick={() => setFilter('全部')}>
          <FileCode2 size={16} />
          依赖清单 <span>{pdeps.length}</span>
        </button>
        <button className={filter === 'block' ? 'nav active' : 'nav'} onClick={() => setFilter('block')}>
          <AlertTriangle size={16} />
          阻断待清 <span className="red">{counts.block}</span>
        </button>
        <button className={filter === 'waived' ? 'nav active' : 'nav'} onClick={() => setFilter('waived')}>
          <Hourglass size={16} />
          限时放行中 <span>{counts.waived}</span>
        </button>
        <div className="aside-bottom">
          <div className="mini-card">
            <Sparkles size={16} />
            <div>
              <b>进度已保存</b>
              <small>关闭页面后重开可继续审查</small>
            </div>
          </div>
          <div className="user">
            <div className="avatar">ZL</div>
            <span>Zen Li</span>
          </div>
        </div>
      </aside>

      <main>
        <header>
          <div>
            <div className="crumb">
              PRODUCT / <b>{product.code}</b>
            </div>
            <h1>产品级许可证审查</h1>
            <p>
              {product.name} · {product.desc}
            </p>
          </div>
          <div className="head-actions">
            <button className="outline" onClick={() => setModal('import')}>
              <Upload size={15} />
              导入清单
            </button>
            <button className="outline" onClick={openRules}>
              <SlidersHorizontal size={15} />
              产品规则
            </button>
            <button className="outline" onClick={exportReport}>
              <Download size={15} />
              导出报告
            </button>
            <button className="primary" onClick={() => setModal('add')}>
              <Plus size={16} />
              添加依赖
            </button>
          </div>
        </header>

        <section className="hero">
          <div>
            <span className="tag">PRODUCT · {product.code}</span>
            <h2>{counts.block ? '阻断未清，暂缓发布。' : '发布前，再确认一次。'}</h2>
            <p>
              已审查 <b>{pdeps.length} 个依赖</b>，<b className="warning">{counts.block} 项阻断</b>待清，
              <b>{counts.waived} 项</b>限时放行中。
            </p>
          </div>
          <div className="scan-score">
            <div className="score-ring">
              <strong>
                {pct}
                <small>%</small>
              </strong>
            </div>
            <div>
              <span>规则通过率</span>
              <b>{counts.block === 0 ? '可发布' : '暂不可发布'}</b>
              <small>结论随规则与豁免实时更新</small>
            </div>
          </div>
        </section>

        <section className="summary">
          <div>
            <span>全部依赖</span>
            <b>{pdeps.length}</b>
            <small>按产品隔离审查</small>
          </div>
          <div>
            <span>规则通过</span>
            <b className="teal">{counts.pass}</b>
            <small>产品规则直接放行</small>
          </div>
          <div>
            <span>限时放行中</span>
            <b className="orange">{counts.waived}</b>
            <small>{nearestExp ? `最近到期 ${fmtRemain(nearestExp, now)}` : '无进行中的豁免'}</small>
          </div>
          <div>
            <span>阻断待清</span>
            <b className="red">{counts.block}</b>
            <small>{expiredCount ? `含 ${expiredCount} 项豁免已过期` : '到期自动恢复阻断'}</small>
          </div>
        </section>

        <section className="workspace">
          <div className="table-pane">
            <div className="pane-head">
              <div>
                <h2>依赖清单</h2>
                <p>结论按 名称 + 版本 + 渠道 判定</p>
              </div>
              <div className="tools">
                <div className="search">
                  <Search size={15} />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索依赖" />
                </div>
                <select value={filter} onChange={(e) => setFilter(e.target.value as '全部' | Status)}>
                  <option value="全部">全部结论</option>
                  <option value="pass">通过</option>
                  <option value="waived">放行中</option>
                  <option value="block">阻断</option>
                </select>
              </div>
            </div>
            <div className="table">
              <div className="tr th">
                <span>依赖名称</span>
                <span>版本</span>
                <span>渠道</span>
                <span>许可证</span>
                <span>有效结论</span>
              </div>
              {filtered.map((d) => {
                const e = effOf(d);
                return (
                  <button className={d.id === sel ? 'tr selected' : 'tr'} key={d.id} onClick={() => setSel(d.id)}>
                    <span className="dep-name">
                      <span className="pkg-dot" /> {d.name}
                    </span>
                    <span className="muted">{d.version}</span>
                    <span className="muted">{d.channel}</span>
                    <span>
                      <i className="license" style={{ color: licColor(d.license), background: licColor(d.license) + '18' }}>
                        {d.license}
                      </i>
                    </span>
                    <Pill s={e.status} />
                  </button>
                );
              })}
              {!filtered.length && <div className="empty-row">没有匹配的依赖</div>}
            </div>
          </div>

          {current ? (
            <DetailPanel
              key={current.id}
              dep={current}
              eff={effOf(current)}
              now={now}
              onClose={() => setSel('')}
              onWaive={waive}
              onRevoke={revoke}
              onChannel={changeChannel}
            />
          ) : (
            <div className="detail empty">
              <Info size={18} />
              <p>选择左侧依赖，查看判定依据、裁定人，或对阻断项做限时放行。</p>
            </div>
          )}
        </section>
      </main>

      {modal === 'add' && (
        <div className="backdrop" onClick={() => setModal('none')}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>添加依赖 · {product.name}</h2>
              <button onClick={() => setModal('none')}>×</button>
            </div>
            <label>
              依赖名称
              <input autoFocus value={aName} onChange={(e) => setAName(e.target.value)} placeholder="例如 date-fns" />
            </label>
            <label>
              版本
              <input value={aVersion} onChange={(e) => setAVersion(e.target.value)} placeholder="1.0.0" />
            </label>
            <label>
              许可证
              <select value={aLicense} onChange={(e) => setALicense(e.target.value)}>
                {LICENSES.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
            <label>
              发布渠道
              <select value={aChannel} onChange={(e) => setAChannel(e.target.value)}>
                {CHANNELS.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <button className="primary full" onClick={addDep}>
              加入审查
            </button>
          </div>
        </div>
      )}

      {modal === 'import' && (
        <div className="backdrop" onClick={() => setModal('none')}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>导入清单 · {product.name}</h2>
              <button onClick={() => setModal('none')}>×</button>
            </div>
            <p className="modal-hint">
              自动识别名称、版本、许可证和渠道。每行一条：<code>name@version 许可证 渠道</code>
              ，或用逗号分隔，也可粘贴 JSON 数组。渠道：{CHANNELS.join(' / ')}。
            </p>
            <textarea
              className="manifest"
              autoFocus
              rows={7}
              value={manifest}
              onChange={(e) => setManifest(e.target.value)}
              placeholder={'react@18.3.1 MIT npm 官方\nhighlight.js,11.10.0,BSD-3-Clause,CDN'}
            />
            <button className="primary full" disabled={!parsed.length} onClick={importDeps}>
              导入 {parsed.length ? `${parsed.length} 项` : ''}
            </button>
          </div>
        </div>
      )}

      {modal === 'rules' && (
        <div className="backdrop" onClick={() => setModal('none')}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>产品规则 · {product.name}</h2>
              <button onClick={() => setModal('none')}>×</button>
            </div>
            <label>
              允许的许可证（空格或逗号分隔）
              <input value={rAllow} onChange={(e) => setRAllow(e.target.value)} />
            </label>
            <label>
              禁止的许可证
              <input value={rDeny} onChange={(e) => setRDeny(e.target.value)} />
            </label>
            <div className="nav-title" style={{ padding: '10px 0 4px', color: '#9aa8ac' }}>
              渠道级禁令
            </div>
            {CHANNELS.map((c) => (
              <label key={c}>
                {c} 额外禁止
                <input
                  value={rChannel[c] || ''}
                  onChange={(e) => setRChannel((m) => ({ ...m, [c]: e.target.value }))}
                  placeholder="留空表示不额外限制"
                />
              </label>
            ))}
            <p className="modal-hint">保存后全部依赖立即按新规则重判；未过期的逐项放行仍按 名称+版本+渠道 匹配生效。</p>
            <button className="primary full" onClick={saveRules}>
              保存并重判
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
