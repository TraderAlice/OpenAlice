import { readFileSync, writeFileSync } from 'node:fs'
import { AnalysisDocumentSchema, FactsDocumentSchema } from '../../../../src/domain/market-brief/schema.ts'
import { validateAnalysisDocument } from '../../../../src/domain/market-brief/analysis.ts'

const dir = new URL('.', import.meta.url)
const factsPath = new URL('./facts.json', dir)
const factsDoc = FactsDocumentSchema.parse(JSON.parse(readFileSync(factsPath, 'utf8')))

const analysis = AnalysisDocumentSchema.parse({
  version: 1,
  asof: '2026-10-01',
  focus_markets: factsDoc.focus_markets,
  facts: factsDoc.facts,
  data_limitations: [
    '北向/沪深港通日终披露本轮未取',
    'A股多日资金流趋势：Tushare 无权限，未取',
    '美股/商品/BTC 为 2026-09-30 盘中延迟源；成交量类指标（含铜异常放量）不采信',
    'traderhub global-macro 各国 CPI 过时，未使用',
    '离岸人民币仅 1 根 K，改用在岸 Yahoo:CNY=X',
    '美光（MU）财报结果与精确发布时间未知',
    '中国「小刺激」与中美减税相关内容仅有 RSS 标题、无正文',
    'FRED 长端利率与 EFFR 点位尚未独立复核（草稿沿用原文）',
    '美元指数序列身份未确认（DXY / DTWEXBGS / UUP）',
  ],
  signals: [
    {
      id: 's1_ust_term_premium',
      title: '美债长端上行与偏软通胀并存',
      conclusion:
        '在核心 PCE 偏软、盈亏平衡通胀平稳的窗口里，长端收益率与美元仍偏强、黄金承压——更宜读作期限溢价/供给压力线索，而非已证实的通胀预期再加速。',
      certainty: 'interpretation',
      confidence: 'medium',
      evidence_ids: [
        'effr_0916',
        'effr_0917',
        'dgs2_0825',
        'dgs2_0928',
        'dgs10_0825',
        'dgs10_0928',
        'dgs30_0825',
        'dgs30_0928',
        'bei10_0929',
        'pce_core_yoy_aug',
        'pce_cons_dow_rss',
        'tnx_0930_intra',
        'tlt_20d_pct_intra',
        'usd_0930_intra',
        'xau_0930_intra',
        'xau_20d_pct_intra',
        'xlu_1m_pct',
        'xlre_1m_pct',
      ],
      interpretation: [
        {
          id: 's1_i0',
          text: '利率敏感美股板块（XLU/XLRE）近 1 个月偏弱，与长端上行方向一致。',
          certainty: 'interpretation',
          evidence_ids: ['xlu_1m_pct', 'xlre_1m_pct', 'dgs10_0928'],
        },
      ],
      hypotheses: [
        {
          id: 's1_h0',
          text: '收益率上行可能主要来自期限溢价与供给压力，而非通胀预期抬升；该因果尚待验证。',
          certainty: 'hypothesis',
          evidence_ids: ['bei10_0929', 'pce_core_yoy_aug', 'dgs10_0928'],
        },
      ],
      watch_points: [
        '美股收盘后 10Y 是否守住 5.2% 以上',
        '美元是否继续创新高',
        '核验 FRED DGS/EFFR 与美元序列身份后再定稿',
      ],
      falsifier: '10Y 明显回落且美元转弱，同时 10Y 盈亏平衡通胀显著走高（通胀预期叙事回潮）',
    },
    {
      id: 's2_cn_us_tech_divergence',
      title: '中美科技走势背离，MU 为节后催化',
      conclusion:
        '9/30 窗口 A 股科创/创业板与东财电子链资金偏弱，同时美股 SMH/MU 偏强——观察到跨市场背离；节后存储/PCB 路径或取决于 MU 指引与 SMH 能否站稳，而非已证明全球半导体周期转弱。',
      certainty: 'interpretation',
      confidence: 'medium',
      evidence_ids: [
        'star50_0930_pct',
        'star50_5d_pct',
        'chinext_5d_pct',
        'em_flow_sw_elec',
        'em_flow_semi',
        'em_flow_memory',
        'smh_0930_intra',
        'smh_20d_pct_intra',
        'mu_20d_pct_intra',
        'mu_earn_cal',
        'cal_cn_holiday',
      ],
      interpretation: [
        {
          id: 's2_i0',
          text: '同一窗口内 A 股科技相关指数/东财主力和美股半导体 ETF 方向不一致，构成背离事实层描述。',
          certainty: 'interpretation',
          evidence_ids: ['star50_5d_pct', 'smh_20d_pct_intra', 'em_flow_semi'],
        },
      ],
      hypotheses: [
        {
          id: 's2_h0',
          text: 'A 股科技偏弱或许更接近节前降仓与本地板块切换，尚不能确认是全球半导体周期转弱。',
          certainty: 'hypothesis',
          evidence_ids: ['star50_5d_pct', 'em_flow_sw_elec', 'smh_20d_pct_intra', 'cal_cn_holiday'],
        },
      ],
      watch_points: ['MU 指引与财报落地', 'SMH 能否站稳 20 日高区域', '10/8 复市后存储/PCB 修复或补跌'],
      falsifier: 'SMH 显著转弱且 MU 指引差，同时节后 A 股存储/PCB 继续破位',
    },
    {
      id: 's3_ashare_rotation_no_fx_stress',
      title: 'A股内部切换，未见汇率同步压力',
      conclusion:
        '9/30 窗口资金更像在 A 股内部从科技切向医药/消费相关（东财主力口径），同时恒指/中资相关 ETF 与在岸人民币未显示同步风险-off；这只支持「本轮窗口未见汇率/离岸压力」，不能升级为「无中国宏观系统性风险」定论。',
      certainty: 'interpretation',
      confidence: 'medium',
      evidence_ids: [
        'csi300_5d_pct',
        'sse_5d_pct',
        'ashare_turnover_0930',
        'em_flow_sw_elec',
        'em_flow_sw_pharma',
        'em_flow_innovative_drug',
        'em_flow_cro',
        'em_flow_maotai_idx',
        'hsi_0930',
        'hsi_0930_pct',
        'hstech_0930_pct',
        'fxi_0930_intra_pct',
        'kweb_0930_intra_pct',
        'cny_0924',
        'cny_0930',
        'usd_0930_intra',
        'limit_up_0930',
        'limit_down_0930',
      ],
      interpretation: [
        {
          id: 's3_i0',
          text: '东财口径下科技相关主力流出与医药等相关流入并存，更接近内部结构切换而非单一「撤离」叙事。',
          certainty: 'interpretation',
          evidence_ids: ['em_flow_sw_elec', 'em_flow_sw_pharma', 'em_flow_innovative_drug'],
        },
      ],
      hypotheses: [
        {
          id: 's3_h0',
          text: '人民币在美元偏强窗口仍略稳，或许说明本轮尚未出现明显汇率压力；该判断仍待更长窗口与离岸数据验证。',
          certainty: 'hypothesis',
          evidence_ids: ['cny_0924', 'cny_0930', 'usd_0930_intra', 'hsi_0930_pct'],
        },
      ],
      watch_points: [
        '10/8 科技 vs 医药相对强弱',
        'CNY 与美元是否继续背离',
        '若获得沪深港通日终，补 flow 证据',
      ],
      falsifier: 'CNY 快速贬值且 HSI/FXI/KWEB 同步大跌，同时医药流入逆转',
    },
  ],
})

