import type {
  BaselineRule,
  ChannelId,
  Item,
  ProductDef,
} from './types';

export const CHANNELS: Record<ChannelId, { label: string; short: string; aliases: string[] }> = {
  store: { label: '应用商店分发', short: '商店', aliases: ['store', 'appstore', '应用商店', '商店', 'app-store'] },
  onprem: { label: '客户现场 / 私有化', short: '私有化', aliases: ['onprem', 'on-prem', 'on-premise', 'onpremise', '私有化', '现场', '客户现场'] },
  saas: { label: 'SaaS / 云端服务', short: 'SaaS', aliases: ['saas', 'cloud', '云端', '云服务', '在线服务'] },
  oss: { label: '开源仓库发布', short: '开源', aliases: ['oss', 'opensource', 'open-source', '开源', '开源仓库', 'github'] },
};

export const CHANNEL_ORDER: ChannelId[] = ['store', 'onprem', 'saas', 'oss'];

const A: Record<ChannelId, RuleEntryLike> = {
  store: { verdict: 'allow', basis: '宽松型许可，各渠道分发均无 copyleft 义务（保留版权与许可声明即可）' },
  onprem: { verdict: 'allow', basis: '宽松型许可，各渠道分发均无 copyleft 义务（保留版权与许可声明即可）' },
  saas: { verdict: 'allow', basis: '宽松型许可，各渠道分发均无 copyleft 义务（保留版权与许可声明即可）' },
  oss: { verdict: 'allow', basis: '宽松型许可，各渠道分发均无 copyleft 义务（保留版权与许可声明即可）' },
};

type RuleEntryLike = { verdict: 'allow' | 'block' | 'review'; basis: string };

/**
 * 全局基线规则。产品没有覆盖时，按许可证 + 渠道在此查表。
 */
export const BASELINE_RULES: BaselineRule[] = [
  { id: 'BL-MIT', license: 'MIT', map: A },
  { id: 'BL-BSD3', license: 'BSD-3-Clause', map: A },
  { id: 'BL-APACHE2', license: 'Apache-2.0', map: A },
  { id: 'BL-ISC', license: 'ISC', map: A },
  {
    id: 'BL-MPL2',
    license: 'MPL-2.0',
    map: {
      store: { verdict: 'review', basis: 'MPL-2.0 文件级弱 copyleft：商店二进制分发须提供被修改 MPL 文件源码' },
      onprem: { verdict: 'review', basis: 'MPL-2.0 文件级弱 copyleft：私有化交付须提供被修改 MPL 文件源码' },
      saas: { verdict: 'allow', basis: 'MPL-2.0 不把网络使用视为分发，SaaS 场景无需开源外围代码' },
      oss: { verdict: 'allow', basis: '以开源形式发布，与 MPL-2.0 兼容' },
    },
  },
  {
    id: 'BL-LGPL21',
    license: 'LGPL-2.1',
    map: {
      store: { verdict: 'block', basis: 'LGPL-2.1 要求允许终端用户替换库版本，商店闭源捆绑分发难以满足' },
      onprem: { verdict: 'review', basis: 'LGPL-2.1 动态链接 + 提供可替换机制可接受，须法务确认链接方式' },
      saas: { verdict: 'review', basis: 'LGPL-2.1 对自有进程动态链接较宽松，须法务确认链接方式' },
      oss: { verdict: 'allow', basis: '以开源形式发布，与 LGPL-2.1 兼容' },
    },
  },
  {
    id: 'BL-GPL2',
    license: 'GPL-2.0',
    map: {
      store: { verdict: 'block', basis: 'GPL-2.0 强 copyleft：随产品分发触发整体开源义务，与闭源商店分发冲突' },
      onprem: { verdict: 'block', basis: 'GPL-2.0 强 copyleft：向客户交付二进制触发整体开源义务' },
      saas: { verdict: 'review', basis: 'GPL-2.0 未把网络使用视为分发，但二次开发/内嵌须法务确认' },
      oss: { verdict: 'allow', basis: '以 GPL 兼容许可开源发布，满足 copyleft 要求' },
    },
  },
  {
    id: 'BL-GPL3',
    license: 'GPL-3.0',
    map: {
      store: { verdict: 'block', basis: 'GPL-3.0 强 copyleft 且含反 Tivoization 条款，与闭源商店分发冲突' },
      onprem: { verdict: 'block', basis: 'GPL-3.0 强 copyleft：向客户交付二进制触发整体开源义务' },
      saas: { verdict: 'review', basis: 'GPL-3.0 未把网络使用视为分发，但二次开发/内嵌须法务确认' },
      oss: { verdict: 'allow', basis: '以 GPL 兼容许可开源发布，满足 copyleft 要求' },
    },
  },
  {
    id: 'BL-AGPL3',
    license: 'AGPL-3.0',
    map: {
      store: { verdict: 'block', basis: 'AGPL-3.0 网络交互即触发开源义务，闭源商业分发禁止' },
      onprem: { verdict: 'block', basis: 'AGPL-3.0 交付即触发整体源码提供义务，闭源交付禁止' },
      saas: { verdict: 'block', basis: 'AGPL-3.0 网络服务条款：SaaS 用户可索取完整对应源码，禁止闭源商用' },
      oss: { verdict: 'allow', basis: '以 AGPL 兼容许可开源发布，满足 copyleft 要求' },
    },
  },
  {
    id: 'BL-SSPL',
    license: 'SSPL-1.0',
    map: {
      store: { verdict: 'block', basis: 'SSPL-1.0 要求开源整个服务栈，OSI 不认可为开源许可，禁止闭源商用' },
      onprem: { verdict: 'block', basis: 'SSPL-1.0 要求开源整个服务栈，私有化商业交付禁止' },
      saas: { verdict: 'block', basis: 'SSPL-1.0 服务端 copyleft 覆盖整个 SaaS 服务栈，禁止直接提供服务' },
      oss: { verdict: 'allow', basis: '以开源形式发布不构成商用服务，许可兼容' },
    },
  },
  {
    id: 'BL-BUSL',
    license: 'BUSL-1.1',
    map: {
      store: { verdict: 'review', basis: 'BUSL-1.1 为源码可得但限制商业用途，须核对 Change Date 与 Additional Use Grant' },
      onprem: { verdict: 'review', basis: 'BUSL-1.1 商业用途受限，私有化交付须法务确认授权范围' },
      saas: { verdict: 'review', basis: 'BUSL-1.1 限制竞争性商业使用，SaaS 提供须法务确认' },
      oss: { verdict: 'allow', basis: '非商业开源发布在 BUSL-1.1 允许范围内' },
    },
  },
];

export const PRODUCTS: ProductDef[] = [
  {
    id: 'aurora-web',
    code: 'AURORA-WEB',
    name: 'Aurora Web',
    desc: '闭源商业 SaaS 平台',
    overrides: [
      {
        id: 'PR-AWEB-GPL3',
        license: 'GPL-3.0',
        map: {
          // 公司政策：闭源 SaaS 不接受 GPL 组件内嵌，比基线更严
          saas: { verdict: 'block', basis: '产品政策 AWEB-PL-02：闭源 SaaS 禁止内嵌 GPL 组件，即使不分发也需隔离为独立进程并经法务审批' },
        },
      },
      {
        id: 'PR-AWEB-LGPL21',
        license: 'LGPL-2.1',
        map: {
          saas: { verdict: 'allow', basis: '产品政策 AWEB-PL-03：SaaS 端动态链接 LGPL 库已通过架构评审（独立 .so，可替换）' },
        },
      },
    ],
  },
  {
    id: 'aurora-desktop',
    code: 'AURORA-DESKTOP',
    name: 'Aurora Desktop',
    desc: '桌面端，应用商店 + 私有化交付',
    overrides: [
      {
        id: 'PR-ADESK-LGPL21',
        license: 'LGPL-2.1',
        map: {
          // 商店渠道基线阻断；桌面版带动态加载器，允许用户替换，降到需复核
          store: { verdict: 'review', basis: '产品政策 ADESK-PL-01：安装包以动态库形式提供 LGPL 组件并附替换指引，发版前须法务复核替换机制' },
        },
      },
      {
        id: 'PR-ADESK-MPL2',
        license: 'MPL-2.0',
        map: {
          store: { verdict: 'allow', basis: '产品政策 ADESK-PL-04：已随安装包公开全部 MPL 文件修改源码（NOTICE 中附归档地址）' },
        },
      },
    ],
  },
  {
    id: 'aurora-edge',
    code: 'AURORA-EDGE',
    name: 'Aurora Edge',
    desc: '私有化部署的边缘网关',
    overrides: [
      {
        id: 'PR-AEDGE-MPL2',
        license: 'MPL-2.0',
        map: {
          // 私有化固件无法向客户交付文件源码归档，比基线更严，直接阻断
          onprem: { verdict: 'block', basis: '产品政策 AEDGE-PL-01：边缘固件为只读镜像，无法满足 MPL-2.0 修改文件源码提供义务' },
        },
      },
      {
        id: 'PR-AEDGE-BUSL',
        license: 'BUSL-1.1',
        map: {
          onprem: { verdict: 'block', basis: '产品政策 AEDGE-PL-02：私有化镜像内含 BUSL 限制用途组件，Change Date 未到且无商业授权' },
        },
      },
    ],
  },
];