const v = validateAnalysisDocument(analysis)
writeFileSync(new URL('./analysis.json', dir), `${JSON.stringify(analysis, null, 2)}\n`)
writeFileSync(
  new URL('./derive.ops.json', dir),
  `${JSON.stringify(
    {
      note: 'After VERIFY: alice brief derive --facts-json-file facts.json --ops-json-file derive.ops.json --output facts.derived.json',
      ops: [
        { op: 'delta_bp', id: 'effr_eff_bp', from_id: 'effr_0916', to_id: 'effr_0917', scale: 100 },
        { op: 'delta_bp', id: 'dgs2_bp', from_id: 'dgs2_0825', to_id: 'dgs2_0928', scale: 100 },
        { op: 'delta_bp', id: 'dgs10_bp', from_id: 'dgs10_0825', to_id: 'dgs10_0928', scale: 100 },
        { op: 'delta_bp', id: 'dgs30_bp', from_id: 'dgs30_0825', to_id: 'dgs30_0928', scale: 100 },
        { op: 'pct_change', id: 'cny_pct', from_id: 'cny_0924', to_id: 'cny_0930' },
      ],
    },
    null,
    2,
  )}\n`,
)

console.log(
  JSON.stringify(
    {
      ok: v.ok,
      errors: v.errors,
      warnings: v.warnings,
      fact_count: v.fact_ids.length,
      signals: v.signal_ids,
    },
    null,
    2,
  ),
)