/** 首次使用时灌入的清单，便于演示「同版本不同渠道结论不同」等场景 */
export function seedItems(): Item[] {
  const mk = (
    productId: string,
    name: string,
    version: string,
    license: string,
    channel: ChannelId,
  ): Item => ({ id: `${productId}:${name}@${version}:${channel}`, productId, name, version, license, channel });

  return [
    // Aurora Web —— SaaS 渠道
    mk('aurora-web', 'react', '18.3.1', 'MIT', 'saas'),
    mk('aurora-web', 'lodash', '4.17.21', 'MIT', 'saas'),
    mk('aurora-web', 'chart.js', '4.4.4', 'MIT', 'saas'),
    mk('aurora-web', 'highlight.js', '11.10.0', 'BSD-3-Clause', 'saas'),
    mk('aurora-web', 'pdf-viewer', '3.2.0', 'LGPL-2.1', 'saas'),
    mk('aurora-web', 'legacy-parser', '2.1.0', 'GPL-3.0', 'saas'),
    mk('aurora-web', 'metrics-agent', '5.0.3', 'AGPL-3.0', 'saas'),
    mk('aurora-web', 'template-lib', '0.9.7', 'Unknown', 'saas'),

    // Aurora Desktop —— 同一 code-fmt 2.4.1 同版本走两个渠道，结论不同
    mk('aurora-desktop', 'react', '18.3.1', 'MIT', 'store'),
    mk('aurora-desktop', 'electron', '31.4.0', 'MIT', 'store'),
    mk('aurora-desktop', 'pdf-viewer', '3.2.0', 'LGPL-2.1', 'store'),
    mk('aurora-desktop', 'code-fmt', '2.4.1', 'GPL-2.0', 'store'),
    mk('aurora-desktop', 'code-fmt', '2.4.1', 'GPL-2.0', 'oss'),
    mk('aurora-desktop', 'mp4-muxer', '1.8.2', 'MPL-2.0', 'store'),
    mk('aurora-desktop', 'usb-bridge', '1.2.0', 'LGPL-2.1', 'onprem'),
    mk('aurora-desktop', 'cracked-sdk', '0.4.0', 'Unknown', 'store'),

    // Aurora Edge —— 私有化渠道，规则最严
    mk('aurora-edge', 'openssl', '3.0.14', 'Apache-2.0', 'onprem'),
    mk('aurora-edge', 'mosquitto', '2.0.18', 'BSD-3-Clause', 'onprem'),
    mk('aurora-edge', 'edge-router', '4.1.0', 'MPL-2.0', 'onprem'),
    mk('aurora-edge', 'timeseries-core', '7.8.0', 'SSPL-1.0', 'onprem'),
    mk('aurora-edge', 'scheduler-lite', '0.11.2', 'BUSL-1.1', 'onprem'),
    mk('aurora-edge', 'vendor-blob', '9.0.0', 'Unknown', 'onprem'),
  ];
}
