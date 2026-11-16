const state = {
  snapshot: null,
  projectId: null,
  sessionId: null,
  evidenceLane: null,
  catalog: "studies",
  factorView: "ic",
  factorHorizon: "1",
  factorSplit: "validation",
  factorStability: "regimes",
  portfolioView: "performance",
  attributionSplit: "validation",
  lifecycleSplit: "validation",
  parameterSplit: "validation",
  rlView: "performance",
  rlSplit: "validation",
  matrixView: "selection",
  inspectorOpen: false,
  autoRefresh: true,
  loading: false,
  timer: null,
};

const element = (id) => document.getElementById(id);
const studio = element("studio");
const syncState = element("sync-state");

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

const normalizedStatus = (value) =>
  String(value ?? "unknown").toLowerCase().replaceAll(" ", "_");

const metric = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  const number = Number(value);
  if (Math.abs(number) >= 1000) return number.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return number.toLocaleString(undefined, { maximumFractionDigits: 4 });
};

const horizonPolicyText = (request) => {
  const event = request?.eventPolicy;
  if (event) {
    return `event t · entry t+${event.waitBars} · exit t+${event.waitBars + event.holdingBars} · fixed event policy`;
  }
  const policy = request?.horizonPolicy;
  if (!policy) return "reference default · primary 1 · diagnostics 1/5/10 bars";
  return `primary ${policy.primaryForwardBars} · diagnostics ${policy.diagnosticForwardBars.join("/")} bars`;
};

const datasetProviderClaim = (dataset) =>
  Array.isArray(dataset?.sources)
    ? dataset.sources.map((source) => source.provider.name).join(" + ")
    : dataset?.provider?.name ?? "unknown";

const percent = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  return `${metric(Number(value) * 100)}%`;
};

const reportDecisionProof = (report) => {
  const support = report?.leaderDecisionSupport;
  const portfolio = support?.portfolio;
  const factor = support?.factor;
  const rl = support?.rl;
  if (!support?.available) return "";
  if (factor) {
    return `
      <div class="report-decision-proof">
        <small>Frozen factor qualification</small>
        <b>${escapeHtml(factor.stage)} · focus ${escapeHtml(factor.iterationFocus)}</b>
        <span>${escapeHtml(factor.claim)}${factor.knownStyle ? ` · ${escapeHtml(factor.knownStyle)}` : ""} · ${escapeHtml(factor.dominantStyle)} comparison · raw → neutral IC ${signedMetric(factor.rawRankIc)} → ${signedMetric(factor.styleNeutralRankIc)}</span>
        <span>style → equal blend IC ${signedMetric(factor.styleRankIc)} → ${signedMetric(factor.blendRankIc)} · uplift ${signedMetric(factor.blendUpliftVsStyle)}</span>
        <span>worst residual fold ${escapeHtml(factor.weakestStyleNeutralFold)} ${signedMetric(factor.weakestStyleNeutralFoldIc)} · validation diagnosis · authority none</span>
      </div>`;
  }
  if (rl) {
    return `
      <div class="report-decision-proof">
        <small>Frozen RL factor-fusion diagnosis</small>
        <b>${escapeHtml(rl.stage)} · focus ${escapeHtml(rl.iterationFocus)}</b>
        <span>${escapeHtml(rl.candidateAssessment)} · candidate fixed Δ Sharpe ${signedMetric(rl.candidateFixedSharpeDeltaVsBalanced)} · local Δ reward ${signedMetric(rl.candidateLocalRewardDeltaVsBalanced)}</span>
        <span>gross ${signedPercent(rl.grossActiveReturn)} · cost ${signedPercent(rl.incrementalCost)} · net ${signedPercent(rl.netActiveReturn)} · Sharpe Δ ${signedMetric(rl.sharpeAdvantage)}</span>
        <span>${percent(rl.positiveNetTrialRate)} positive net trials · worst ${escapeHtml(rl.worstRegime)} · ${escapeHtml(rl.worstActionPair)} · authority none</span>
      </div>`;
  }
  if (!portfolio) return "";
  const sizing = portfolio.sizing;
  const diversification = portfolio.diversification;
  const viability = portfolio.viability;
  const monetization = portfolio.monetization;
  return `
    <div class="report-decision-proof">
      <small>Frozen leader decision · ${escapeHtml(portfolio.timestamp)}</small>
      <b>${portfolio.stateChanges} state change${portfolio.stateChanges === 1 ? "" : "s"} · ${percent(portfolio.proposedOneWayTurnover)} proposed / ${percent(portfolio.noTradeOneWay)} band</b>
      <span>${escapeHtml(portfolio.family)} · ${escapeHtml(portfolio.reason)} · authority none</span>
      ${sizing ? `<span>${sizing.atCapAssets} at cap · component-risk HHI ${metric(sizing.componentRiskConcentrationHhi)} · largest ${escapeHtml(sizing.largestAbsoluteComponentRiskContributor ?? "unavailable")}</span>` : ""}
      ${diversification ? `<span>${metric(diversification.effectiveRiskBets)} effective risk bets · sample/perfect-correlation vol ${percent(diversification.sampleForecastAnnualized)} / ${percent(diversification.perfectCorrelationForecastAnnualized)} · breach ${String(diversification.stressBreachesCeiling)}</span>` : ""}
      ${viability ? `<span>${escapeHtml(viability.stage)} · focus ${escapeHtml(viability.iterationFocus)} · gross/net Sharpe ${metric(viability.grossSharpe)} / ${metric(viability.netSharpe)}</span>` : ""}
      ${monetization ? `<span>${escapeHtml(monetization.outcome)} · largest adverse ${escapeHtml(monetization.largestAdverseStage)} ${signedPercent(monetization.largestAdverseAnnualizedDelta)} annualized additive</span>` : ""}
    </div>`;
};

const capital = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  const number = Number(value);
  const magnitude = Math.abs(number);
  if (magnitude >= 1e9) return `$${metric(number / 1e9)}B`;
  if (magnitude >= 1e6) return `$${metric(number / 1e6)}M`;
  if (magnitude >= 1e3) return `$${metric(number / 1e3)}K`;
  return `$${metric(number)}`;
};

const probabilityMetric = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  const number = Number(value);
  if (number !== 0 && Math.abs(number) < 0.0001) {
    return number.toExponential(2);
  }
  return metric(number);
};

const selectionEvidence = (integrity) => {
  const family = integrity?.researchFamily ?? null;
  const adjustment = integrity?.selectionAdjustment ?? null;
  if (!family || !adjustment) {
    return {
      family,
      adjustment,
      label: "NOT AVAILABLE",
      tone: "blocked",
    };
  }
  if (adjustment.status !== "available") {
    return {
      family,
      adjustment,
      label: "UNSUPPORTED",
      tone: "blocked",
    };
  }
  return {
    family,
    adjustment,
    label: adjustment.passes ? "SURVIVES 95%" : "BELOW 95%",
    tone: adjustment.passes ? "active" : "adverse",
  };
};

const selectionContext = (integrity) => {
  const evidence = selectionEvidence(integrity);
  if (!evidence.family) return "selection adjustment unavailable";
  return (
    `${evidence.family.uniqueSourceTrials} family trial` +
    `${evidence.family.uniqueSourceTrials === 1 ? "" : "s"} · ` +
    `${evidence.label.toLowerCase()}`
  );
};

const testExposureContext = (integrity) =>
  integrity.testExposureState ?? integrity.testRole;

const selectionRiskSection = (integrity) => {
  const evidence = selectionEvidence(integrity);
  const family = evidence.family;
  const adjustment = evidence.adjustment;
  if (!family || !adjustment) return "";
  const statistics = adjustment.statistics;
  let statisticalRows = "";
  if (adjustment.method === "bonferroni-hac-v1" && statistics) {
    statisticalRows = `
      <dt>Raw HAC p</dt><dd>${probabilityMetric(statistics.rawHacPValue)}</dd>
      <dt>Adjusted p</dt><dd>${probabilityMetric(statistics.familywiseAdjustedPValue)}</dd>
      <dt>Family confidence</dt><dd>${percent(statistics.familywiseConfidence)}</dd>`;
  } else if (
    adjustment.method === "deflated-sharpe-ratio-v1" &&
    statistics
  ) {
    statisticalRows = `
      <dt>PSR / DSR</dt><dd>${percent(statistics.probabilisticSharpeProbability)} / ${percent(statistics.deflatedSharpeProbability)}</dd>
      <dt>Sharpe observed / expected max</dt><dd>${metric(statistics.observedAnnualizedSharpe)} / ${metric(statistics.expectedMaximumAnnualizedSharpe)}</dd>
      <dt>Track record</dt><dd>${statistics.observations} / ${statistics.minimumTrackRecordObservations ?? "unreachable"} required</dd>`;
  } else if (adjustment.reason) {
    statisticalRows = `
      <dt>Reason</dt><dd>${escapeHtml(adjustment.reason)}</dd>`;
  }
  return `
    <section class="inspector-section selection-risk">
      <small>Selection risk · diagnostic only</small>
      <h3>${escapeHtml(adjustment.method ?? "No valid single-path adjustment")}</h3>
      <span class="status-chip ${evidence.tone}">${escapeHtml(evidence.label)}</span>
      <dl class="inspector-kv">
        <dt>Research family</dt><dd title="${escapeHtml(family.id)}">${escapeHtml(family.id)}</dd>
        <dt>Unique trials</dt><dd>${family.uniqueSourceTrials}</dd>
        <dt>Executions / duplicates</dt><dd>${family.totalExecutions} / ${family.duplicateExecutions}</dd>
        <dt>Reproducible</dt><dd>${family.reproducible ? "yes" : "no"}</dd>
        <dt>Test exposure</dt><dd>${escapeHtml(testExposureContext(integrity))}</dd>
        <dt>Post-audit candidate iterations</dt><dd>${integrity.postAuditCandidateIterations ?? "unknown"}</dd>
        <dt>Actual test guidance</dt><dd>${escapeHtml(integrity.testGuidanceObservability ?? "not recorded")}</dd>
        ${statisticalRows}
      </dl>
      <p>${escapeHtml(adjustment.interpretation ?? "Core published the selection-adjustment evidence shown above.")} Project-wide fixed-evaluation family; restarting a Session does not reset the trial count.</p>
    </section>`;
};

const signedPercent = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  const number = Number(value) * 100;
  return `${number > 0 ? "+" : ""}${metric(number)}%`;
};

const signedMetric = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "—";
  }
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${metric(number)}`;
};

const valueTone = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number >= 0) return "";
  return "bad";
};

const latestSuccessfulRun = (project) =>
  project.runs
    .slice()
    .reverse()
    .find((run) => run.status === "succeeded" && run.metricLayers) ?? null;

const projectFocusLane = (project) => {
  const program = project.researchProgramStatus;
  if (!program) return null;
  return (
    program.lanes.find((lane) => lane.id === program.recommendedLaneId) ??
    program.lanes[0] ??
    null
  );
};

const projectFocusRun = (project) => {
  if (!project.researchProgramStatus && project.bookPathStressExplorer?.run?.id) {
    const descriptive = project.runs.find(
      (item) => item.id === project.bookPathStressExplorer.run.id,
    );
    if (descriptive?.status === "succeeded") return descriptive;
  }
  if (!project.researchProgramStatus && project.allocationExplorer?.run?.id) {
    const allocation = project.runs.find(
      (item) => item.id === project.allocationExplorer.run.id,
    );
    if (allocation?.status === "succeeded") return allocation;
  }
  if (!project.researchProgramStatus && project.eventStudyExplorer?.run?.id) {
    const descriptive = project.runs.find(
      (item) => item.id === project.eventStudyExplorer.run.id,
    );
    if (descriptive?.status === "succeeded") return descriptive;
  }
  if (!project.researchProgramStatus && project.bookRiskExplorer?.run?.id) {
    const descriptive = project.runs.find(
      (item) => item.id === project.bookRiskExplorer.run.id,
    );
    if (descriptive?.status === "succeeded") return descriptive;
  }
  const lane = projectFocusLane(project);
  if (lane?.latestRun?.id) {
    const run = project.runs.find((item) => item.id === lane.latestRun.id);
    if (run?.status === "succeeded" && run.metricLayers) return run;
  }
  return latestSuccessfulRun(project);
};

const projectFocusStudy = (project) => {
  const run = projectFocusRun(project);
  const lane = projectFocusLane(project);
  return (
    project.studies.find((study) => study.id === run?.studyId) ??
    project.studies.find((study) => study.id === lane?.studyId) ??
    project.studies[0] ??
    null
  );
};

const laneKind = (lane) => {
  if (["factor", "portfolio", "rl", "book-risk", "event-study"].includes(lane?.id)) {
    return lane.id;
  }
  return {
    "causal-predictive-evidence": "factor",
    "mechanical-portfolio-evidence": "portfolio",
    "adaptive-policy-challenge": "rl",
    "reported-book-risk": "book-risk",
    "price-event-study": "event-study",
    "reported-book-path-stress": "book-path-stress",
  }[lane?.role] ?? null;
};

const runForLane = (project, lane) => {
  if (!lane?.latestRun?.id) return null;
  return project.runs.find((run) => run.id === lane.latestRun.id) ?? null;
};

const latestRunForLaneKind = (project, kind) =>
  project.runs
    .slice()
    .reverse()
    .find(
      (run) =>
        run.status === "succeeded" &&
        (kind === "book-risk"
          ? run.primaryMetric === "current_component_risk_hhi"
          : kind === "book-path-stress"
            ? run.primaryMetric === "worst_terminal_book_return"
          : kind === "event-study"
            ? run.primaryMetric === "primary_eligible_event_count"
          : kind === "rl"
            ? run.metricLayers?.kind === "rl-policy"
            : run.metricLayers?.kind === kind),
    ) ?? null;

const laneReadout = (project, lane) => {
  const kind = laneKind(lane);
  const run = runForLane(project, lane);
  const layers = run?.metricLayers;
  if (kind === "factor") {
    const value = layers?.kind === "factor" ? layers.validationMeanIc : lane?.latestRun?.value;
    if (!Number.isFinite(Number(value))) {
      return {
        kind,
        metric: "Validation rank IC",
        value,
        display: "—",
        tone: "warning",
        verdict: "EVIDENCE PENDING",
        detail: "No current immutable Factor Run is available",
      };
    }
    const qualification = project.factorExplorer?.factorQualification;
    if (qualification?.available) {
      const stage = qualification.diagnosis.stage;
      const positive = stage === "factor-qualification-positive";
      const weak = stage.includes("statistical-evidence-weak");
      return {
        kind,
        metric: "Validation rank IC",
        value,
        display: metric(value),
        tone: positive ? "good" : weak ? "warning" : "bad",
        verdict: positive
          ? "FACTOR QUALIFIED FOR PORTFOLIO RESEARCH"
          : stage.replaceAll("-", " ").toUpperCase(),
        detail: qualification.diagnosis.explanation,
      };
    }
    return {
      kind,
      metric: "Validation rank IC",
      value,
      display: metric(value),
      tone: Number(value) < 0 ? "bad" : "neutral",
      verdict: Number(value) < 0 ? "NEGATIVE VALIDATION IC" : "NON-NEGATIVE VALIDATION IC",
      detail:
        Number(value) < 0
          ? "Validation cross-sectional association is adverse"
          : "Direction is non-negative; fixed uncertainty and acceptance evidence still govern",
    };
  }
  if (kind === "portfolio") {
    const value =
      layers?.kind === "portfolio"
        ? layers.portfolio.validationNetSharpe
        : lane?.latestRun?.value;
    if (!Number.isFinite(Number(value))) {
      return {
        kind,
        metric: "Validation net Sharpe",
        value,
        display: "—",
        tone: "warning",
        verdict: "EVIDENCE PENDING",
        detail: "No current immutable Portfolio Run is available",
      };
    }
    return {
      kind,
      metric: "Validation net Sharpe",
      value,
      display: metric(value),
      tone: Number(value) < 0 ? "bad" : "neutral",
      verdict: Number(value) < 0 ? "NEGATIVE AFTER COSTS" : "NON-NEGATIVE AFTER COSTS",
      detail:
        Number(value) < 0
          ? "Mechanical portfolio evidence is adverse after implementation"
          : "Costed return is non-negative; robustness and fixed gates still govern",
    };
  }
  if (kind === "rl") {
    const value =
      layers?.kind === "rl-policy"
        ? layers.validationBaselineAdvantage
        : lane?.latestRun?.value;
    if (!Number.isFinite(Number(value))) {
      return {
        kind,
        metric: "RL vs best baseline",
        value,
        display: "—",
        tone: "warning",
        verdict: "EVIDENCE PENDING",
        detail: "No current immutable adaptive-policy Run is available",
      };
    }
    return {
      kind,
      metric: "RL vs best baseline",
      value,
      display: metric(value),
      tone: Number(value) < 0 ? "bad" : "neutral",
      verdict: Number(value) < 0 ? "TRAILS BEST BASELINE" : "ABOVE BEST BASELINE",
      detail:
        Number(value) >= 0
          ? "RL exceeds the fixed validation-selected baseline; this is not a promotion verdict"
          : "RL trails the best fixed validation-selected baseline",
    };
  }
  if (kind === "book-risk") {
    const explorer = project.bookRiskExplorer;
    const value =
      explorer?.current?.effectiveRiskBets ?? lane?.latestRun?.value;
    if (!Number.isFinite(Number(value))) {
      return {
        kind,
        metric: "Effective risk bets",
        value,
        display: "—",
        tone: "warning",
        verdict: "EVIDENCE PENDING",
        detail: "No current immutable Book Risk Run is available",
      };
    }
    const total = Object.keys(explorer.positionSnapshot.weights).length;
    return {
      kind,
      metric: "Effective risk bets",
      value,
      display: metric(value),
      tone: Number(value) < Math.max(2, total * 0.6) ? "warning" : "neutral",
      verdict: `${metric(value)} EFFECTIVE BETS / ${total} HOLDINGS`,
      detail:
        "Descriptive covariance evidence from an externally reported, unauthenticated position snapshot",
    };
  }
  if (kind === "event-study") {
    const explorer = project.eventStudyExplorer;
    const value = explorer?.populations?.primaryEvents ?? lane?.latestRun?.value;
    if (!Number.isFinite(Number(value))) {
      return {
        kind,
        metric: "Primary events",
        value,
        display: "—",
        tone: "warning",
        verdict: "EVIDENCE PENDING",
        detail: "No current immutable Event Study Run is available",
      };
    }
    const conclusion = explorer.conclusion;
    return {
      kind,
      metric: "Primary events",
      value,
      display: String(value),
      tone: conclusion.status === "insufficient-events" ? "warning" : "neutral",
      verdict: conclusion.status.replaceAll("-", " ").toUpperCase(),
      detail: `${conclusion.observedPrimaryEvents}/${conclusion.minimumEvents} minimum events · descriptive association only`,
    };
  }
  if (kind === "book-path-stress") {
    const explorer = project.bookPathStressExplorer;
    const value = explorer?.summary?.worstTerminalBookReturn ?? lane?.latestRun?.value;
    if (!Number.isFinite(Number(value))) {
      return {
        kind,
        metric: "Worst terminal book return",
        value,
        display: "—",
        tone: "warning",
        verdict: "EVIDENCE PENDING",
        detail: "No current immutable Path Stress Run is available",
      };
    }
    return {
      kind,
      metric: "Worst terminal book return",
      value,
      display: signedPercent(value),
      tone: "warning",
      verdict: `${explorer.summary.selectedEpisodeCount} WORST NON-OVERLAPPING EPISODES`,
      detail: `${explorer.summary.eligibleWindowCount} complete fixed-unit windows · historical support only`,
    };
  }
  return {
    kind: kind ?? "unknown",
    metric: lane?.study?.objective?.metric ?? "Objective",
    value: lane?.latestRun?.value,
    display: metric(lane?.latestRun?.value),
    tone: "",
    verdict: lane?.latestRun ? "BASELINE READY" : "EVIDENCE PENDING",
    detail: lane?.latestRun ? "Immutable evidence is available" : "Run the fixed Study",
  };
};

const progressionGate = (program, id) =>
  program?.progression?.gates?.find((gate) => gate.id === id) ?? null;

const laneAdmission = (program, lane) => {
  const factorGate = progressionGate(program, "factor-to-portfolio");
  const portfolioGate = progressionGate(program, "portfolio-to-rl");
  if (lane.id === "factor") {
    return factorGate?.status === "passed"
      ? {
          status: "passed",
          label: "UPSTREAM GATE PASSED",
          detail: factorGate.explanation,
        }
      : {
          status: "focus",
          label: "CURRENT RESEARCH FOCUS",
          detail: factorGate?.explanation ?? "Current Factor evidence is required.",
        };
  }
  if (lane.id === "portfolio") {
    if (factorGate?.status !== "passed") {
      return {
        status: "locked",
        label: "LOCKED BY FACTOR EVIDENCE",
        detail: factorGate?.explanation ?? "Factor admission is not yet available.",
      };
    }
    return portfolioGate?.status === "passed"
      ? {
          status: "passed",
          label: "REQUIRED GATE PASSED",
          detail: portfolioGate.explanation,
        }
      : {
          status: "focus",
          label: "CURRENT RESEARCH FOCUS",
          detail: portfolioGate?.explanation ?? "Current Portfolio evidence is required.",
        };
  }
  if (portfolioGate?.status !== "passed") {
    return {
      status: "locked",
      label: "LOCKED BY SIMPLE BASELINE",
      detail:
        portfolioGate?.explanation ??
        "Positive reported mechanical evidence is required before RL.",
    };
  }
  return {
    status:
      program.progression?.focusLaneId === "rl" ? "focus optional" : "optional",
    label:
      program.progression?.focusLaneId === "rl"
        ? "OPTIONAL RESEARCH IN PROGRESS"
        : "ADMITTED · OPTIONAL",
    detail: portfolioGate.explanation,
  };
};

const programAssessment = (project) => {
  const program = project.researchProgramStatus;
  if (!program) return null;
  // Core progression is rendered verbatim; this is not a browser-authored verdict.
  if (program.summary.conflicts) {
    return {
      tone: "warning",
      label: "COORDINATION REQUIRED",
      title: "Resolve shared-source conflicts",
      detail: `${program.summary.conflicts} active conflict${program.summary.conflicts === 1 ? "" : "s"} can invalidate downstream evidence.`,
    };
  }
  const progression = program.progression;
  if (progression?.stage === "factor-evidence-required") {
    const gate = progressionGate(program, "factor-to-portfolio");
    return {
      tone: gate?.status?.startsWith("blocked") ? "bad" : "warning",
      label: "STAY IN FACTOR RESEARCH",
      title: gate?.diagnosisStage
        ? gate.diagnosisStage.replaceAll("-", " ")
        : "Qualify the candidate factor",
      detail: progression.explanation,
    };
  }
  if (progression?.stage === "portfolio-evidence-required") {
    const gate = progressionGate(program, "portfolio-to-rl");
    return {
      tone: gate?.status?.startsWith("blocked") ? "bad" : "warning",
      label: "STAY IN PORTFOLIO RESEARCH",
      title: gate?.diagnosisStage
        ? gate.diagnosisStage.replaceAll("-", " ")
        : "Prove mechanical portfolio viability",
      detail: progression.explanation,
    };
  }
  if (progression?.stage === "optional-rl-in-progress") {
    return {
      tone: "neutral",
      label: "OPTIONAL RL CHALLENGE ACTIVE",
      title: "Finish the chosen adaptive-policy audit",
      detail: progression.explanation,
    };
  }
  return {
    tone: "good",
    label: "REQUIRED RESEARCH COMPLETE",
    title: "Factor and mechanical portfolio evidence are report-ready",
    detail:
      progression?.explanation ??
      "The required evidence chain is complete; RL remains optional.",
  };
};

const researchDecisionBrief = (project) => {
  const coreBrief = project.agentWorkBrief;
  if (coreBrief) {
    const tone = {
      blocked: "bad",
      complete: "good",
      active: "warning",
      pending: "neutral",
    }[coreBrief.review.status] ?? "neutral";
    return {
      tone,
      label: coreBrief.review.label,
      title: coreBrief.review.title,
      detail: coreBrief.review.detail,
      next: coreBrief.review.next,
      boundary: coreBrief.review.boundary,
      candidateContract: coreBrief.candidateContract,
      factorSplitContrast: coreBrief.factorSplitContrast,
      latestExperiment: coreBrief.evidence.latestExperiment,
      origin:
        coreBrief.question.origin === "delegated-request"
          ? "OPENALICE REQUEST"
          : coreBrief.question.origin === "project-request"
            ? "PROJECT REQUEST"
          : coreBrief.question.origin === "project-research-brief"
            ? "PROJECT RESEARCH BRIEF"
          : "LOCAL RESEARCH",
      workBriefHash: project.agentWorkBriefHash,
    };
  }
  return {
    tone: "bad",
    label: "ORIENTATION UNAVAILABLE",
    title: "Core could not verify the Agent Work Brief",
    detail:
      "Inspect the Project diagnostics; Studio will not reconstruct a research decision from partial browser data.",
    next: "Repair the reported Core validation issue, then refresh this snapshot.",
    boundary: "no inferred edit or trading authority",
    candidateContract: null,
    factorSplitContrast: null,
    latestExperiment: null,
    origin: "CORE DIAGNOSTIC",
  };
};

function renderDecisionBrief(project) {
  const brief = researchDecisionBrief(project);
  element("decision-brief").className = `decision-brief ${brief.tone}`;
  element("decision-brief").innerHTML = `
    <header>
      <small>Current research decision</small>
      <span class="decision-status">${escapeHtml(brief.label)}</span>
    </header>
    <h2>${escapeHtml(brief.title)}</h2>
    <p>${escapeHtml(brief.detail)}</p>
    ${
      brief.candidateContract
        ? `<p><b>Candidate panel</b> · base ${escapeHtml(brief.candidateContract.data.baseInterval ?? "unspecified")} · completed context ${escapeHtml(brief.candidateContract.data.featureIntervals.join(", ") || "none")} · roles ${escapeHtml(brief.candidateContract.components.roles.join(", "))}</p><p><b>Observation semantics</b> · ${escapeHtml(brief.candidateContract.data.observationSemantics.timestampMeaning)} · ${escapeHtml(brief.candidateContract.data.observationSemantics.panelShape)} · ${escapeHtml(brief.candidateContract.data.observationSemantics.targetClock)}</p><p>${escapeHtml(brief.candidateContract.data.observationSemantics.contextVisibility)}</p><p>${escapeHtml(brief.candidateContract.data.availabilityRule)}</p>`
        : ""
    }
    ${
      brief.latestExperiment
        ? `<p><b>Latest trial</b> · ${escapeHtml(brief.latestExperiment.id)} · ${escapeHtml(brief.latestExperiment.verdict)} · Run ${escapeHtml(brief.latestExperiment.runId)} · ${brief.latestExperiment.candidateCheck ? `Check ${escapeHtml(brief.latestExperiment.candidateCheck.id)} (${escapeHtml(brief.latestExperiment.candidateCheck.status)})` : "Check unavailable"}</p>`
        : ""
    }
    ${
      brief.factorSplitContrast
        ? `<p><b>Material train/validation contrast</b> · h${brief.factorSplitContrast.primaryForwardBars} train ${metric(brief.factorSplitContrast.trainMeanRankIc)} → validation ${metric(brief.factorSplitContrast.validationMeanRankIc)} · |gap| ${metric(brief.factorSplitContrast.absoluteGap)} ≥ ${metric(brief.factorSplitContrast.visibilityThreshold)} visibility threshold · validation still selects</p>`
        : ""
    }
    <footer>
      <span>
        <small>Next investigation</small>
        <b>${escapeHtml(brief.next)}</b>
      </span>
      <code>${escapeHtml(brief.origin)} · ${escapeHtml(brief.boundary)}${brief.workBriefHash ? ` · ${escapeHtml(shortHash(brief.workBriefHash))}` : ""}</code>
    </footer>`;
}

function renderResearchAgenda(project) {
  const section = element("research-agenda");
  const agenda = project.agentWorkBrief?.researchAgenda;
  if (!agenda) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const agendaStatus = agenda.status.replaceAll("-", " ");
  const moveRole = agenda.moveRole.replaceAll("-", " ");
  element("research-agenda-meta").textContent = agenda.diagnosis
    ? `${agendaStatus} · ${moveRole} · ${
        agenda.diagnosis.stage === agenda.status
          ? (
              agenda.diagnosis.iterationFocus ?? agenda.diagnosis.stage
            ).replaceAll("-", " ")
          : agenda.diagnosis.stage.replaceAll("-", " ")
      }`
    : agenda.status.replaceAll("-", " ");
  const board = element("research-agenda-board");
  if (!agenda.moves.length) {
    board.innerHTML = `
      <div class="research-agenda-empty">
        <b>No evidence-backed experiment is available.</b>
        <p>${escapeHtml(agenda.reason ?? "Create current verified evidence before choosing a research move.")}</p>
      </div>`;
  } else {
    board.innerHTML = agenda.moves
      .map(
        (move) => `
          <article class="research-move">
            <header>
              <span>${agenda.moveRole === "optional-follow-up" ? "OPTIONAL FOLLOW-UP" : `0${move.priority}`} · ${escapeHtml(agenda.laneId?.toUpperCase() ?? "STUDY")}</span>
              <b>${escapeHtml(move.id)}</b>
            </header>
            <h3>${escapeHtml(move.title)}</h3>
            <p class="research-move-hypothesis">${escapeHtml(move.hypothesis)}</p>
            <p class="research-move-rationale">${escapeHtml(move.rationale)}</p>
            <dl class="research-move-target">
              <dt>Edit target</dt>
              <dd>${escapeHtml(move.target.editablePaths.join(", ") || "freeze current source")}</dd>
              <dt>Components</dt>
              <dd>${escapeHtml(move.target.components.join(", ") || "stage-level")}</dd>
            </dl>
            <div class="research-move-evidence">
              ${move.evidenceRefs
                .map(
                  (item) => `
                    <span>
                      <small>${escapeHtml(item.label)}</small>
                      <b>${metric(item.value)}</b>
                      <i>${escapeHtml(item.unit)} · ${escapeHtml(item.role)}</i>
                    </span>`,
                )
                .join("")}
            </div>
            <div class="research-move-checks">
              <span>
                <small>Required validation checks</small>
                <ul>${move.evaluation.requiredChecks.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </span>
              <span>
                <small>Stop conditions</small>
                <ul>${move.evaluation.stopConditions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </span>
            </div>
          </article>`,
      )
      .join("");
  }
  element("research-agenda-authority").textContent =
    `${agenda.authority.selectionSplit} prioritizes · ${agenda.authority.testRole} · ` +
    "no automatic execution · no automatic promotion · no trading authority";
}

function renderExternalHoldout(project) {
  const section = element("external-holdout");
  const holdout = project.externalHoldout;
  if (!holdout) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const binding = holdout.binding;
  const result = holdout.result;
  const assessment = holdout.assessment;
  element("external-holdout-meta").textContent =
    `${holdout.state.toUpperCase()} · ${binding.laneIds.length} FROZEN ${binding.laneIds.length === 1 ? "LANE" : "LANES"}`;
  const laneCards = result
    ? result.lanes
        .map(
          (lane) => `
            <article class="holdout-lane">
              <header>
                <span>${escapeHtml(lane.id.toUpperCase())}</span>
                <b>${escapeHtml(lane.status)}</b>
              </header>
              <dl>
                <div>
                  <dt>Source period</dt>
                  <dd>${metric(lane.source.value)}</dd>
                </div>
                <div>
                  <dt>Later period</dt>
                  <dd>${metric(lane.holdout.value)}</dd>
                </div>
                <div>
                  <dt>Observed Δ</dt>
                  <dd>${lane.delta === null ? "—" : signedMetric(lane.delta)}</dd>
                </div>
              </dl>
              <p>${escapeHtml(lane.source.objective.metric)} · immutable Run ${escapeHtml(shortHash(lane.holdout.runId))}</p>
            </article>`,
        )
        .join("")
    : `
        <article class="holdout-pending">
          <small>BOUND / NOT EXECUTED</small>
          <h3>The candidate is frozen before later-period evaluation.</h3>
          <p>Run the exact bound lane set once. Candidate Sessions, automatic selection, and promotion are disabled.</p>
          <code>${escapeHtml(project.agentWorkBrief?.primaryAction?.display ?? "aq holdout run … --json")}</code>
        </article>`;
  const assessmentCard = assessment
    ? `
        <article class="holdout-pending">
          <small>IMMUTABLE AGENT ASSESSMENT</small>
          <h3>${escapeHtml(assessment.overallAssessment.toUpperCase())} · ${escapeHtml(assessment.title)}</h3>
          <p>${escapeHtml(assessment.executiveSummary)}</p>
          <ul>${assessment.lanes
            .map(
              (lane) => `<li><b>${escapeHtml(lane.id)}</b> · ${escapeHtml(lane.assessment)} — ${escapeHtml(lane.summary)}</li>`,
            )
            .join("")}</ul>
          <code>${escapeHtml(assessment.markdownPath)}</code>
        </article>`
    : result
      ? `
          <article class="holdout-pending">
            <small>ASSESSMENT REQUIRED</small>
            <h3>The frozen Runs are complete; the research handoff is not.</h3>
            <p>Inspect Core's bounded comparative evidence, then publish one lane-specific Agent assessment. Core supplies no universal pass threshold.</p>
            <code>${escapeHtml(project.agentWorkBrief?.primaryAction?.display ?? "aq holdout assess … --analysis holdout-analysis.json --json")}</code>
          </article>`
      : "";
  element("external-holdout-board").innerHTML = `
    <article class="holdout-identity">
      <small>SOURCE EVIDENCE</small>
      <h3>${escapeHtml(binding.sourceProjectId)} · ${escapeHtml(shortHash(binding.sourceDossierId))}</h3>
      <p>${escapeHtml(binding.sourceDataset.id)}@${escapeHtml(binding.sourceDataset.version)}</p>
      <b>${escapeHtml(binding.nonOverlap.sourceEnd)}</b>
    </article>
    <div class="holdout-arrow" aria-label="strictly later, non-overlapping period">
      <span>STRICTLY LATER</span>
      <i aria-hidden="true">→</i>
    </div>
    <article class="holdout-identity">
      <small>TARGET EVIDENCE</small>
      <h3>${escapeHtml(binding.targetDataset.id)}@${escapeHtml(binding.targetDataset.version)}</h3>
      <p>${escapeHtml(binding.targetDataset.assetClass)} · ${binding.targetDataset.universe.length} assets</p>
      <b>${escapeHtml(binding.nonOverlap.targetStart)}</b>
    </article>
    <div class="holdout-lanes">${laneCards}${assessmentCard}</div>`;
  element("external-holdout-authority").textContent =
    result?.interpretation?.claim ??
    "External temporal audit · candidate frozen · no selection · no automatic promotion · no trading authority";
}

const shortHash = (value) =>
  typeof value === "string" && value.length > 14
    ? `${value.slice(0, 8)}…${value.slice(-6)}`
    : String(value ?? "—");

const relativeTime = (value) => {
  const milliseconds = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(milliseconds)) return "unknown";
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const selectedProject = () => {
  const projects = state.snapshot?.projects ?? [];
  return projects.find((project) => project.id === state.projectId) ?? projects[0] ?? null;
};

const selectedSession = (project = selectedProject()) => {
  const sessions = project?.sessions ?? [];
  return sessions.find((item) => item.session.id === state.sessionId) ?? sessions.at(-1) ?? null;
};

const hashProjectId = () => {
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return "";
  }
};

function setConnection(kind, label) {
  syncState.className = `sync-state ${kind}`;
  syncState.querySelector("span").textContent = label;
}

function projectMonogram(project) {
  return project.id
    .split("-")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function renderProjects() {
  const projects = state.snapshot.projects;
  element("project-count").textContent = String(projects.length);
  element("project-list").innerHTML =
    projects
      .map((project) => {
        const active = project.id === state.projectId;
        const status = project.valid
          ? project.counts.runningCampaigns > 0 || project.counts.activeSessions > 0
            ? "active"
            : ""
          : "warning";
        return `
          <button class="project-button ${active ? "active" : ""}" type="button"
            data-project="${escapeHtml(project.id)}" aria-pressed="${active}">
            <span class="project-monogram">${escapeHtml(projectMonogram(project))}</span>
            <span>
              <strong>${escapeHtml(project.name)}</strong>
              <small>${project.counts.activeSessions} active · ${project.counts.runs} runs</small>
            </span>
            <i class="${status}" aria-hidden="true"></i>
          </button>`;
      })
      .join("") || '<p class="empty-copy">No valid Projects discovered.</p>';
  document.querySelectorAll("[data-project]").forEach((button) => {
    button.addEventListener("click", () => {
      state.projectId = button.dataset.project;
      state.sessionId = null;
      state.evidenceLane = null;
      window.location.hash = encodeURIComponent(state.projectId);
      render();
    });
  });
}

const deskSectionDefinitions = [
  { id: "research-overview", label: "Decision" },
  { id: "external-holdout", label: "Holdout" },
  { id: "research-program-status", label: "Research chain" },
  { id: "research-handoff", label: "Handoff" },
  { id: "evidence-workbench", label: "Evidence" },
  { id: "research-pulse", label: "Sessions" },
  { id: "decision-matrix", label: "Comparison" },
  { id: "research-iteration", label: "Iteration" },
  { id: "research-catalog", label: "Studies & Runs" },
];

const deskSectionMeta = (project, id) => {
  const program = project.researchProgramStatus;
  const selected = selectedSession(project);
  if (id === "research-overview") return "NOW";
  if (id === "external-holdout") {
    return String(project.externalHoldout?.state ?? "—").toUpperCase();
  }
  if (id === "research-program-status") {
    return `${program?.summary?.lanes ?? 0} LANES`;
  }
  if (id === "research-handoff") {
    return project.intake || project.counts.delegatedSessions ? "OPENALICE" : "LOCAL";
  }
  if (id === "evidence-workbench") {
    return String(state.evidenceLane ?? "RUN").toUpperCase();
  }
  if (id === "research-pulse") {
    return project.counts.activeSessions
      ? `${project.counts.activeSessions} ACTIVE`
      : `${project.counts.sessions} TOTAL`;
  }
  if (id === "decision-matrix") {
    return selected ? "LEADER" : "—";
  }
  if (id === "research-iteration") {
    return `${project.counts.campaigns} CAMPAIGNS`;
  }
  if (id === "research-catalog") {
    return `${project.counts.studies} / ${project.counts.runs}`;
  }
  return "";
};

function updateDeskNavActive() {
  const buttons = Array.from(document.querySelectorAll("[data-desk-target]"));
  if (!buttons.length) return;
  let current = buttons[0].dataset.deskTarget;
  const atDocumentEnd =
    window.scrollY + window.innerHeight >=
    document.documentElement.scrollHeight - 8;
  if (atDocumentEnd) {
    current = buttons.at(-1).dataset.deskTarget;
  } else {
    for (const button of buttons) {
      const target = element(button.dataset.deskTarget);
      if (target && target.getBoundingClientRect().top <= 118) {
        current = button.dataset.deskTarget;
      }
    }
  }
  for (const button of buttons) {
    const active = button.dataset.deskTarget === current;
    button.classList.toggle("active", active);
    button.setAttribute("aria-current", active ? "location" : "false");
  }
}

function renderDeskContext(project) {
  const source = state.snapshot?.source;
  const workspace = source?.workspace;
  const workspaceName =
    workspace?.name ??
    String(source?.rootDir ?? "Local workspace").split("/").filter(Boolean).at(-1);
  const configurationSource = workspace?.configurationSource ?? "direct-project";
  element("workspace-scope").textContent =
    configurationSource === "local-override"
      ? "LOCAL OVERRIDE"
      : String(source?.scope ?? "local").toUpperCase();
  element("rail-workspace").textContent = workspaceName || "Local workspace";
  const projectsDirectory =
    workspace?.projectsDir ??
    project?.rootDir ??
    source?.rootDir ??
    "Direct Project";
  element("rail-projects").textContent = projectsDirectory;
  element("rail-projects").title = projectsDirectory;
  element("rail-project").textContent = project?.name ?? "No project";
  const study = project ? projectFocusStudy(project) : null;
  const run = project ? projectFocusRun(project) : null;
  element("rail-study").textContent = study?.name ?? study?.id ?? "No study";
  element("rail-run").textContent = run?.id ? shortHash(run.id) : "No run";

  if (!project) {
    element("desk-nav").innerHTML = "";
    return;
  }
  const visible = deskSectionDefinitions.filter(({ id }) => {
    const target = element(id);
    return target && !target.hidden;
  });
  element("desk-nav").innerHTML = visible
    .map(
      ({ id, label }, index) => `
        <button class="desk-nav-button" type="button" data-desk-target="${id}">
          <i>${String(index + 1).padStart(2, "0")}</i>
          <span>${escapeHtml(label)}</span>
          <small>${escapeHtml(deskSectionMeta(project, id))}</small>
        </button>`,
    )
    .join("");
  document.querySelectorAll("[data-desk-target]").forEach((button) => {
    button.addEventListener("click", () => {
      element(button.dataset.deskTarget)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  });
  updateDeskNavActive();
}

function renderScoreboard(project) {
  const counts = project.counts;
  const holdout = project.externalHoldout;
  if (holdout) {
    const result = holdout.result;
    const values = [
      ["Holdout state", holdout.state, "frozen external audit", holdout.state === "assessed" ? "good" : "live"],
      ["Frozen lanes", holdout.binding.laneIds.length, holdout.binding.laneIds.join(" · "), ""],
      ["Source end", holdout.binding.nonOverlap.sourceEnd, holdout.binding.sourceDataset.id, ""],
      ["Later start", holdout.binding.nonOverlap.targetStart, result ? `${result.status} · no universal threshold` : "not yet executed", ""],
    ];
    element("scoreboard").innerHTML = values
      .map(
        ([label, value, note, className]) => `
          <div class="score-cell ${className}">
            <small>${escapeHtml(label)}</small>
            <strong>${escapeHtml(value)}</strong>
            <span>${escapeHtml(note)}</span>
          </div>`,
      )
      .join("");
    return;
  }
  const program = project.researchProgramStatus;
  if (program) {
    const readouts = Object.fromEntries(
      program.lanes.map((lane) => {
        const readout = laneReadout(project, lane);
        return [readout.kind, readout];
      }),
    );
    const current = program.lanes.filter(
      (lane) => lane.currentRun && lane.latestRun?.status === "succeeded",
    ).length;
    const values = [
      ["Current evidence", `${current}/${program.lanes.length}`, "immutable lane baselines", current === program.lanes.length ? "good" : "live"],
      [
        readouts.factor?.metric ?? "Factor evidence",
        readouts.factor?.display ?? "—",
        "validation selection",
        readouts.factor?.tone ?? "",
      ],
      [
        readouts.portfolio?.metric ?? "Portfolio evidence",
        readouts.portfolio?.display ?? "—",
        "costed implementation",
        readouts.portfolio?.tone ?? "",
      ],
      [
        readouts.rl?.metric ?? "Adaptive evidence",
        readouts.rl?.display ?? "—",
        "validation value-add",
        readouts.rl?.tone ?? "",
      ],
    ];
    element("scoreboard").innerHTML = values
      .map(
        ([label, value, note, className]) => `
          <div class="score-cell ${className}">
            <small>${escapeHtml(label)}</small>
            <strong>${escapeHtml(value)}</strong>
            <span>${escapeHtml(note)}</span>
          </div>`,
      )
      .join("");
    return;
  }
  const run = projectFocusRun(project);
  const layers = run?.metricLayers;
  let values;
  if (layers?.kind === "portfolio") {
    values = [
      ["Validation net Sharpe", metric(layers.portfolio.validationNetSharpe), "selection · baseline", valueTone(layers.portfolio.validationNetSharpe)],
      ["Validation rank IC", metric(layers.factor.validationRankIc), "causal factor", valueTone(layers.factor.validationRankIc)],
      ["Test max drawdown", percent(layers.portfolio.testMaximumDrawdown), "visible audit only", valueTone(layers.portfolio.testMaximumDrawdown)],
      [`${metric(layers.robustness.adverseCostBps)} bps stress`, metric(layers.robustness.testAdverseCostSharpe), "test stress · audit", valueTone(layers.robustness.testAdverseCostSharpe)],
    ];
  } else if (layers?.kind === "rl-policy") {
    const opportunity = layers.factorOpportunity;
    const summary = project.rlExplorer?.summary;
    values = [
      ["Incremental RL value", metric(layers.validationBaselineAdvantage), "vs best simpler policy", valueTone(layers.validationBaselineAdvantage)],
      [
        "Local-best hit rate",
        percent(opportunity?.validationOracleHitRate),
        `${metric(opportunity?.validationMeanSelectedRank)} / 5 mean rank`,
        Number(opportunity?.validationOracleHitRate) < 0.5 ? "bad" : "",
      ],
      [
        "Candidate capture",
        percent(layers.validationCandidateActionFrequency),
        `${percent(opportunity?.validationCandidateOracleFrequency)} locally best`,
        Number(layers.validationCandidateActionFrequency) === 0 ? "bad" : "",
      ],
      [
        "Implementation drag",
        percent(summary?.meanValidationCostDrag),
        `${metric(summary?.meanValidationOneWayTurnover)} one-way turnover`,
        Number(summary?.meanValidationCostDrag) > 0 ? "bad" : "",
      ],
    ];
  } else if (layers?.kind === "factor") {
    values = [
      ["Validation rank IC", metric(layers.validationMeanIc), "1 bar · selection", valueTone(layers.validationMeanIc)],
      ["HAC t-stat", metric(layers.validationHacTStatistic), "dependence-aware", valueTone(layers.validationHacTStatistic)],
      ["Worst fold IC", metric(layers.validationWorstFoldMeanIc), "stability floor", valueTone(layers.validationWorstFoldMeanIc)],
      ["Test rank IC", metric(layers.testMeanIc), "visible audit only", valueTone(layers.testMeanIc)],
    ];
  } else {
    values = [
      ["Active Sessions", counts.activeSessions, counts.sessions === 1 ? "1 total" : `${counts.sessions} total`, counts.activeSessions ? "live" : ""],
      ["Running", counts.runningCampaigns, "mutable progress", counts.runningCampaigns ? "live" : ""],
      ["Reports", counts.reports, `${counts.delegatedSessions} delegated`, counts.reports ? "live" : ""],
      ["Immutable Runs", counts.runs, `${counts.verdicts.KEEP} kept · ${counts.campaigns} campaigns`, ""],
    ];
  }
  element("scoreboard").innerHTML = values
    .map(
      ([label, value, note, className]) => `
        <div class="score-cell ${className}">
          <small>${escapeHtml(label)}</small>
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(note)}</span>
        </div>`,
    )
    .join("");
}

function currentCampaign(session) {
  if (session.progress.length) {
    const progress = session.progress.at(-1);
    return {
      live: true,
      status: progress.phase,
      message: progress.message,
      turn: `${progress.turn}/${progress.budget.maxTurns}`,
    };
  }
  if (session.campaigns.length) {
    const campaign = session.campaigns.at(-1);
    return {
      live: false,
      status: campaign.status,
      message: campaign.reason,
      turn: String(campaign.turnsCompleted),
    };
  }
  return {
    live: false,
    status: session.session.status,
    message: "Manual Session",
    turn: "—",
  };
}

function renderSessions(project) {
  const sessions = project.sessions;
  const active = sessions.filter((item) => item.session.status === "active").length;
  const running = sessions.reduce((total, item) => total + item.progress.length, 0);
  element("pulse-meta").textContent = running
    ? `${running} Researcher ${running === 1 ? "is" : "are"} in progress`
    : `${active} active ${active === 1 ? "Session" : "Sessions"}`;
  element("session-lanes").innerHTML =
    sessions
      .map((item) => {
        const session = item.session;
        const campaign = currentCampaign(item);
        const selected = session.id === state.sessionId;
        return `
          <button class="session-lane ${selected ? "active" : ""}" type="button"
            data-session="${escapeHtml(session.id)}" aria-pressed="${selected}">
            <span class="lane-identity">
              <span>${item.delegation ? "delegated" : escapeHtml(session.status)} session</span>
              <strong>${escapeHtml(item.delegation?.request?.title ?? session.studyId)}</strong>
              <code>${escapeHtml(session.id)}</code>
            </span>
            <span class="lane-stat">
              <small>Leader</small>
              <strong>${metric(session.leader.value)}</strong>
            </span>
            <span class="lane-stat">
              <small>Family trials</small>
              <strong>${item.selectionIntegrity.researchFamily?.uniqueSourceTrials ?? item.experiments.length}</strong>
            </span>
            <span class="lane-stat">
              <small>Turn</small>
              <strong>${escapeHtml(campaign.turn)}</strong>
            </span>
            <span class="lane-stat">
              <small>Reports</small>
              <strong>${item.reports.length}</strong>
            </span>
            <span class="lane-state ${campaign.live ? "live" : normalizedStatus(campaign.status) === "failed" ? "warning" : ""}">
              <i aria-hidden="true"></i>
              <span>
                <small>${escapeHtml(campaign.status)}</small>
                <span>${escapeHtml(campaign.message)}</span>
              </span>
            </span>
          </button>`;
      })
      .join("") ||
    (project.externalHoldout
      ? '<div class="empty-panel">Sessions are disabled in this frozen external-audit Project.</div>'
      : project.bookRiskExplorer || project.eventStudyExplorer || project.bookPathStressExplorer || project.allocationExplorer
        ? '<div class="empty-panel">This fixed descriptive Project has no editable research surface or Session lifecycle.</div>'
      : project.runReports?.length
        ? `<div class="empty-panel">${project.runReports.length} immutable Run-bound Research Report${project.runReports.length === 1 ? "" : "s"} published; no editable Session, Check, or Experiment was created.</div>`
      : '<div class="empty-panel">No Sessions yet. Start one with <code>aq session start</code>.</div>');
  document.querySelectorAll("[data-session]").forEach((button) => {
    button.addEventListener("click", () => {
      state.sessionId = button.dataset.session;
      const session = project.sessions.find(
        (item) => item.session.id === state.sessionId,
      );
      const lane = evidenceLaneForStudy(project, session?.session.studyId);
      if (lane) state.evidenceLane = lane;
      render();
      element("inspector-content").scrollTop = 0;
    });
  });
}

function commandFor(session, id) {
  return session?.commands?.find((item) => item.id === id) ?? null;
}

function copyCommandButton(command, label = "Copy command") {
  if (!command) return "";
  return `
    <button class="command-button" type="button"
      data-copy-command="${escapeHtml(command.display)}"
      data-copy-label="${escapeHtml(label)}"
      title="${escapeHtml(command.display)}">
      <span>${escapeHtml(label)}</span>
      <code>${escapeHtml(command.display)}</code>
    </button>`;
}

function compactCommandButton(command, label = "Copy CLI") {
  if (!command) return "";
  return `
    <button class="command-button compact-command" type="button"
      data-copy-command="${escapeHtml(command.display)}"
      data-copy-label="${escapeHtml(label)}"
      title="${escapeHtml(command.display)}">
      <span>${escapeHtml(label)}</span>
      <code>${escapeHtml(command.display)}</code>
    </button>`;
}

function bindCopyCommands() {
  document.querySelectorAll("[data-copy-command]").forEach((button) => {
    button.addEventListener("click", async () => {
      const label = button.querySelector("span");
      try {
        await navigator.clipboard.writeText(button.dataset.copyCommand);
        if (label) label.textContent = "Copied";
      } catch {
        if (label) label.textContent = "Copy failed";
      }
      window.setTimeout(() => {
        if (label) label.textContent = button.dataset.copyLabel ?? "Copy command";
      }, 1600);
    });
  });
}

function dossierState(project) {
  if (project.externalHoldout) return null;
  const status = project.dossierStatus;
  if (!status) return null;
  const latest = status.latestDossier;
  const current = Boolean(latest?.current);
  return {
    status,
    latest,
    current,
    label: current ? "PUBLISHED" : status.ready ? "READY TO SYNTHESIZE" : "BLOCKED",
    tone: current ? "published" : status.ready ? "active" : "blocked",
    command: status.nextAction,
  };
}

function dossierInspectorSection(project) {
  const dossier = dossierState(project);
  if (!dossier) return "";
  const included = dossier.status.includedLaneIds.join(", ") || "none";
  const omissions = dossier.status.omittedOptionalLanes
    .map((lane) => `${lane.name}: ${lane.reason}`)
    .join(" · ");
  const blockerSummary = dossier.status.blockers
    .map((blocker) => blocker.message)
    .join(" · ");
  return `
    <section class="inspector-section dossier-inspector">
      <small>OpenAlice return artifact</small>
      <h3>${escapeHtml(dossier.latest?.title ?? "Project Research Dossier")}</h3>
      <span class="status-chip ${escapeHtml(dossier.tone)}">${escapeHtml(dossier.label)}</span>
      <p>${escapeHtml(
        dossier.latest?.executiveSummary ??
      (dossier.status.ready
            ? "Current evidence-gated lane Reports are ready for Agent-authored Project synthesis."
            : blockerSummary || "Required lane evidence is incomplete."),
      )}</p>
      <dl class="inspector-kv">
        <dt>Included lanes</dt><dd>${escapeHtml(included)}</dd>
        <dt>Optional omissions</dt><dd>${escapeHtml(omissions || "none")}</dd>
        <dt>Trading authority</dt><dd>none</dd>
      </dl>
      ${copyCommandButton(dossier.command, dossier.current ? "Copy Dossier show CLI" : "Copy next Dossier CLI")}
    </section>`;
}

function reviewInspectorSection(project) {
  const review = project.reviews?.at(-1);
  if (!review) return "";
  const classes = review.classifications ?? {};
  const command = project.commands?.find((item) => item.id === "review.show");
  return `
    <section class="inspector-section review-inspector">
      <small>Independent evidence review</small>
      <h3>${escapeHtml(review.title)}</h3>
      <span class="status-chip ${escapeHtml(normalizedStatus(review.conclusion))}">${escapeHtml(review.conclusion)}</span>
      <p>This immutable Review classifies the completed Report without changing its research evidence or granting new quantitative authority.</p>
      <dl class="inspector-kv">
        <dt>Target Report</dt><dd>${escapeHtml(review.target.reportId)}</dd>
        <dt>Verified</dt><dd>${classes.verified ?? 0}</dd>
        <dt>Declared</dt><dd>${classes.declared ?? 0}</dd>
        <dt>Observed unbound</dt><dd>${classes["observed-unbound"] ?? 0}</dd>
        <dt>Unverified</dt><dd>${classes.unverified ?? 0}</dd>
      </dl>
      ${copyCommandButton(command, "Copy Review show CLI")}
    </section>`;
}

function reportCorrectionInspectorSection(project) {
  const current = project.runReports?.filter((report) => report.current).at(-1);
  const correction = current?.correction;
  if (!correction) return "";
  return `
    <section class="inspector-section report-correction-inspector">
      <small>Current immutable correction</small>
      <h3>${escapeHtml(current.title)}</h3>
      <span class="status-chip published">CURRENT · DEPTH ${current.lineageDepth}</span>
      <p>${escapeHtml(correction.reason)}</p>
      <dl class="inspector-kv">
        <dt>Current Report</dt><dd>${escapeHtml(current.id)}</dd>
        <dt>Corrects Report</dt><dd>${escapeHtml(correction.corrects.reportId)}</dd>
        <dt>Governing Review</dt><dd>${escapeHtml(correction.governingReview.id)}</dd>
        <dt>Review conclusion</dt><dd>${escapeHtml(correction.governingReview.conclusion)}</dd>
      </dl>
      <p>The prior Report remains immutable. Currentness is derived from the verified linear correction graph.</p>
    </section>`;
}

function renderHandoff(project) {
  const session = selectedSession(project);
  const delegation = session?.delegation;
  const section = element("research-handoff");
  section.hidden = false;
  section.classList.remove("compact");
  const dossier = dossierState(project);
  if (dossier && project.intake) {
    const request = project.intake.request;
    const dataset = project.intake.dataset;
    const readyLanes = dossier.status.lanes.filter((lane) => lane.status === "ready");
    const requiredNames = dossier.status.lanes
      .filter((lane) => lane.required)
      .map((lane) => lane.name);
    const requiredReady = dossier.status.lanes.filter(
      (lane) => lane.required && lane.status === "ready",
    ).length;
    const reportCount = dossier.status.lanes.filter((lane) => lane.report).length;
    const omissions = dossier.status.omittedOptionalLanes;
    const blockers = dossier.status.blockers;
    const currentTitle = dossier.latest?.title ?? "Cross-lane synthesis pending";
    const currentSummary =
      dossier.latest?.executiveSummary ??
      (dossier.status.ready
        ? "Agent analysis can now compose the verified lane Reports into one immutable Project answer."
        : blockers[0]?.message ?? "Required lane evidence is incomplete.");
    element("handoff-flow").textContent =
      "REQUEST → LANE REPORTS → PROJECT DOSSIER → OPENALICE";
    element("handoff-meta").textContent = dossier.current
      ? `Current Dossier · ${dossier.status.includedLaneIds.length} ${dossier.status.includedLaneIds.length === 1 ? "lane" : "lanes"}`
      : dossier.status.ready
        ? `${reportCount} current lane Reports · synthesis pending`
        : `${blockers.length} required evidence blocker${blockers.length === 1 ? "" : "s"}`;
    element("handoff-board").innerHTML = `
      <article class="handoff-card request-card">
        <small>01 · Incoming request</small>
        <h3>${escapeHtml(request.title)}</h3>
        <p>${escapeHtml(request.question)}</p>
        <dl class="handoff-kv">
          <dt>Assets</dt><dd>${escapeHtml(request.assets.map((item) => item.symbol).join(", "))}</dd>
          <dt>Direction</dt><dd>${escapeHtml(request.direction)}</dd>
          <dt>Horizon</dt><dd>${escapeHtml(request.horizon)} · ${escapeHtml(horizonPolicyText(request))}</dd>
        </dl>
        <span class="context-note">Caller-supplied context · ${escapeHtml(request.source.system)} / ${escapeHtml(request.source.workspaceId ?? "unspecified")}</span>
      </article>
      <article class="handoff-card evidence-card">
        <small>02 · Governed lane Reports</small>
        <h3>${requiredReady}/${requiredNames.length} required ready · ${readyLanes.length} included</h3>
        <p>${escapeHtml(requiredNames.join(" and ") || "Factor")} ${requiredNames.length === 1 ? "is" : "are"} required by the current scientific gates. Gated downstream lanes may be omitted; adaptive evidence can only join when its frozen dependencies match.</p>
        <div class="handoff-metrics">
          <span><b>${readyLanes.length}</b><small>ready lanes</small></span>
          <span><b>${reportCount}</b><small>current reports</small></span>
          <span><b>${dossier.status.blockers.length}</b><small>blockers</small></span>
        </div>
        <span class="context-note">${escapeHtml(dataset.id)}@${escapeHtml(dataset.version)} · ${escapeHtml(dataset.timeRange.start)} → ${escapeHtml(dataset.timeRange.end)}${omissions.length ? ` · omitted: ${escapeHtml(omissions.map((lane) => lane.name).join(", "))}` : ""}</span>
      </article>
      <article class="handoff-card report-card ${dossier.current ? "ready" : ""}">
        <small>03 · OpenAlice return artifact</small>
        <h3>${escapeHtml(currentTitle)}</h3>
        <p>${escapeHtml(currentSummary)}</p>
        <span class="status-chip ${escapeHtml(dossier.tone)}">${escapeHtml(dossier.label)}</span>
        ${copyCommandButton(dossier.command, dossier.current ? "Copy Dossier show CLI" : "Copy next governed CLI")}
      </article>`;
    return;
  }
  if (!session || !delegation) {
    const intake = project.intake;
    if (intake) {
      const request = intake.request;
      const dataset = intake.dataset;
      const datasetAvailability = dataset.availability;
      const source = request.source;
      const program = project.researchProgramStatus;
      const holdout = project.externalHoldout;
      const lane = projectFocusLane(project);
      const bookRisk = project.bookRiskExplorer;
      const eventStudy = project.eventStudyExplorer;
      const bookPathStress = project.bookPathStressExplorer;
      const allocation = project.allocationExplorer;
      const next =
        holdout?.nextAction ??
        (bookRisk || eventStudy || bookPathStress || allocation
          ? project.agentWorkBrief?.primaryAction
          : null) ??
        program?.recommendedAction ??
        intake.commands.find((item) => item.id === "session.start");
      const baseline = projectFocusRun(project);
      const layers = baseline?.metricLayers;
      const portfolio = layers?.kind === "portfolio" ? layers : null;
      const baselineTone = valueTone(baseline?.primaryValue);
      const scenarioCount =
        bookRisk?.scenarioComparison?.scenarios?.length ?? 0;
      const sizingStatus =
        bookRisk?.positionSizing?.status ?? "not-requested";
      const sizingReady = sizingStatus !== "not-requested";
      const eventCounts = eventStudy?.populations;
      element("handoff-flow").textContent = holdout
        ? "FROZEN SOURCE → LATER DATA → EXTERNAL AUDIT"
        : bookRisk
          ? "REQUEST → DATASET → FIXED RUN → REVIEW"
        : eventStudy
          ? "REQUEST → DATASET → FIXED EVENT RUN → REVIEW"
        : bookPathStress
          ? "REQUEST → DATASET → FIXED PATH STRESS RUN → REVIEW"
        : allocation
          ? "REQUEST → DATASET → FIXED ALLOCATION RUN → REVIEW"
        : "REQUEST → DATASET → BASELINE → ITERATE";
      element("handoff-meta").textContent = holdout
        ? `${holdout.state.toUpperCase()} · ${holdout.binding.laneIds.length} immutable lanes`
        : bookRisk
          ? `Descriptive evidence ready · ${scenarioCount} supplied scenario${scenarioCount === 1 ? "" : "s"}${sizingReady ? ` · sizing ${escapeHtml(sizingStatus)}` : ""} · no Session`
        : eventStudy
          ? `${eventCounts?.primaryEvents ?? 0} primary events · ${eventCounts?.completeEvents ?? 0} complete · no Session`
        : bookPathStress
          ? `${bookPathStress.summary.eligibleWindowCount} complete windows · ${bookPathStress.summary.selectedEpisodeCount} selected episodes · no Session`
        : allocation
          ? `${allocation.conclusion.status} · validation advantage ${metric(allocation.conclusion.validationNetSharpeAdvantage)} · no Session`
        : baseline
          ? `${baseline.primaryMetric} ${metric(baseline.primaryValue)} · Session not started`
          : "Content locked · baseline pending";
      element("handoff-board").innerHTML = `
        <article class="handoff-card request-card">
          <small>01 · Research mandate</small>
          <h3>${escapeHtml(request.title)}</h3>
          <p>${escapeHtml(request.question)}</p>
          <dl class="handoff-kv">
            <dt>Requested assets</dt><dd>${escapeHtml(request.assets.map((item) => item.symbol).join(", "))}</dd>
            <dt>Direction</dt><dd>${escapeHtml(request.direction)}</dd>
            <dt>Horizon</dt><dd>${escapeHtml(request.horizon)} · ${escapeHtml(horizonPolicyText(request))}</dd>
          </dl>
          <span class="context-note">Caller-supplied context · ${escapeHtml(source.system)} / ${escapeHtml(source.workspaceId ?? "unspecified")}</span>
        </article>
        <article class="handoff-card evidence-card">
          <small>02 · Research universe</small>
          <h3>${dataset.universe.length}-asset content-locked panel</h3>
          <p>${escapeHtml(dataset.universe.join(" · "))}</p>
          <div class="handoff-metrics">
            <span><b>${escapeHtml(dataset.frequency)}</b><small>frequency</small></span>
            <span><b>${datasetAvailability?.unionObservations ?? dataset.assets[0]?.observations ?? "—"}</b><small>${datasetAvailability ? "union sessions" : "sessions"}</small></span>
            <span><b>${escapeHtml(dataset.market.calendar)}</b><small>calendar claim</small></span>
          </div>
          <span class="context-note">${escapeHtml(datasetProviderClaim(dataset))} · ${escapeHtml(dataset.priceAdjustment)} · ${escapeHtml(dataset.timeRange.start)} → ${escapeHtml(dataset.timeRange.end)} · ${datasetAvailability ? `observed-only ${percent(datasetAvailability.observationCoverage)} row coverage · ` : ""}provider claims</span>
        </article>
        <article class="handoff-card report-card ${baseline ? "ready" : ""}">
          <small>03 · ${holdout ? "Frozen external audit" : bookRisk ? "Book Risk evidence &amp; review" : eventStudy ? "Price-event evidence &amp; review" : allocation ? "Allocation evidence &amp; review" : `${lane ? escapeHtml(lane.name) : "Baseline"} &amp; next action`}</small>
          <h3>${holdout ? `${holdout.binding.laneIds.length} source lanes bound to later data` : baseline ? `${escapeHtml(baseline.primaryMetric)} = ${metric(baseline.primaryValue)}` : escapeHtml(intake.study.name)}</h3>
          <p>${holdout ? "The exact source candidates are frozen. Only the one-shot holdout command is authorized; no Session, retuning, selection, promotion, or trading action is implied." : bookRisk ? `The fixed descriptive Run audits the reported baseline, compares ${scenarioCount} caller-supplied complete book${scenarioCount === 1 ? "" : "s"}${sizingReady ? `, and returns a ${escapeHtml(sizingStatus)} caller-bounded historical target position` : ""}. Review the verified evidence; no Session, optimization, order, or trading authority follows.` : eventStudy ? `The fixed Run preserves ${eventCounts?.qualifyingEvents ?? 0} qualifying events, ${eventCounts?.primaryEvents ?? 0} non-overlapping primary outcomes, matched reference returns, and the frozen conclusion. Review the verified ledger; no Session, threshold search, order, or trading authority follows.` : allocation ? `The fixed Run compares a causal ERC book with the complete fixed-weight reference under the same schedule, drift, no-trade band, and cost model. The validation-only conclusion is ${escapeHtml(allocation.conclusion.status)}; no Session, Order, or trading authority follows.` : baseline ? "The immutable baseline is descriptive evidence, not a recommendation. Start a governed Session to test candidates against validation-only selection." : "Start a governed Session to run a fresh baseline and freeze this request into its derived Brief."}</p>
          ${portfolio ? `
          <div class="handoff-metrics">
            <span class="${valueTone(portfolio.factor.validationRankIc)}"><b>${metric(portfolio.factor.validationRankIc)}</b><small>validation IC</small></span>
            <span class="${valueTone(portfolio.portfolio.testMaximumDrawdown)}"><b>${percent(portfolio.portfolio.testMaximumDrawdown)}</b><small>test max DD</small></span>
            <span class="${valueTone(portfolio.robustness.testAdverseCostSharpe)}"><b>${metric(portfolio.robustness.testAdverseCostSharpe)}</b><small>${metric(portfolio.robustness.adverseCostBps)}bps audit</small></span>
          </div>` : ""}
          <span class="status-chip ${baselineTone === "bad" ? "revert" : "active"}">${bookRisk || eventStudy || allocation ? "fixed evidence" : baseline ? (baselineTone === "bad" ? "negative baseline" : "baseline verified") : "ready"}</span>
          ${copyCommandButton(next, holdout ? (holdout.state === "assessed" ? "Copy holdout show command" : holdout.state === "completed" ? "Copy holdout assess command" : "Copy holdout run command") : bookRisk ? "Copy Book Risk Explorer CLI" : eventStudy ? "Copy Event Explorer CLI" : allocation ? "Copy Allocation Explorer CLI" : program ? "Copy recommended command" : "Copy start command")}
        </article>`;
      return;
    }
    element("handoff-flow").textContent = "REQUEST → EVIDENCE → REPORT";
    element("handoff-meta").textContent = "No delegated request";
    section.hidden = true;
    element("handoff-board").innerHTML = "";
    return;
  }
  const request = delegation.request;
  const source = request.source;
  const latestReport = session.reports.at(-1);
  const publish = commandFor(session, "report.publish");
  const show = commandFor(session, "report.show");
  const assets = request.assets.map((item) => item.symbol).join(", ");
  element("handoff-flow").textContent = "REQUEST → EVIDENCE → REPORT";
  element("handoff-meta").textContent =
    latestReport ? `${session.reports.length} verified report${session.reports.length === 1 ? "" : "s"}` : "Report analysis pending";
  element("handoff-board").innerHTML = `
    <article class="handoff-card request-card">
      <small>01 · Incoming request</small>
      <h3>${escapeHtml(request.title)}</h3>
      <p>${escapeHtml(request.question)}</p>
      <dl class="handoff-kv">
        <dt>Assets</dt><dd>${escapeHtml(assets)}</dd>
        <dt>Direction</dt><dd>${escapeHtml(request.direction)}</dd>
        <dt>Horizon</dt><dd>${escapeHtml(request.horizon)} · ${escapeHtml(horizonPolicyText(request))}</dd>
      </dl>
      <span class="context-note">Caller-supplied context · ${escapeHtml(source.system)} / ${escapeHtml(source.workspaceId ?? "unspecified")}</span>
    </article>
    <article class="handoff-card evidence-card">
      <small>02 · Governed evidence</small>
      <h3>${escapeHtml(session.session.studyId)}</h3>
      <p>${session.authority.valid ? "Fixed Study authority is verified." : "Authority needs attention before publication."}</p>
      <div class="handoff-metrics">
        <span><b>${metric(session.session.leader.value)}</b><small>leader</small></span>
        <span><b>${session.selectionIntegrity.researchFamily?.uniqueSourceTrials ?? session.experiments.length}</b><small>family trials</small></span>
        <span><b>${session.campaigns.length}</b><small>campaigns</small></span>
      </div>
      <span class="context-note">${escapeHtml(session.selectionIntegrity.selectionMetric)} · ${escapeHtml(session.selectionIntegrity.selectionSplit)} selection · ${escapeHtml(selectionContext(session.selectionIntegrity))} · ${escapeHtml(testExposureContext(session.selectionIntegrity))}${session.selectionIntegrity.externalHoldoutRequired ? " · new holdout required" : ""}</span>
    </article>
    <article class="handoff-card report-card ${latestReport ? "ready" : ""}">
      <small>03 · Decision-support report</small>
      <h3>${escapeHtml(latestReport?.title ?? "Analysis not published")}</h3>
      <p>${escapeHtml(latestReport?.executiveSummary ?? "An Agent supplies strict findings; Core verifies references and renders the report.")}</p>
      ${reportDecisionProof(latestReport)}
      <span class="status-chip ${latestReport ? "published" : "active"}">${latestReport ? "verified" : "pending"}</span>
      ${copyCommandButton(latestReport ? show : publish)}
    </article>`;
}

function programPhaseLabel(phase) {
  return {
    "not-started": "NOT STARTED",
    "baseline-ready": "BASELINE READY",
    researching: "RESEARCHING",
    reported: "REPORTED",
    stale: "STALE EVIDENCE",
  }[phase] ?? String(phase ?? "unknown").toUpperCase();
}

function renderResearchProgram(project) {
  const section = element("research-program-status");
  const program = project.researchProgramStatus;
  if (!program) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const summary = program.summary;
  const recommended = program.recommendedAction;
  const holdout = project.externalHoldout;
  const assessment = programAssessment(project);
  const dossier = dossierState(project);
  const gatesPassed = program.progression.gates.filter(
    (gate) => gate.status === "passed",
  ).length;
  element("research-program-meta").textContent =
    `${program.dataset.universe.length} assets · one snapshot · ${summary.lanes} fixed Studies`;
  element("research-program-summary").innerHTML = [
    ["Required gates", `${gatesPassed}/2`, "reported scientific admission"],
    ["Active researchers", summary.activeSessions, "governed Sessions"],
    ["Lane reports", summary.reports, "verified decision-support evidence"],
    [
      "OpenAlice dossier",
      dossier?.current ? "PUBLISHED" : dossier?.status.ready ? "READY" : "BLOCKED",
      dossier?.current
        ? `${dossier.status.includedLaneIds.length} frozen lanes`
        : dossier?.status.ready
          ? "Agent synthesis pending"
          : `${dossier?.status.blockers.length ?? 0} required blockers`,
    ],
  ]
    .map(
      ([label, value, note], index) => `
        <span class="${index === 3 ? (dossier?.current ? "ready" : dossier?.status.ready ? "warning" : "warning") : ""}">
          <small>${escapeHtml(label)}</small>
          <b>${escapeHtml(value)}</b>
          <i>${escapeHtml(note)}</i>
        </span>`,
    )
    .join("");
  element("research-program-assessment").innerHTML = `
    <span class="assessment-signal ${escapeHtml(assessment.tone)}">
      <i aria-hidden="true"></i>
      <small>Evidence readout</small>
      <b>${escapeHtml(assessment.label)}</b>
    </span>
    <span class="assessment-copy">
      <strong>${escapeHtml(assessment.title)}</strong>
      <span>${escapeHtml(assessment.detail)}</span>
    </span>
    <span class="assessment-boundary">Validation decides · test audits · no trading authority</span>`;
  element("research-program-lanes").innerHTML = program.lanes
    .map((lane, index) => {
      const session = lane.latestSession;
      const selected = !holdout && lane.id === program.recommendedLaneId;
      const kind = laneKind(lane);
      const readout = laneReadout(project, lane);
      const evidenceSelected = kind === state.evidenceLane;
      const admission = laneAdmission(program, lane);
      const command =
        (admission.status === "locked"
          ? lane.commands.find((item) => item.id === "study.inspect")
          : lane.commands.find((item) => item.id === recommended?.id) ??
            lane.commands.find((item) => item.id === "session.show") ??
            lane.commands.find((item) => item.id === "session.start") ??
            lane.commands.find((item) => item.id === "run.execute")) ??
        lane.commands[0];
      return `
        <article class="program-lane ${lane.phase} admission-${admission.status.replaceAll(" ", "-")} ${selected ? "recommended" : ""} ${evidenceSelected ? "evidence-selected" : ""}">
          <header>
            <span>${String(index + 1).padStart(2, "0")}</span>
            <small>${escapeHtml(lane.role)}</small>
          </header>
          <h3>${escapeHtml(lane.name)}</h3>
          <span class="admission-chip ${escapeHtml(admission.status.replaceAll(" ", "-"))}">${escapeHtml(admission.label)}</span>
          <div class="program-lane-readout ${escapeHtml(readout.tone)}">
            <small>${escapeHtml(readout.metric)}</small>
            <strong>${escapeHtml(readout.display)}</strong>
            <b>${escapeHtml(readout.verdict)}</b>
          </div>
          <p>${escapeHtml(admission.detail)}</p>
          <dl>
            <dt>Session</dt>
            <dd>${session ? `${escapeHtml(session.status)} · ${session.experiments} experiments` : "not started"}</dd>
            <dt>Source</dt>
            <dd>${escapeHtml(lane.editablePaths.join(", "))}</dd>
            ${lane.dependencyPaths?.length ? `
              <dt>Fixed input</dt>
              <dd>${escapeHtml(lane.dependencyPaths.join(", "))}</dd>
            ` : ""}
          </dl>
          <div class="program-lane-foot">
            <span class="program-phase ${lane.phase}">${escapeHtml(programPhaseLabel(lane.phase))}</span>
            ${selected ? "<b>NEXT RESEARCH LANE</b>" : ""}
            ${holdout ? "<b>FROZEN SOURCE LANE</b>" : ""}
            ${admission.status.includes("optional") && !selected ? "<b>OPTIONAL · NOT REQUIRED</b>" : ""}
          </div>
          <div class="program-lane-actions">
            <button class="lane-open-button" type="button" data-open-evidence="${escapeHtml(kind)}">
              Inspect evidence
            </button>
            ${compactCommandButton(command)}
          </div>
        </article>`;
    })
    .join("");
  element("research-program-footer").innerHTML = `
    <span>
      <b>${holdout ? "Frozen external-audit boundary" : program.conflicts.length ? "Shared-source conflict" : "Integration boundary"}</b>
      ${holdout ? "Candidate iteration is disabled in this Project. The cards remain historical source context; only the bound one-shot holdout action is authorized." : `${escapeHtml(program.progression.explanation)} · ${escapeHtml(program.warnings.join(" · "))} · Dossier composition is Core-verified and has no trading authority.`}
    </span>
    ${copyCommandButton(holdout?.nextAction ?? dossier?.command ?? recommended, holdout ? (holdout.state === "assessed" ? "Copy holdout show command" : holdout.state === "completed" ? "Copy holdout assess command" : "Copy holdout run command") : dossier ? "Copy Dossier next action" : "Copy recommended command")}`;
}

const evidenceLanes = [
  {
    id: "book-path-stress",
    label: "Book path stress",
    question: "Which fixed-unit historical paths hurt this reported book most?",
    explorer: "bookPathStressExplorer",
    section: "book-path-stress-explorer",
  },
  {
    id: "allocation",
    label: "Allocation",
    question: "Does the fixed construction beat the same-clock reference?",
    explorer: "allocationExplorer",
    section: "allocation-explorer",
  },
  {
    id: "event-study",
    label: "Price event",
    question: "What happened after the fixed event and delay?",
    explorer: "eventStudyExplorer",
    section: "event-study-explorer",
  },
  {
    id: "book-risk",
    label: "Book risk",
    question: "Is the reported book crowded, and what reduces risk first?",
    explorer: "bookRiskExplorer",
    section: "book-risk-explorer",
  },
  {
    id: "factor",
    label: "Factor",
    question: "Does the signal predict?",
    explorer: "factorExplorer",
    section: "factor-explorer",
  },
  {
    id: "portfolio",
    label: "Portfolio",
    question: "Does the edge survive implementation?",
    explorer: "portfolioExplorer",
    section: "portfolio-explorer",
  },
  {
    id: "rl",
    label: "Adaptive policy",
    question: "Does RL beat the best simpler policy?",
    explorer: "rlExplorer",
    section: "rl-explorer",
  },
];

const studyIdsByEvidenceLane = {
  "book-path-stress": "ohlcv-book-path-stress",
  allocation: "ohlcv-risk-parity-allocation",
  "event-study": "ohlcv-price-event-reaction",
  "book-risk": "ohlcv-book-risk",
  factor: "ohlcv-factor-quality",
  portfolio: "ohlcv-portfolio-quality",
  rl: "ohlcv-rl-factor-policy",
};

function evidenceLaneForStudy(project, studyId) {
  const programLane = project.researchProgramStatus?.lanes.find(
    (lane) => lane.studyId === studyId,
  );
  return laneKind(programLane) ??
    Object.entries(studyIdsByEvidenceLane).find(
      ([, candidateStudyId]) => candidateStudyId === studyId,
    )?.[0] ??
    null;
}

function sessionForEvidenceLane(project, laneId) {
  const programLane = project.researchProgramStatus?.lanes.find(
    (lane) => laneKind(lane) === laneId,
  );
  const latestSessionId = programLane?.latestSession?.id;
  return (
    project.sessions.find(
      (item) => item.session.id === latestSessionId,
    ) ??
    project.sessions
      .slice()
      .reverse()
      .find(
        (item) =>
          evidenceLaneForStudy(project, item.session.studyId) === laneId,
      ) ??
    null
  );
}

function syncEvidenceSelection(project) {
  const available = evidenceLanes.filter((lane) => project[lane.explorer]);
  if (!available.length) return;
  const recommendedKind = laneKind(projectFocusLane(project));
  if (!available.some((lane) => lane.id === state.evidenceLane)) {
    state.evidenceLane =
      available.find((lane) => lane.id === recommendedKind)?.id ??
      available[0].id;
  }
  const selected = selectedSession(project);
  if (
    evidenceLaneForStudy(project, selected?.session.studyId) !==
    state.evidenceLane
  ) {
    state.sessionId =
      sessionForEvidenceLane(project, state.evidenceLane)?.session.id ??
      state.sessionId;
  }
}

function renderEvidenceWorkbench(project) {
  const section = element("evidence-workbench");
  const available = evidenceLanes.filter((lane) => project[lane.explorer]);
  if (!available.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const recommendedKind = laneKind(projectFocusLane(project));
  if (!available.some((lane) => lane.id === state.evidenceLane)) {
    state.evidenceLane =
      available.find((lane) => lane.id === recommendedKind)?.id ?? available[0].id;
  }
  const selected = available.find((lane) => lane.id === state.evidenceLane);
  element("evidence-workbench-meta").textContent =
    `${selected.label} lane · immutable Run evidence`;
  const tabs = element("evidence-lane-tabs");
  tabs.dataset.laneCount = String(available.length);
  tabs.innerHTML = available
    .map((lane, index) => {
      const laneProgram = project.researchProgramStatus?.lanes.find(
        (item) => laneKind(item) === lane.id,
      );
      const fallbackRun = latestRunForLaneKind(project, lane.id);
      const readout = laneReadout(
        project,
        laneProgram ?? {
          id: lane.id,
          latestRun: fallbackRun ? { id: fallbackRun.id, value: fallbackRun.primaryValue } : null,
        },
      );
      const active = lane.id === state.evidenceLane;
      return `
        <button type="button" role="tab" aria-selected="${active}"
          data-evidence-lane="${escapeHtml(lane.id)}">
          <span>${String(index + 1).padStart(2, "0")} · ${escapeHtml(lane.label)}</span>
          <strong>${escapeHtml(readout.verdict)}</strong>
          <small>${escapeHtml(lane.question)}</small>
        </button>`;
    })
    .join("");
  evidenceLanes.forEach((lane) => {
    const explorer = element(lane.section);
    if (!project[lane.explorer]) return;
    explorer.hidden = lane.id !== state.evidenceLane;
  });
  document
    .querySelectorAll("[data-evidence-lane], [data-open-evidence]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        state.evidenceLane =
          button.dataset.evidenceLane ?? button.dataset.openEvidence;
        state.sessionId =
          sessionForEvidenceLane(project, state.evidenceLane)?.session.id ??
          state.sessionId;
        render();
        element("evidence-workbench").scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      });
    });
}

function chartTime(timestamp) {
  return Date.parse(`${timestamp}T00:00:00Z`);
}

function chartPath(points, value, xScale, yScale) {
  return points
    .map((point, index) => {
      const x = xScale(chartTime(point.timestamp));
      const y = yScale(Number(value(point)));
      return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function factorSeriesPath(points, key, xScale, yScale) {
  return points
    .filter((point) => Number.isFinite(Number(point[key])))
    .map((point, index) => {
      const x = xScale(chartTime(point.timestamp));
      const y = yScale(Number(point[key]));
      return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function factorChartDateLabels(points, xScale, y) {
  if (!points.length) return "";
  const first = points[0].timestamp;
  const last = points.at(-1).timestamp;
  return [first, last]
    .map(
      (timestamp, index) => `
        <text class="chart-axis-label" x="${xScale(chartTime(timestamp)).toFixed(2)}"
          y="${y}" text-anchor="${index ? "end" : "start"}">
          ${escapeHtml(timestamp)}
        </text>`,
    )
    .join("");
}

function renderFactorChart(explorer) {
  const chart = element("factor-chart");
  const quantileAvailable = explorer.quantileEvidence?.status === "available";
  if (state.factorView === "quantiles" && !quantileAvailable) {
    state.factorView = "ic";
  }
  const horizon = state.factorHorizon;
  const split = state.factorSplit;
  const audit = split === "test";
  const source =
    state.factorView === "quantiles"
      ? explorer.quantilePath.points.filter(
          (point) =>
            point.split === split && String(point.horizon) === horizon,
        )
      : explorer.icPath.points.filter((point) => point.split === split);
  document.querySelectorAll("[data-factor-view]").forEach((button) => {
    const unavailable =
      button.dataset.factorView === "quantiles" && !quantileAvailable;
    button.disabled = unavailable;
    button.title = unavailable
      ? explorer.quantileEvidence.reason
      : "";
    if (button.dataset.factorView === "quantiles") {
      button.textContent = quantileAvailable ? "Quantiles" : "Quantiles · N/A";
    }
    button.setAttribute(
      "aria-selected",
      String(button.dataset.factorView === state.factorView),
    );
  });
  document.querySelectorAll("[data-factor-horizon]").forEach((button) => {
    button.setAttribute(
      "aria-selected",
      String(button.dataset.factorHorizon === horizon),
    );
  });
  document.querySelectorAll("[data-factor-split]").forEach((button) => {
    button.setAttribute(
      "aria-selected",
      String(button.dataset.factorSplit === split),
    );
  });
  element("factor-chart-title").textContent =
    state.factorView === "quantiles"
      ? `Fixed-tertile ${explorer.factorOutcome.label}`
      : "Rank & Pearson IC path";
  element("factor-chart-note").textContent =
    `${horizon}-bar · ${split}${audit ? " · VISIBLE AUDIT ONLY" : " · SELECTION"} · ${source.length} sampled points` +
    (quantileAvailable
      ? " · fixed tertiles available"
      : ` · quantiles protocol-unavailable: ${explorer.quantileEvidence.reason}`);
  if (!source.length) {
    chart.innerHTML =
      '<div class="empty-panel">No finite evidence for this fixed split and horizon.</div>';
    return;
  }
  const width = 760;
  const height = 270;
  const left = 46;
  const right = 14;
  const top = 20;
  const bottom = 34;
  const firstTime = chartTime(source[0].timestamp);
  const lastTime = chartTime(source.at(-1).timestamp);
  const timeSpread = Math.max(1, lastTime - firstTime);
  const xScale = (value) =>
    left + ((value - firstTime) / timeSpread) * (width - left - right);
  const keys =
    state.factorView === "quantiles"
      ? ["low", "middle", "high", "highMinusLow"]
      : [`rankIcH${horizon}`, `pearsonIcH${horizon}`];
  const values = [
    0,
    ...source.flatMap((point) =>
      keys
        .map((key) => Number(point[key]))
        .filter((value) => Number.isFinite(value)),
    ),
  ];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = Math.max(1e-6, (maximum - minimum) * 0.08);
  const low = minimum - padding;
  const high = maximum + padding;
  const spread = Math.max(1e-9, high - low);
  const yScale = (value) =>
    top + ((high - value) / spread) * (height - top - bottom);
  const zero = yScale(0);
  const palette =
    state.factorView === "quantiles"
      ? [
          ["low", "factor-low", "Low"],
          ["middle", "factor-middle", "Middle"],
          ["high", "factor-high", "High"],
          ["highMinusLow", "factor-spread", "High − low"],
        ]
      : [
          [`rankIcH${horizon}`, "factor-rank", "Rank IC"],
          [`pearsonIcH${horizon}`, "factor-pearson", "Pearson IC"],
        ];
  chart.innerHTML = `
    <svg class="factor-svg" viewBox="0 0 ${width} ${height}" role="img"
      aria-label="${escapeHtml(state.factorView === "quantiles" ? `Quantile ${explorer.factorOutcome.label} path` : "Rank and Pearson information-coefficient path")}">
      <line class="factor-zero" x1="${left}" x2="${width - right}" y1="${zero}" y2="${zero}"></line>
      <text class="chart-axis-label" x="${left - 6}" y="${top + 4}" text-anchor="end">${escapeHtml(metric(high))}</text>
      <text class="chart-axis-label" x="${left - 6}" y="${zero + 4}" text-anchor="end">0</text>
      <text class="chart-axis-label" x="${left - 6}" y="${height - bottom}" text-anchor="end">${escapeHtml(metric(low))}</text>
      ${palette
        .map(
          ([key, className, label]) => `
            <path class="factor-line ${className}" d="${factorSeriesPath(source, key, xScale, yScale)}">
              <title>${escapeHtml(label)}</title>
            </path>`,
        )
        .join("")}
      ${factorChartDateLabels(source, xScale, height - 8)}
    </svg>
    <div class="factor-legend">
      ${palette
        .map(
          ([, className, label]) => `
            <span class="${className}"><i></i>${escapeHtml(label)}</span>`,
        )
        .join("")}
      <span class="${audit ? "audit-label" : "selection-label"}">${audit ? "TEST · AUDIT ONLY" : "VALIDATION · SELECTION"}</span>
    </div>`;
}

function renderFactorHorizons(explorer) {
  const rows = explorer.horizonProfile;
  const primary = explorer.researchHorizon.primaryForwardBars;
  element("factor-horizons").innerHTML = `
    <table class="factor-table horizon-table" aria-label="Fixed factor horizon profile">
      <thead>
        <tr>
          <th>Horizon</th>
          <th>Train</th>
          <th>Validation</th>
          <th>Test audit</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `
              <tr>
                <th>${row.horizon} bar${row.horizon === 1 ? "" : "s"}${row.horizon === primary ? " · PRIMARY" : ""}</th>
                <td><b>${metric(row.train.meanRankIc)}</b><small>IC · ${row.train.observations} obs</small></td>
                <td class="selection-cell"><b>${metric(row.validation.meanRankIc)}</b><small>IC · t ${metric(row.validation.hacTStatistic)}</small></td>
                <td class="audit-cell"><b>${metric(row.test.meanRankIc)}</b><small>AUDIT · ${row.test.observations} obs</small></td>
              </tr>`,
          )
          .join("")}
      </tbody>
    </table>`;
}

function renderFactorStability(explorer) {
  const split = state.factorSplit;
  const kind = state.factorStability;
  document.querySelectorAll("[data-factor-stability]").forEach((button) => {
    button.setAttribute(
      "aria-selected",
      String(button.dataset.factorStability === kind),
    );
  });
  const definitions = {
    regimes: {
      rows: explorer.stability.causalRegimes.filter(
        (row) => row.split === split,
      ),
      name: (row) => row.regime,
      value: (row) => row.meanRankIc,
      detail: (row) =>
        `${row.observations} obs · ${row.sufficient ? "sufficient" : "sparse"}`,
      label: "Mean rank IC",
    },
    folds: {
      rows: explorer.stability.chronologicalFolds.filter(
        (row) => row.split === split,
      ),
      name: (row) => row.id,
      value: (row) => row.meanRankIc,
      detail: (row) => `${row.observations} obs · ICIR ${metric(row.rankIcir)}`,
      label: "Mean rank IC",
    },
    assets: {
      rows: explorer.stability.assets.filter((row) => row.split === split),
      name: (row) => row.asset,
      value: (row) => row.rankCorrelation,
      detail: (row) => `${row.observations} paired observations`,
      label: "Time-series rank corr.",
    },
    styles: {
      rows: explorer.stability.styles.filter((row) => row.split === split),
      name: (row) => row.style.replaceAll("_", " "),
      value: (row) => row.meanRankCorrelation,
      detail: (row) =>
        `|corr| mean ${metric(row.meanAbsoluteRankCorrelation)} · ${row.observations} obs`,
      label: "Mean rank overlap",
    },
  };
  const definition = definitions[kind];
  element("factor-stability").innerHTML = `
    <div class="factor-stability-meta">
      <span>${escapeHtml(definition.label)}</span>
      <b class="${split === "test" ? "audit-label" : "selection-label"}">${split === "test" ? "TEST · AUDIT ONLY" : "VALIDATION · SELECTION CONTEXT"}</b>
    </div>
    <div class="factor-stability-grid">
      ${definition.rows
        .map((row) => {
          const value = definition.value(row);
          const magnitude = Number.isFinite(Number(value))
            ? Math.min(100, Math.abs(Number(value)) * 100)
            : 0;
          return `
            <div class="factor-stability-row">
              <span>
                <b>${escapeHtml(definition.name(row))}</b>
                <small>${escapeHtml(definition.detail(row))}</small>
              </span>
              <i><u style="width:${magnitude}%"></u></i>
              <strong>${metric(value)}</strong>
            </div>`;
        })
        .join("") || '<div class="empty-panel">No stability rows for this split.</div>'}
    </div>`;
}

function renderFactorQualification(explorer) {
  const root = element("factor-qualification");
  const qualification = explorer.factorQualification;
  if (!qualification?.available) {
    root.innerHTML = `
      <div class="factor-qualification-empty">
        Legacy Run: style-neutral and incremental blend evidence was not recorded.
      </div>`;
    return;
  }
  const temporal = ["single-asset-temporal", "two-asset-relative-value"].includes(
    explorer.predictionUniverse?.evaluationMode,
  );
  const scoreLabel = temporal ? "temporal rank contribution" : "IC";
  const observationLabel = temporal ? "observations" : "dates";
  const diagnosis = qualification.diagnosis;
  const validation = qualification.validation;
  const test = qualification.testAudit;
  const selected = qualification.selection.candidates.find(
    (item) => item.style === qualification.selection.dominantStyle,
  );
  const residual = validation.styleNeutralCandidate;
  const incremental = validation.incremental;
  const knownStyleClaim = qualification.claim.claim === "known-style-validation";
  const rawOnlyClaim = ["decision-signal", "known-style-validation"].includes(
    qualification.claim.claim,
  );
  const worst = rawOnlyClaim
    ? validation.weakestCandidateFold
    : validation.weakestStyleNeutralFold;
  const positive =
    diagnosis.qualifiesForPortfolio === true ||
    diagnosis.stage === "risk-forecast-positive";
  const minimumHacT =
    qualification.semantics.diagnosticThresholds.minimumPositiveHacTStatistic;
  const rawTone =
    validation.candidate.meanRankIc <= 0
      ? "adverse"
      : validation.candidate.hacTStatistic >= minimumHacT
        ? "positive"
        : "warning";
  const residualTone =
    residual.meanRankIc <= 0
      ? "adverse"
      : residual.hacTStatistic >= minimumHacT
        ? "positive"
        : "warning";
  root.innerHTML = `
    <div class="factor-qualification-diagnosis ${positive ? "positive" : "adverse"}">
      <span>
        <small>First missing qualification layer</small>
        <b>${escapeHtml(diagnosis.stage.replaceAll("-", " ").toUpperCase())}</b>
        <i>next focus · ${escapeHtml(diagnosis.iterationFocus.replaceAll("-", " "))}</i>
      </span>
      <p>${escapeHtml(diagnosis.explanation)}</p>
    </div>
    <div class="factor-qualification-chain" role="list" aria-label="Validation factor qualification funnel">
      <span class="${rawTone}" role="listitem">
        <small>01 · Raw candidate edge</small>
        <b>${signedMetric(validation.candidate.meanRankIc)} ${scoreLabel}</b>
        <i>HAC t ${signedMetric(validation.candidate.hacTStatistic)} · ${validation.candidate.observations} ${observationLabel}</i>
      </span>
      <span class="context" role="listitem">
        <small>02 · ${knownStyleClaim ? "Request-predeclared style identity" : "Train-selected style"}</small>
        <b>${escapeHtml(qualification.selection.dominantStyle.replaceAll("_", " "))}</b>
        <i>${signedMetric(selected?.meanRankCorrelation)} mean rank overlap · train only</i>
      </span>
      <span class="${knownStyleClaim ? rawTone : residualTone}" role="listitem">
        <small>03 · ${knownStyleClaim ? "Known-style raw evidence" : "Style-neutral edge"}</small>
        <b>${signedMetric(knownStyleClaim ? validation.candidate.meanRankIc : residual.meanRankIc)} ${scoreLabel}</b>
        <i>${knownStyleClaim ? `identity ≥ ${metric(qualification.semantics.diagnosticThresholds.minimumKnownStyleRankIdentity)}` : `HAC t ${signedMetric(residual.hacTStatistic)} · Δ raw ${signedMetric(incremental.styleNeutralIcDelta)}`}</i>
      </span>
      <span class="${incremental.blendUpliftVsStyle > 0 ? "positive" : "adverse"}" role="listitem">
        <small>04 · Blend uplift vs style</small>
        <b>${signedMetric(incremental.blendUpliftVsStyle)} ${scoreLabel}</b>
        <i>equal rank blend ${signedMetric(validation.equalRankBlend.meanRankIc)} ${scoreLabel}</i>
      </span>
      <span class="${worst?.meanRankIc > 0 ? "positive" : "adverse"}" role="listitem">
        <small>05 · ${knownStyleClaim ? "Candidate time breadth" : "Residual time breadth"}</small>
        <b>${signedMetric(worst?.meanRankIc)} worst ${scoreLabel}</b>
        <i>${escapeHtml(worst?.id ?? "unavailable")} · ${worst?.observations ?? 0} ${observationLabel}</i>
      </span>
    </div>
    <div class="factor-qualification-audit">
      <span><small>Residual ICIR</small><b>${signedMetric(residual.rankIcir)}</b></span>
      <span><small>Residual hit rate</small><b>${percent(residual.rankHitRate)}</b></span>
      <span><small>Blend Δ vs candidate</small><b>${signedMetric(incremental.blendUpliftVsCandidate)}</b></span>
      <span><small>Candidate rank turnover</small><b>${percent(explorer.summary.meanRankTurnover)}</b></span>
    </div>
    <div class="factor-qualification-test">
      <small>TEST · VISIBLE AUDIT ONLY · NEVER ENTERS DIAGNOSIS</small>
      <span>raw → residual ${scoreLabel} <b>${signedMetric(test.candidate.meanRankIc)} → ${signedMetric(test.styleNeutralCandidate.meanRankIc)}</b></span>
      <span>blend uplift vs style <b>${signedMetric(test.incremental.blendUpliftVsStyle)}</b></span>
      <span>worst residual fold <b>${signedMetric(test.weakestStyleNeutralFold?.meanRankIc)}</b></span>
    </div>
    <p class="factor-qualification-disclosure">
      This Run is bound to the <b>${escapeHtml(qualification.claim.claim)}</b>
      claim${qualification.claim.knownStyle ? ` for <b>${escapeHtml(qualification.claim.knownStyle)}</b>` : ""}.
      ${knownStyleClaim ? "The comparison style is fixed by the request." : "Dominant style is selected by train-only overlap."}
      Neutralization is a
      ${temporal ? "within-split temporal" : "same-timestamp cross-sectional"} rank projection and never sees forward
      returns. Positive raw/residual evidence requires HAC t ≥
      ${metric(qualification.semantics.diagnosticThresholds.minimumPositiveHacTStatistic)};
      Project-family selection adjustment remains separate. This funnel
      prioritizes research; it does not change Factor KEEP/REVERT, admit a
      source into RL, or grant order/account authority.
    </p>`;
}

function renderFactorComponents(explorer) {
  const root = element("factor-components");
  const evidence = explorer.factorComponents;
  if (!evidence?.available) {
    root.innerHTML = `
      <div class="factor-qualification-empty">
        Legacy Run: candidate-declared component evidence was not recorded.
      </div>`;
    return;
  }
  const temporal = ["single-asset-temporal", "two-asset-relative-value"].includes(
    evidence.evaluationMode,
  );
  const scoreLabel = temporal ? "temporal contribution" : "IC";
  const diagnosis = evidence.validationDiagnosis;
  const redundant = diagnosis.mostRedundantPair;
  root.innerHTML = `
    <div class="factor-component-diagnosis">
      <span>
        <small>Strongest raw component</small>
        <b>${escapeHtml(diagnosis.strongestRawComponent)}</b>
        <i>validation ${scoreLabel} ${signedMetric(diagnosis.strongestRawMeanIc)}</i>
      </span>
      <span>
        <small>Strongest nearest-peer residual</small>
        <b>${escapeHtml(diagnosis.strongestResidualComponent ?? "unavailable")}</b>
        <i>validation ${scoreLabel} ${signedMetric(diagnosis.strongestResidualMeanIc)}</i>
      </span>
      <span>
        <small>Removal most improves fixed blend</small>
        <b>${escapeHtml(diagnosis.removalMostImprovesFixedBlend ?? "unavailable")}</b>
        <i>validation Δ ${signedMetric(diagnosis.bestRemovalDeltaMeanIc)}</i>
      </span>
      <span>
        <small>Most redundant train pair</small>
        <b>${escapeHtml(redundant ? `${redundant.left} × ${redundant.right}` : "unavailable")}</b>
        <i>|rank association| ${metric(redundant?.trainMeanAbsoluteRankAssociation)}</i>
      </span>
    </div>
    <div class="factor-component-table">
      <table class="factor-table" aria-label="Candidate-declared factor component evidence">
        <thead>
          <tr>
            <th>Component / interval</th>
            <th>Coverage</th>
            <th>Validation raw ${scoreLabel}</th>
            <th>Nearest peer / residual ${scoreLabel}</th>
            <th>Fixed-blend removal Δ</th>
            <th>Test raw ${scoreLabel}</th>
          </tr>
        </thead>
        <tbody>
          ${evidence.components
            .map((component) => {
              const validation = component.validation;
              const residual = validation.nearestPeerResidual;
              if (component.role === "timestamp-context") {
                const context = validation.context;
                const occupancy = context.stateOccupancy;
                return `
                  <tr>
                    <td data-label="Component / interval">
                      <b>${escapeHtml(component.label)}</b>
                      <small>${escapeHtml(component.id)} · timestamp context · ${escapeHtml(component.intervals.join(" + "))}</small>
                    </td>
                    <td data-label="Coverage">${percent(component.meanCoverage)}</td>
                    <td data-label="Validation context">
                      <b>L/M/H ${percent(occupancy.low.rate)} / ${percent(occupancy.middle.rate)} / ${percent(occupancy.high.rate)}</b>
                      <small>transition ${percent(context.transitions.rate)}</small>
                    </td>
                    <td data-label="Conditional evidence">
                      <b>${temporal ? "conditional temporal contribution" : "conditional factor IC"}</b>
                      <small>train-tertile states; target-free thresholds</small>
                    </td>
                    <td data-label="Fixed-blend removal Δ">not applicable</td>
                    <td data-label="Test context">visible audit</td>
                  </tr>`;
              }
              return `
                <tr>
                  <td data-label="Component / interval">
                    <b>${escapeHtml(component.label)}</b>
                    <small>${escapeHtml(component.id)} · ${escapeHtml(component.intervals.join(" + "))}</small>
                  </td>
                  <td data-label="Coverage">${percent(component.meanCoverage)}</td>
                  <td data-label="Validation raw ${scoreLabel}" class="${valueTone(validation.raw.meanRankIc)}">${signedMetric(validation.raw.meanRankIc)}</td>
                  <td data-label="Nearest peer / residual ${scoreLabel}">
                    <b>${escapeHtml(component.nearestPeer.id ?? "unavailable")}</b>
                    <small>${signedMetric(residual?.meanRankIc)} residual ${scoreLabel}</small>
                  </td>
                  <td data-label="Fixed-blend removal Δ" class="${valueTone(-(validation.fixedBlendRemovalDeltaMeanIc ?? 0))}">
                    ${signedMetric(validation.fixedBlendRemovalDeltaMeanIc)}
                  </td>
                  <td data-label="Test raw ${scoreLabel}" class="${valueTone(component.testAudit.raw.meanRankIc)}">${signedMetric(component.testAudit.raw.meanRankIc)}</td>
                </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
    <p class="factor-qualification-disclosure">
      These components and interval claims come from candidate metadata. They
      are not inferred from Python access and are not assumed to reconstruct
      the final factor. Removal deltas apply only to the fixed equal-rank
      diagnostic blend. Validation prioritizes research; test is visible audit
      only; Portfolio, RL-action, order, account, and trading authority remain none.
    </p>`;
}

function renderBookRiskExplorer(project) {
  const section = element("book-risk-explorer");
  const explorer = project.bookRiskExplorer;
  if (!explorer) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const current = explorer.current;
  const snapshot = explorer.positionSnapshot;
  const assets = Object.keys(snapshot.weights);
  element("book-risk-meta").textContent =
    `${explorer.run.id} · ${assets.length} reported holdings · ${current.lookbackBars}-bar primary window`;
  element("book-risk-summary").innerHTML = [
    ["Annualized volatility", percent(current.annualizedVolatility), `${current.observations} aligned returns`],
    ["Effective risk bets", metric(current.effectiveRiskBets), `${assets.length} reported holdings`],
    ["First principal component", percent(current.firstPrincipalComponentVarianceShare), "correlation crowding"],
    ["Component-risk HHI", metric(current.componentRiskHhi), "lower is more diversified"],
    ["Largest contributor", explorer.riskContributions[0]?.asset ?? "—", percent(current.largestAbsoluteRiskContributorShare)],
    ["First reduction", explorer.reductionPriority[0]?.asset ?? "—", `${metric(explorer.reductionPriority[0]?.volatilityReductionPerWeight)} vol / weight`],
    ["Gross / net exposure", `${percent(current.grossExposure)} / ${percent(current.netExposure)}`, "reported snapshot"],
    ["Cash weight", percent(current.cashWeight), snapshot.baseCurrency],
  ]
    .map(
      ([label, value, note]) => `
        <span>
          <small>${escapeHtml(label)}</small>
          <b>${escapeHtml(value)}</b>
          <i>${escapeHtml(note)}</i>
        </span>`,
    )
    .join("");
  element("book-risk-lookbacks").innerHTML = `
    <div class="factor-table-wrap">
      <table class="factor-table">
        <thead>
          <tr>
            <th>Window</th>
            <th>Volatility</th>
            <th>Effective bets</th>
            <th>First PC</th>
            <th>Largest contributor</th>
            <th>First reduction</th>
          </tr>
        </thead>
        <tbody>
          ${explorer.lookbacks
            .map(
              (row) => `
                <tr>
                  <td data-label="Window"><b>${row.lookbackBars} bars</b></td>
                  <td data-label="Volatility">${percent(row.annualizedVolatility)}</td>
                  <td data-label="Effective bets">${metric(row.effectiveRiskBets)}</td>
                  <td data-label="First PC">${percent(row.firstPrincipalComponentVarianceShare)}</td>
                  <td data-label="Largest contributor"><b>${escapeHtml(row.largestAbsoluteRiskContributor)}</b><small>${percent(row.largestAbsoluteRiskContributorShare)}</small></td>
                  <td data-label="First reduction"><b>${escapeHtml(row.firstReductionAsset)}</b><small>${metric(row.firstReductionVolatilityPerWeight)} vol / weight</small></td>
                </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
  const comparison = explorer.scenarioComparison;
  const primaryScenarioRows = comparison.scenarios
    .map((scenario) => ({
      ...scenario,
      current: scenario.lookbacks.find(
        (row) => Number(row.lookbackBars) === Number(current.lookbackBars),
      ),
    }))
    .sort(
      (left, right) =>
        Number(left.current?.volatilityRank ?? Infinity) -
        Number(right.current?.volatilityRank ?? Infinity),
    );
  element("book-risk-scenarios").innerHTML =
    primaryScenarioRows.length === 0
      ? `<div class="empty-panel">No caller-supplied hypothetical books. The Run audits the reported baseline and fixed cash-funded reductions only.</div>`
      : `
        <div class="factor-table-wrap book-risk-scenario-table">
          <table class="factor-table">
            <thead>
              <tr>
                <th>Vol rank</th>
                <th>Supplied book</th>
                <th>Volatility / Δ</th>
                <th>Risk HHI / Δ</th>
                <th>Effective bets / Δ</th>
                <th>Largest contributor</th>
              </tr>
            </thead>
            <tbody>
              ${primaryScenarioRows
                .map(
                  (scenario) => `
                    <tr>
                      <td data-label="Vol rank"><b>${scenario.current.volatilityRank}</b></td>
                      <td data-label="Supplied book"><b>${escapeHtml(scenario.name)}</b><small>${escapeHtml(scenario.id)}</small></td>
                      <td data-label="Volatility / Δ"><b>${percent(scenario.current.annualizedVolatility)}</b><small>${signedPercent(scenario.current.annualizedVolatilityDelta)} vs baseline</small></td>
                      <td data-label="Risk HHI / Δ"><b>${metric(scenario.current.componentRiskHhi)}</b><small>${signedMetric(scenario.current.componentRiskHhiDelta)} vs baseline</small></td>
                      <td data-label="Effective bets / Δ"><b>${metric(scenario.current.effectiveRiskBets)}</b><small>${signedMetric(scenario.current.effectiveRiskBetsDelta)} vs baseline</small></td>
                      <td data-label="Largest contributor"><b>${escapeHtml(scenario.current.largestAbsoluteRiskContributor)}</b><small>${percent(scenario.current.largestAbsoluteRiskContributorShare)}</small></td>
                    </tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </div>`;
  const scenarioContributionRows = primaryScenarioRows.flatMap((scenario) =>
    scenario.primaryContributions.map((row) => ({
      ...row,
      scenarioName: scenario.name,
    })),
  );
  element("book-risk-scenario-contributions").innerHTML =
    scenarioContributionRows.length === 0
      ? ""
      : `
        <div class="factor-table-wrap book-risk-scenario-contribution-table">
          <table class="factor-table">
            <thead>
              <tr>
                <th>Supplied book</th>
                <th>Asset</th>
                <th>Weight baseline → scenario</th>
                <th>Absolute risk share baseline → scenario</th>
                <th>Risk-share Δ</th>
              </tr>
            </thead>
            <tbody>
              ${scenarioContributionRows
                .map(
                  (row) => `
                    <tr>
                      <td data-label="Supplied book"><b>${escapeHtml(row.scenarioName)}</b></td>
                      <td data-label="Asset"><b>${escapeHtml(row.asset)}</b></td>
                      <td data-label="Weight baseline → scenario">${percent(row.baselineWeight)} → ${percent(row.scenarioWeight)}<small>${signedPercent(row.weightDelta)}</small></td>
                      <td data-label="Absolute risk share baseline → scenario">${percent(row.baselineAbsoluteRiskShare)} → ${percent(row.scenarioAbsoluteRiskShare)}</td>
                      <td data-label="Risk-share Δ">${signedPercent(row.absoluteRiskShareDelta)}</td>
                    </tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </div>`;
  const sizing = explorer.positionSizing;
  element("book-risk-sizing").innerHTML =
    sizing.status === "not-requested"
      ? `<div class="empty-panel">No caller-bounded target-position sizing was requested.</div>`
      : `
        <div class="portfolio-summary">
          ${[
            ["Status", sizing.status, sizing.resultMeaning],
            ["Allowed leg", sizing.result.asset, `${sizing.policy.direction} against cash only`],
            ["Weight", `${percent(sizing.result.startingWeight)} → ${percent(sizing.result.resultingWeight)}`, `${signedPercent(sizing.result.weightChange)} holding change`],
            ["Cash", `${percent(sizing.result.startingCashWeight)} → ${percent(sizing.result.resultingCashWeight)}`, `${signedPercent(sizing.result.cashWeightChange)} cash change`],
            ["Modeled volatility", percent(sizing.result.annualizedVolatility), `${percent(sizing.policy.annualizedVolatilityCeiling)} ceiling · ${sizing.policy.lookbackBars} bars`],
            ["Boundary", sizing.result.ceilingSatisfied ? "satisfied" : "not reachable", sizing.status === "infeasible" ? "constrained minimum evidence, not a recommendation" : "historical covariance only"],
          ]
            .map(
              ([label, value, note]) => `
                <span>
                  <small>${escapeHtml(label)}</small>
                  <b>${escapeHtml(value)}</b>
                  <i>${escapeHtml(note)}</i>
                </span>`,
            )
            .join("")}
        </div>
        <div class="factor-table-wrap">
          <table class="factor-table">
            <thead><tr><th>Window</th><th>Volatility / Δ</th><th>Ceiling</th><th>Effective bets</th><th>Largest contributor</th></tr></thead>
            <tbody>
              ${sizing.lookbacks
                .map(
                  (row) => `
                    <tr>
                      <td data-label="Window"><b>${row.lookbackBars} bars${row.governing ? " · governing" : ""}</b></td>
                      <td data-label="Volatility / Δ">${percent(row.annualizedVolatility)}<small>${signedPercent(row.annualizedVolatilityDelta)} vs baseline</small></td>
                      <td data-label="Ceiling">${row.ceilingSatisfied ? "satisfied" : "not satisfied"}</td>
                      <td data-label="Effective bets">${metric(row.effectiveRiskBets)}</td>
                      <td data-label="Largest contributor"><b>${escapeHtml(row.largestAbsoluteRiskContributor)}</b><small>${percent(row.largestAbsoluteRiskContributorShare)}</small></td>
                    </tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </div>`;
  element("book-risk-contributions").innerHTML = `
    <div class="factor-table-wrap">
      <table class="factor-table">
        <thead><tr><th>Asset</th><th>Reported weight</th><th>Absolute risk share</th><th>Signed risk share</th></tr></thead>
        <tbody>
          ${explorer.riskContributions
            .map(
              (row) => `
                <tr>
                  <td data-label="Asset"><b>${escapeHtml(row.asset)}</b></td>
                  <td data-label="Reported weight">${percent(row.weight)}</td>
                  <td data-label="Absolute risk share">${percent(row.absoluteRiskShare)}</td>
                  <td data-label="Signed risk share">${signedPercent(row.signedRiskShare)}</td>
                </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
  element("book-risk-reductions").innerHTML = `
    <div class="factor-table-wrap">
      <table class="factor-table">
        <thead><tr><th>Priority</th><th>Asset</th><th>Reduction</th><th>Volatility reduction</th><th>Resulting volatility</th></tr></thead>
        <tbody>
          ${explorer.reductionPriority
            .map(
              (row) => `
                <tr>
                  <td data-label="Priority"><b>${row.rank}</b></td>
                  <td data-label="Asset"><b>${escapeHtml(row.asset)}</b></td>
                  <td data-label="Reduction">${percent(row.weightReduction)}</td>
                  <td data-label="Volatility reduction">${percent(row.volatilityReduction)}</td>
                  <td data-label="Resulting volatility">${percent(row.annualizedVolatility)}</td>
                </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
  const strongest = explorer.pairwiseCorrelations
    .slice()
    .sort(
      (left, right) =>
        Math.abs(right.correlation) - Math.abs(left.correlation),
    );
  element("book-risk-correlations").innerHTML = `
    <div class="factor-table-wrap">
      <table class="factor-table">
        <thead><tr><th>Pair</th><th>Correlation</th></tr></thead>
        <tbody>
          ${strongest
            .map(
              (row) => `
                <tr>
                  <td data-label="Pair"><b>${escapeHtml(row.leftAsset)} / ${escapeHtml(row.rightAsset)}</b></td>
                  <td data-label="Correlation">${metric(row.correlation)}</td>
                </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
  const rolling = explorer.rollingPath.summary;
  const command = project.commands?.find((item) => item.id === "run.book-risk");
  element("book-risk-warning").innerHTML = `
    <span>
      Reported weights are externally supplied and unauthenticated. Historical
      covariance, 1% reductions, and caller-supplied hypothetical books are
      descriptive sensitivity evidence. Caller-bounded sizing is a historical
      target-position calculation, not live account truth, a future-volatility
      guarantee, optimization search, an order, or trading authority.
      Rolling audit: ${rolling.observations} windows · minimum ${metric(rolling.minimumEffectiveRiskBets)}
      effective bets · maximum HHI ${metric(rolling.maximumComponentRiskHhi)}.
    </span>
    ${copyCommandButton(command, "Copy Book Risk JSON command")}`;
}

function renderAllocationExplorer(project) {
  const section = element("allocation-explorer");
  const explorer = project.allocationExplorer;
  if (!explorer) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const validation = explorer.splits.validation;
  const latest = explorer.latestDecision;
  const current = explorer.currentState;
  const solver = explorer.solver;
  const validationFidelity =
    explorer.constructionFidelity.bySplit.validation;
  const validationLatest = validationFidelity.latestEligibleDecision;
  element("allocation-meta").textContent =
    `${explorer.run.id} · ${explorer.contract.tradableAssets.length} tradable assets · ${latest.asOf}`;
  element("allocation-summary").innerHTML = [
    ["Conclusion", explorer.conclusion.status.toUpperCase(), "relative performance only"],
    ["Candidate net Sharpe", metric(validation.candidate.sharpe), "validation"],
    ["Reference net Sharpe", metric(validation.reference.sharpe), "validation"],
    ["Sharpe advantage", signedMetric(validation.comparison.netSharpeAdvantage), "candidate − reference"],
    ["Validation ERC fidelity", `${validationFidelity.withinToleranceDecisions}/${validationFidelity.eligibleDecisions}`, validationFidelity.withinToleranceRate === null ? "unavailable" : `${percent(validationFidelity.withinToleranceRate)} within tolerance`],
    ["Latest validation decision", validationLatest ? validationLatest.status.replaceAll("-", " ") : "UNAVAILABLE", validationLatest ? `${validationLatest.asOf} · ${percent(validationLatest.maximumContributionError)} error` : "no eligible decision"],
    ["Latest forecast vol", percent(latest.forecastAnnualizedVolatility), `${percent(explorer.contract.portfolioPolicy.annualizedVolatilityCeiling)} ceiling`],
    ["Current state", current.ordinaryRebalanceDue ? "REBALANCE DUE" : "HOLD", current.asOf],
    ["Parity error", percent(latest.maximumContributionError), latest.status.replaceAll("-", " ")],
    ["Eligible decisions", String(solver.eligibleDecisions), `${solver.withinToleranceDecisions} within tolerance`],
    ["Cap-gap decisions", String(solver.capInducedParityGapDecisions), "never mislabeled exact parity"],
  ]
    .map(
      ([label, value, note]) => `
        <span>
          <small>${escapeHtml(label)}</small>
          <b>${escapeHtml(value)}</b>
          <em>${escapeHtml(note)}</em>
        </span>`,
    )
    .join("");
  element("allocation-weights").innerHTML = `
    <div class="factor-table-wrap">
      <table class="factor-table">
        <thead><tr><th>Asset</th><th>Latest ERC target</th><th>Latest executed</th><th>Current drifted</th><th>Reference</th></tr></thead>
        <tbody>
          ${explorer.contract.universe.map((asset) => `
            <tr>
              <th>${escapeHtml(asset)}</th>
              <td>${percent(latest.targetWeights[asset])}</td>
              <td>${percent(latest.executedWeights[asset])}</td>
              <td>${percent(current.candidatePretradeWeights[asset])}</td>
              <td>${percent(current.referencePretradeWeights[asset])}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  element("allocation-path").innerHTML = `
    <div class="factor-table-wrap">
      <table class="factor-table">
        <thead><tr><th>Date</th><th>Candidate net</th><th>Reference net</th><th>Gross</th><th>Forecast vol</th></tr></thead>
        <tbody>
          ${explorer.path.slice(-16).map((row) => `
            <tr>
              <th>${escapeHtml(row.timestamp)}</th>
              <td>${signedPercent(row.candidateNetReturn)}</td>
              <td>${signedPercent(row.referenceNetReturn)}</td>
              <td>${percent(row.candidateGrossExposure)}</td>
              <td>${percent(row.candidateForecastVolatility)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  const command = project.commands?.find((item) => item.id === "run.allocation");
  element("allocation-warning").innerHTML = `
    <span>Strict accounting, weights, solver counts, split construction fidelity, validation authority, and no-trading boundary rederived from immutable artifacts. Relative performance and ERC construction fidelity remain separate conclusions.</span>
    ${copyCommandButton(command, "Copy Allocation Explorer CLI")}`;
}

function renderBookPathStressExplorer(project) {
  const section = element("book-path-stress-explorer");
  const explorer = project.bookPathStressExplorer;
  if (!explorer) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const summary = explorer.summary;
  element("book-path-stress-meta").textContent =
    `${explorer.run.id} · ${summary.eligibleWindowCount} complete windows · ${summary.selectedEpisodeCount} selected`;
  element("book-path-stress-summary").innerHTML = [
    ["Worst terminal", signedPercent(summary.worstTerminalBookReturn), "fixed opening units"],
    ["Complete windows", String(summary.eligibleWindowCount), `${explorer.policy.path.holdingBars} following sessions`],
    ["Selected episodes", String(summary.selectedEpisodeCount), "inclusive non-overlap"],
    ["Same dominant holding", summary.sameDominantLossContributorAcrossAllEpisodes ? "yes" : "no", summary.dominantLossContributorAcrossAllEpisodes ?? "mixed contributors"],
  ].map(([label, value, note]) => `
    <span><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b><em>${escapeHtml(note)}</em></span>`).join("");
  element("book-path-stress-episodes").innerHTML = `
    <div class="factor-table-wrap"><table class="factor-table">
      <thead><tr><th>Rank</th><th>Start → end</th><th>Terminal</th><th>Worst interim</th><th>At</th><th>Dominant loss</th></tr></thead>
      <tbody>${explorer.episodes.map((row) => `
        <tr><th>${row.rank}</th><td>${escapeHtml(row.startTimestamp)} → ${escapeHtml(row.endTimestamp)}</td>
        <td>${signedPercent(row.terminalBookReturn)}</td><td>${signedPercent(row.worstInterimBookReturn)}</td>
        <td>${escapeHtml(row.worstInterimTimestamp)}</td><td>${escapeHtml(row.dominantLossContributor)}</td></tr>`).join("")}</tbody>
    </table></div>`;
  element("book-path-stress-contributions").innerHTML = `
    <div class="factor-table-wrap"><table class="factor-table">
      <thead><tr><th>Episode</th><th>Holding</th><th>Opening weight</th><th>Asset return</th><th>Contribution</th></tr></thead>
      <tbody>${explorer.contributions.map((row) => `
        <tr><th>${row.rank}</th><td>${escapeHtml(row.asset)}</td><td>${percent(row.openingWeight)}</td>
        <td>${signedPercent(row.terminalAssetReturn)}</td><td>${signedPercent(row.terminalContribution)}</td></tr>`).join("")}</tbody>
    </table></div>`;
  const command = project.commands?.find((item) => item.id === "run.book-path-stress");
  element("book-path-stress-warning").innerHTML = `
    <span>${escapeHtml(explorer.warning)}</span>
    ${copyCommandButton(command, "Copy Path Stress Explorer CLI")}`;
}

function renderEventStudyExplorer(project) {
  const section = element("event-study-explorer");
  const explorer = project.eventStudyExplorer;
  if (!explorer) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const policy = explorer.policy;
  const populations = explorer.populations;
  const primary = explorer.distributions.primaryEventAsset;
  const excess = explorer.distributions.primaryEventExcess;
  const unconditional = explorer.distributions.unconditionalAsset;
  const comparison = explorer.comparisons;
  element("event-study-meta").textContent =
    `${explorer.run.id} · ${policy.event.asset} · ${populations.primaryEvents} primary events`;
  element("event-study-summary").innerHTML = [
    ["Conclusion", explorer.conclusion.status.replaceAll("-", " "), `${explorer.conclusion.observedPrimaryEvents}/${explorer.conclusion.minimumEvents} minimum events`],
    ["Fixed event", `${percent(policy.event.thresholdReturn)} opening gap`, `${policy.event.comparator}`],
    ["Entry / exit", `t+${policy.timing.waitBars} / +${policy.timing.holdingBars}`, "adjusted closes"],
    ["Raw / primary", `${populations.completeEvents} / ${populations.primaryEvents}`, `${populations.overlapExcludedEvents} overlap-excluded`],
    ["Primary mean", percent(primary.mean), `${percent(primary.positiveRate)} positive`],
    ["Unconditional mean", percent(unconditional.mean), `${signedPercent(comparison.primaryMeanMinusUnconditionalAssetMean)} delta`],
    ["Matched excess", signedPercent(excess.mean), policy.references.matchedAsset],
    ["Right-censored", String(populations.rightCensoredEvents), "preserved in ledger"],
  ]
    .map(
      ([label, value, note]) => `
        <span>
          <small>${escapeHtml(label)}</small>
          <b>${escapeHtml(value)}</b>
          <em>${escapeHtml(note)}</em>
        </span>`,
    )
    .join("");
  const distributionRows = [
    ["Primary event", primary],
    [`Matched ${policy.references.matchedAsset}`, explorer.distributions.primaryMatchedReference],
    ["Event excess", excess],
    ["Unconditional asset", unconditional],
    ["Raw complete event", explorer.distributions.rawEventAsset],
  ];
  element("event-study-distributions").innerHTML = `
    <div class="factor-table-wrap">
      <table class="factor-table">
        <thead><tr><th>Population</th><th>N</th><th>Mean</th><th>Median</th><th>Positive</th><th>Min</th><th>Max</th></tr></thead>
        <tbody>
          ${distributionRows.map(([label, row]) => `
            <tr>
              <th>${escapeHtml(label)}</th>
              <td>${row.count}</td>
              <td>${signedPercent(row.mean)}</td>
              <td>${signedPercent(row.median)}</td>
              <td>${percent(row.positiveRate)}</td>
              <td>${signedPercent(row.minimum)}</td>
              <td>${signedPercent(row.maximum)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  element("event-study-events").innerHTML = `
    <div class="factor-table-wrap">
      <table class="factor-table">
        <thead><tr><th>Event</th><th>Entry → exit</th><th>Gap</th><th>Asset</th><th>Reference</th><th>Excess</th><th>Population</th></tr></thead>
        <tbody>
          ${explorer.events.map((row) => `
            <tr>
              <th>${escapeHtml(row.eventTimestamp)}</th>
              <td>${escapeHtml(row.entryTimestamp ?? "—")} → ${escapeHtml(row.exitTimestamp ?? "—")}</td>
              <td>${signedPercent(row.gapReturn)}</td>
              <td>${signedPercent(row.assetReturn)}</td>
              <td>${signedPercent(row.referenceReturn)}</td>
              <td>${signedPercent(row.excessReturn)}</td>
              <td>${escapeHtml(row.primaryEligible ? "primary" : row.overlapReason)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
  const command = project.commands?.find((item) => item.id === "run.event-study");
  element("event-study-warning").innerHTML = `
    <span>${escapeHtml(explorer.warning)}</span>
    ${copyCommandButton(command, "Copy Event Study Explorer CLI")}`;
}

function renderFactorExplorer(project) {
  const section = element("factor-explorer");
  const explorer = project.factorExplorer;
  if (!explorer) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const supportedHorizons =
    explorer.researchHorizon.diagnosticForwardBars.map(String);
  if (!supportedHorizons.includes(state.factorHorizon)) {
    state.factorHorizon = String(
      explorer.researchHorizon.primaryForwardBars,
    );
  }
  element("factor-horizon-controls").innerHTML =
    explorer.researchHorizon.diagnosticForwardBars
      .map(
        (horizon) => `
          <button type="button" role="tab"
            aria-selected="${String(String(horizon) === state.factorHorizon)}"
            data-factor-horizon="${horizon}">
            ${horizon}${horizon === explorer.researchHorizon.primaryForwardBars ? " bar · primary" : ""}
          </button>`,
      )
      .join("");
  document.querySelectorAll("[data-factor-horizon]").forEach((button) => {
    button.addEventListener("click", () => {
      state.factorHorizon = button.dataset.factorHorizon;
      renderFactorChart(explorer);
    });
  });
  const summary = explorer.summary;
  const validation = summary.validation;
  const test = summary.testAudit;
  const availability = explorer.inputAvailability;
  element("factor-meta").textContent =
    `${explorer.run.id} · ${explorer.factorOutcome.kind} · ${explorer.dataset.universe.length} assets · ${explorer.researchHorizon.primaryForwardBars}-bar validation selection`;
  element("factor-summary").innerHTML = [
    ["Validation rank IC", metric(validation.meanRankIc), `${validation.observations} observations`],
    ["HAC t / p", `${metric(validation.hacTStatistic)} / ${metric(validation.hacNormalPValue)}`, "normal approximation"],
    ["Weakest validation fold", metric(summary.weakestValidationFold?.meanRankIc), summary.weakestValidationFold?.id ?? "unavailable"],
    ["Maximum style overlap", metric(summary.maximumValidationStyleOverlap?.absoluteMeanRankCorrelation), summary.maximumValidationStyleOverlap?.style?.replaceAll("_", " ") ?? "unavailable"],
    ["Input panel", availability?.available ? percent(availability.observationCoverage) : "legacy", availability?.available ? `${availability.assetsPerTimestamp.input.minimum}/${availability.assetsPerTimestamp.input.median}/${availability.assetsPerTimestamp.input.maximum} min/median/max assets` : "availability unavailable"],
    ["Coverage", percent(summary.meanCoverage), "mean asset availability"],
    ["Rank turnover", percent(summary.meanRankTurnover), "full-scope diagnostic"],
    ["Test rank IC", metric(test.meanRankIc), "VISIBLE AUDIT ONLY"],
  ]
    .map(
      ([label, value, note]) => `
        <span>
          <small>${escapeHtml(label)}</small>
          <b>${escapeHtml(value)}</b>
          <i>${escapeHtml(note)}</i>
        </span>`,
    )
    .join("");
  renderFactorQualification(explorer);
  renderFactorComponents(explorer);
  renderFactorChart(explorer);
  renderFactorHorizons(explorer);
  renderFactorStability(explorer);
  const command = project.commands?.find((item) => item.id === "run.factor");
  element("factor-warning").innerHTML = `
    <span>${escapeHtml(explorer.warning)}</span>
    ${copyCommandButton(command, "Copy Factor JSON command")}`;
}

function splitBands(explorer, xScale, top, height) {
  const splits = explorer.selection.splits;
  return ["train", "validation", "test"]
    .map((name) => {
      const split = splits[name];
      const left = xScale(chartTime(split.start));
      const right = xScale(chartTime(split.end));
      return `
        <rect class="split-band ${name}" x="${left.toFixed(2)}" y="${top}"
          width="${Math.max(0, right - left).toFixed(2)}" height="${height}">
          <title>${escapeHtml(name)} · ${escapeHtml(split.role)}</title>
        </rect>`;
    })
    .join("");
}

function chartDateLabels(explorer, xScale, y) {
  const first = explorer.path.points[0].timestamp;
  const last = explorer.path.points.at(-1).timestamp;
  const validation = explorer.selection.splits.validation.start;
  const test = explorer.selection.splits.test.start;
  return [first, validation, test, last]
    .map(
      (timestamp, index, values) => `
        <text class="chart-axis-label" x="${xScale(chartTime(timestamp)).toFixed(2)}"
          y="${y}" text-anchor="${index === 0 ? "start" : index === values.length - 1 ? "end" : "middle"}">
          ${escapeHtml(timestamp)}
        </text>`,
    )
    .join("");
}

function renderPerformanceChart(explorer) {
  const points = explorer.path.points;
  const width = 760;
  const left = 42;
  const right = 12;
  const firstTime = chartTime(points[0].timestamp);
  const lastTime = chartTime(points.at(-1).timestamp);
  const timeSpread = Math.max(1, lastTime - firstTime);
  const xScale = (value) => {
    const ratio = Math.max(0, Math.min(1, (value - firstTime) / timeSpread));
    return left + ratio * (width - left - right);
  };
  const growthValues = points.flatMap((point) => [
    point.netGrowth,
    point.grossGrowth,
    point.benchmarkGrowth,
  ]);
  const growthMin = Math.min(...growthValues);
  const growthMax = Math.max(...growthValues);
  const growthSpread = Math.max(1e-9, growthMax - growthMin);
  const growthTop = 18;
  const growthHeight = 164;
  const growthY = (value) =>
    growthTop + ((growthMax - value) / growthSpread) * growthHeight;
  const drawdownTop = 207;
  const drawdownHeight = 52;
  const drawdownMin = Math.min(
    -1e-9,
    ...points.map((point) => point.drawdown),
  );
  const drawdownY = (value) =>
    drawdownTop + (value / drawdownMin) * drawdownHeight;
  const drawdownArea = `${chartPath(points, (point) => point.drawdown, xScale, drawdownY)} L${xScale(lastTime).toFixed(2)},${drawdownTop} L${xScale(firstTime).toFixed(2)},${drawdownTop} Z`;
  return `
    <svg viewBox="0 0 ${width} 286" role="img"
      aria-label="Net, gross, and benchmark growth with net drawdown">
      ${splitBands(explorer, xScale, growthTop, 241)}
      <line class="chart-grid-line" x1="${left}" x2="${width - right}"
        y1="${growthY(1).toFixed(2)}" y2="${growthY(1).toFixed(2)}"></line>
      <text class="chart-value-label" x="4" y="${(growthTop + 8).toFixed(2)}">${metric(growthMax)}×</text>
      <text class="chart-value-label" x="4" y="${(growthTop + growthHeight).toFixed(2)}">${metric(growthMin)}×</text>
      <path class="chart-line benchmark" d="${chartPath(points, (point) => point.benchmarkGrowth, xScale, growthY)}"></path>
      <path class="chart-line gross" d="${chartPath(points, (point) => point.grossGrowth, xScale, growthY)}"></path>
      <path class="chart-line net" d="${chartPath(points, (point) => point.netGrowth, xScale, growthY)}"></path>
      <line class="chart-grid-line" x1="${left}" x2="${width - right}"
        y1="${drawdownTop}" y2="${drawdownTop}"></line>
      <path class="drawdown-area" d="${drawdownArea}"></path>
      <text class="chart-value-label adverse" x="4" y="${drawdownTop + drawdownHeight}">${signedPercent(drawdownMin)}</text>
      ${chartDateLabels(explorer, xScale, 280)}
    </svg>
    <div class="chart-legend">
      <span><i class="net"></i>Net growth</span>
      <span><i class="gross"></i>Gross growth</span>
      <span><i class="benchmark"></i>Benchmark</span>
      <span><i class="drawdown"></i>Net drawdown</span>
      <span class="chart-role">validation = selection · test = visible audit</span>
    </div>`;
}

function renderExposureChart(explorer) {
  const points = explorer.path.points;
  const width = 760;
  const left = 42;
  const right = 12;
  const firstTime = chartTime(points[0].timestamp);
  const lastTime = chartTime(points.at(-1).timestamp);
  const timeSpread = Math.max(1, lastTime - firstTime);
  const xScale = (value) => {
    const ratio = Math.max(0, Math.min(1, (value - firstTime) / timeSpread));
    return left + ratio * (width - left - right);
  };
  const exposureValues = points.flatMap((point) => [
    point.grossExposure,
    point.netExposure,
  ]);
  const exposureMin = Math.min(-0.05, ...exposureValues);
  const exposureMax = Math.max(0.05, ...exposureValues);
  const exposureSpread = exposureMax - exposureMin;
  const exposureTop = 18;
  const exposureHeight = 164;
  const exposureY = (value) =>
    exposureTop + ((exposureMax - value) / exposureSpread) * exposureHeight;
  const turnoverTop = 207;
  const turnoverHeight = 52;
  const maximumTurnover = Math.max(
    1e-9,
    ...points.map((point) => point.oneWayTurnover),
  );
  const barWidth = Math.max(
    1,
    (width - left - right) / Math.max(points.length, 1) - 1,
  );
  const bars = points
    .map((point) => {
      const height = (point.oneWayTurnover / maximumTurnover) * turnoverHeight;
      return `<rect class="turnover-bar ${point.rebalanced ? "rebalanced" : ""}"
        x="${(xScale(chartTime(point.timestamp)) - barWidth / 2).toFixed(2)}"
        y="${(turnoverTop + turnoverHeight - height).toFixed(2)}"
        width="${barWidth.toFixed(2)}" height="${height.toFixed(2)}">
        <title>${escapeHtml(point.timestamp)} · turnover ${metric(point.oneWayTurnover)} · cost ${metric(point.cost)}</title>
      </rect>`;
    })
    .join("");
  return `
    <svg viewBox="0 0 ${width} 286" role="img"
      aria-label="Gross and net exposure with one-way turnover">
      ${splitBands(explorer, xScale, exposureTop, 241)}
      <line class="chart-grid-line" x1="${left}" x2="${width - right}"
        y1="${exposureY(0).toFixed(2)}" y2="${exposureY(0).toFixed(2)}"></line>
      <text class="chart-value-label" x="4" y="${exposureTop + 8}">${metric(exposureMax)}×</text>
      <text class="chart-value-label" x="4" y="${exposureTop + exposureHeight}">${metric(exposureMin)}×</text>
      <path class="chart-line exposure-gross" d="${chartPath(points, (point) => point.grossExposure, xScale, exposureY)}"></path>
      <path class="chart-line exposure-net" d="${chartPath(points, (point) => point.netExposure, xScale, exposureY)}"></path>
      <line class="chart-grid-line" x1="${left}" x2="${width - right}"
        y1="${turnoverTop + turnoverHeight}" y2="${turnoverTop + turnoverHeight}"></line>
      ${bars}
      <text class="chart-value-label" x="4" y="${turnoverTop + 9}">turn</text>
      ${chartDateLabels(explorer, xScale, 280)}
    </svg>
    <div class="chart-legend">
      <span><i class="exposure-gross"></i>Gross exposure</span>
      <span><i class="exposure-net"></i>Net exposure</span>
      <span><i class="turnover"></i>One-way turnover</span>
      <span class="chart-role">historical research weights · not live holdings</span>
    </div>`;
}

function renderPortfolioChart(explorer) {
  const performance = state.portfolioView === "performance";
  element("portfolio-chart-title").textContent = performance
    ? "Growth & drawdown"
    : "Exposure & implementation";
  element("portfolio-chart-note").textContent = performance
    ? `${explorer.path.totalRows} full rows → ${explorer.path.sampledRows} deterministic points`
    : "Executed book, one-way turnover, and rebalance days";
  element("portfolio-chart").innerHTML = performance
    ? renderPerformanceChart(explorer)
    : renderExposureChart(explorer);
  document.querySelectorAll("[data-portfolio-view]").forEach((button) => {
    button.setAttribute(
      "aria-selected",
      String(button.dataset.portfolioView === state.portfolioView),
    );
  });
}

function signalStateLabel(value) {
  if (value === 1) return "LONG";
  if (value === -1) return "SHORT";
  return "FLAT";
}

function mandateMarkup(mandate) {
  const tradable = mandate.tradableAssets.join(", ");
  const context = mandate.contextAssets.length
    ? `${mandate.contextAssets.length} context-only`
    : "no context-only assets";
  const lock = mandate.available
    ? `LOCKED · ${String(mandate.id).slice(-8)}`
    : "LEGACY · implicit";
  const risk = mandate.riskPolicy;
  const riskLabel = risk
    ? `${percent(risk.annualizedVolatilityCeiling)} · scale-down only`
    : "legacy · none";
  const implementation = mandate.implementationPolicy;
  const decision = implementation?.decisionPolicy;
  const decisionLabel = decision
    ? decision.bars === 1
      ? "every base bar"
      : `every ${decision.bars} base bars`
    : "legacy every-bar";
  const implementationLabel = implementation
    ? `${metric(implementation.baseCostBps)} bps · ${percent(implementation.noTradeOneWay)} band · ${decisionLabel} · NAV ${metric(implementation.referenceNav)}`
    : "legacy defaults";
  const namedCaps = Object.entries(mandate.assetMaxAbsWeights ?? {})
    .filter(
      ([asset, value]) =>
        mandate.tradableAssets.includes(asset) &&
        Math.abs(value - mandate.maxAbsWeight) > 1e-12,
    )
    .map(([asset, value]) => `${asset} ${percent(value)}`)
    .join(" · ");
  const roleLabel = Object.entries(mandate.assetPositionRoles ?? {})
    .map(([asset, role]) => `${asset} ${role}`)
    .join(" · ");
  const sideLimits =
    mandate.longGrossLimit == null || mandate.shortGrossLimit == null
      ? "legacy"
      : `L ${metric(mandate.longGrossLimit)} · S ${metric(mandate.shortGrossLimit)}`;
  const benchmark = mandate.benchmark;
  const benchmarkLabel =
    benchmark.kind === "single-asset-long"
      ? `${benchmark.asset} · long reference`
      : benchmark.kind;
  return `
    <span class="mandate-direction">${escapeHtml(mandate.direction.toUpperCase())}</span>
    <span><small>Construction</small><b>${escapeHtml(mandate.family)}</b></span>
    <span class="mandate-assets"><small>Authorized positions</small><b>${escapeHtml(tradable)}</b><i>${escapeHtml(context)}</i></span>
    <span><small>Asset roles / side limits</small><b>${escapeHtml(sideLimits)}</b><i>${escapeHtml(roleLabel || "legacy implicit")}</i></span>
    <span><small>Gross / default cap</small><b>${metric(mandate.grossLimit)} / ${percent(mandate.maxAbsWeight)}</b><i>${escapeHtml(namedCaps || "all tradable assets use default")}</i></span>
    <span><small>Risk ceiling</small><b>${escapeHtml(riskLabel)}</b></span>
    <span><small>Cost / rebalance / NAV</small><b>${escapeHtml(implementationLabel)}</b><i>${escapeHtml(mandate.policySource)}</i></span>
    <span><small>Benchmark</small><b>${escapeHtml(benchmarkLabel)}</b><i>${escapeHtml(benchmark.source)} · evaluation only</i></span>
    <code>${escapeHtml(lock)}</code>`;
}

function percentilePointDistance(value) {
  return value == null ? "rank unavailable" : `${(value * 100).toFixed(1)}pp`;
}

function renderPortfolioMechanicalDecision(explorer) {
  const decision = explorer.mechanicalDecision;
  const translation = explorer.signalPolicy?.translation;
  const signal = decision.signalGate;
  const target = decision.targetGate;
  const execution = decision.executionGate;
  const executionLabel = !execution.available
    ? "LEGACY GATE"
    : execution.riskOverride
      ? "RISK OVERRIDE"
      : !execution.decisionEligible
        ? "SCHEDULED HOLD"
      : execution.ordinaryRebalance
        ? "REBALANCE"
        : "NO-TRADE HOLD";
  const finalLabel = execution.rebalanced ? "BOOK CHANGED" : "BOOK HELD";
  const signalLabel = signal.stateChanges
    ? `${signal.stateChanges} state change${signal.stateChanges === 1 ? "" : "s"}`
    : "State retained";
  const scoreDisclosure =
    translation?.evaluationMode === "single-asset-temporal"
      ? `Causal own-history percentile · latest ${translation.windowObservations} observed values · minimum ${translation.minimumObservations}`
      : translation?.evaluationMode === "two-asset-relative-value"
        ? `Causal ordered factor-spread percentile · latest ${translation.windowObservations} observed spreads · complementary pair scores`
        : "Same-timestamp percentile across prediction assets only";
  document.getElementById("portfolio-mechanical-decision").innerHTML = `
    <div class="mechanical-chain" role="list" aria-label="Mechanical portfolio decision chain">
      <span role="listitem">
        <small>01 · Signal state</small>
        <b>${escapeHtml(signalLabel)}</b>
        <i>${signal.unavailableScores} unavailable · ${signal.contextAssets} context</i>
      </span>
      <span role="listitem" class="${target.riskLimited ? "warning" : ""}">
        <small>02 · Target + risk</small>
        <b>${metric(target.preGovernorGross)} → ${metric(target.governedTargetGross)} gross</b>
        <i>${escapeHtml(target.riskGovernorStatus)} · scale ${metric(target.riskGovernorScale)}</i>
      </span>
      <span role="listitem" class="${execution.riskOverride ? "warning" : ""}">
        <small>03 · Execution gate</small>
        <b>${escapeHtml(executionLabel)}</b>
        <i>${execution.decisionEligible ? "eligible" : "ineligible"} · ${escapeHtml(execution.decisionSchedule.kind === "calendar-month-end" ? "calendar month-end" : `every ${execution.decisionSchedule.bars} base bar${execution.decisionSchedule.bars === 1 ? "" : "s"} / ${execution.decisionSchedule.anchor}`)} · ${escapeHtml(execution.decisionSession)} · ${percent(execution.proposedOneWayTurnover)} proposed / ${percent(execution.noTradeOneWay)} band</i>
      </span>
      <span role="listitem">
        <small>04 · Historical book</small>
        <b>${escapeHtml(finalLabel)}</b>
        <i>${percent(execution.finalOneWayTurnover)} traded · ${metric(execution.executedGross)} gross</i>
      </span>
    </div>
    <div class="trigger-disclosure">
      ${escapeHtml(scoreDisclosure)} · context assets are never ranked · not price targets,
      probabilities, orders, or account positions · ${escapeHtml(execution.reason)}
    </div>
    <div class="mechanical-table-scroll">
      <div class="mechanical-table" role="table" aria-label="Current per-asset mechanical signal triggers">
        <div class="mechanical-row heading" role="row">
          <span>Asset / state</span>
          <span>Score / event</span>
          <span>Next state trigger</span>
          <span>Raw → target</span>
          <span>Pretrade → executed</span>
          <span>Action</span>
        </div>
        ${decision.positions
          .map((position) => {
            const stateLabel = position.tradable
              ? signalStateLabel(position.signalState)
              : "CONTEXT";
            const side = !position.tradable
              ? "context"
              : position.signalState > 0
                ? "long"
                : position.signalState < 0
                  ? "short"
                  : "flat";
            const triggers = position.nextTriggers.length
              ? position.nextTriggers
                  .map(
                    (trigger) => `
                      <i class="trigger-condition">
                        <b>${escapeHtml(trigger.event)}</b>
                        <code>${escapeHtml(trigger.comparator)} P${(trigger.threshold * 100).toFixed(0)}</code>
                        <small>Δ ${escapeHtml(percentilePointDistance(trigger.distance))}</small>
                      </i>`,
                  )
                  .join("")
              : '<i class="trigger-condition unavailable"><b>not authorized</b><small>context only</small></i>';
            return `
              <div class="mechanical-row ${position.tradable ? "" : "context-only"}" role="row">
                <span class="mechanical-asset">
                  <b>${escapeHtml(position.asset)}</b>
                  <i class="${side}">${escapeHtml(stateLabel)}</i>
                  <small>${escapeHtml(position.allocationStatus)}</small>
                </span>
                <span>
                  <b>${position.scoreAvailable ? `P${(position.score * 100).toFixed(0)}` : "N/A"}</b>
                  <small>${escapeHtml(position.signalEvent)}</small>
                </span>
                <span class="trigger-stack">${triggers}</span>
                <span>
                  <b>${signedPercent(position.preGovernorTargetWeight)} → ${signedPercent(position.targetWeight)}</b>
                  <small>${signedPercent(position.proposedTradeWeight)} proposed trade</small>
                </span>
                <span>
                  <b>${signedPercent(position.pretradeWeight)} → ${signedPercent(position.executedWeight)}</b>
                  <small>${signedPercent(position.tradeWeight)} actual trade</small>
                </span>
                <span>
                  <b>${escapeHtml(position.executionAction)}</b>
                  <small>${escapeHtml(position.executionReason)}</small>
                </span>
              </div>`;
          })
          .join("")}
      </div>
    </div>`;
}

function renderPortfolioSizingAnatomy(explorer) {
  const sizing = explorer.sizingAnatomy;
  const construction = sizing.construction;
  const component = sizing.componentRisk;
  const sideCards = sizing.sides
    .map(
      (side) => `
        <span class="${side.allocationFeasible ? "" : "warning"}">
          <small>${escapeHtml(side.side)} side · ${side.activeAssets} active</small>
          <b>${percent(side.fundedRawBudget)} / ${percent(side.configuredBudget)} funded</b>
          <i>cap capacity ${percent(side.capCapacity)} · at cap ${side.atCapAssets.length ? escapeHtml(side.atCapAssets.join(", ")) : "none"}</i>
        </span>`,
    )
    .join("");
  element("portfolio-sizing-anatomy").innerHTML = `
    <div class="sizing-summary">
      ${sideCards}
      <span>
        <small>Risk governor</small>
        <b>${metric(construction.riskGovernorScale)} scale</b>
        <i>${percent(construction.rawGross)} raw → ${percent(construction.governedGross)} governed</i>
      </span>
      <span class="${component.available ? "" : "warning"}">
        <small>Executed component risk</small>
        <b>${component.available ? `HHI ${metric(component.absoluteConcentrationHhi)}` : "UNAVAILABLE"}</b>
        <i>largest ${escapeHtml(component.largestAbsoluteContributor ?? "none")}</i>
      </span>
    </div>
    <div class="sizing-disclosure">
      Percentile-distance conviction ÷ causal trailing volatility. Proportional weights are
      water-filled within each permitted side and caller-owned per-asset caps
      (default ${percent(construction.maxAbsWeight)}),
      then scaled only down by portfolio covariance risk. Diagonal risk is a sizing heuristic;
      component risk is the historical executed-book covariance decomposition. No order authority.
    </div>
    <div class="sizing-table-scroll">
      <div class="sizing-table" role="table" aria-label="Current per-asset position sizing anatomy">
        <div class="sizing-row heading" role="row">
          <span>Asset / side</span>
          <span>Score / conviction</span>
          <span>Vol / strength</span>
          <span>Side share</span>
          <span>Proportional → raw</span>
          <span>Governed → executed</span>
          <span>Diagonal → component risk</span>
        </div>
        ${sizing.positions
          .map((position) => {
            const capLabel = position.atCap
              ? '<i class="sizing-cap">AT CAP</i>'
              : position.proportionalWeightExceedsCap
                ? '<i class="sizing-cap">CAP APPLIED</i>'
                : "";
            return `
              <div class="sizing-row ${position.tradable ? "" : "context-only"}" role="row">
                <span>
                  <b>${escapeHtml(position.asset)}</b>
                  <small>${escapeHtml(position.side.toUpperCase())}</small>
                </span>
                <span>
                  <b>${position.score == null ? "N/A" : `P${(position.score * 100).toFixed(0)}`} / ${metric(position.conviction)}</b>
                  <small>percentile distance</small>
                </span>
                <span>
                  <b>${position.trailingVolatility == null ? "N/A" : percent(position.trailingVolatility)}</b>
                  <small>strength ${metric(position.riskStrength)}</small>
                </span>
                <span>
                  <b>${percent(position.sameSideStrengthShare)}</b>
                  <small>same-side risk strength</small>
                </span>
                <span>
                  <b>${signedPercent(position.proportionalWeightBeforeCap)} → ${signedPercent(position.rawWeight)}</b>
                  <small>cap ${percent(position.maxAbsWeight)} · Δ ${signedPercent(position.allocationDeltaFromProportional)}</small>
                  ${capLabel}
                </span>
                <span>
                  <b>${signedPercent(position.governedWeight)} → ${signedPercent(position.executedWeight)}</b>
                  <small>risk scale ${metric(position.riskGovernorScale)}</small>
                </span>
                <span>
                  <b>${signedPercent(position.diagonalRiskBudgetShare)} → ${position.componentRiskAvailable ? signedPercent(position.componentRiskShare) : "N/A"}</b>
                  <small>heuristic → covariance</small>
                </span>
              </div>`;
          })
          .join("")}
      </div>
    </div>`;
}

function renderPortfolioDiversificationStress(explorer) {
  const stress = explorer.diversificationStress;
  const current = stress.current;
  const target = element("portfolio-diversification-stress");
  const available = current.state === "available";
  const scenarioLabels = Object.fromEntries(
    stress.shock.scenarios.map((item) => [item.id, item.label]),
  );
  const breachTone =
    current.stressBreachesCeiling === true ? "adverse" : available ? "positive" : "warning";
  const currentLadder = current.scenarios
    .map(
      (scenario) => `
        <span class="${scenario.breachesCeiling === true ? "adverse" : scenario.breachesCeiling === false ? "positive" : "warning"}">
          <small>${escapeHtml(scenarioLabels[scenario.id] ?? scenario.id)}</small>
          <b>${percent(scenario.forecastAnnualized)} · ${metric(scenario.multiplier)}×</b>
          <i>${percent(scenario.blendToPerfectCorrelation)} toward perfect alignment · ceiling breach ${String(scenario.breachesCeiling)}</i>
        </span>`,
    )
    .join("");
  const splitCards = ["validation", "test"]
    .map((id) => {
      const split = stress[id];
      const ladder = split.scenarios
        .map(
          (scenario) =>
            `${percent(scenario.blendToPerfectCorrelation)} ${
              scenario.stressBreachRate == null
                ? "—"
                : percent(scenario.stressBreachRate)
            }`,
        )
        .join(" · ");
      return `
        <span>
          <small>${escapeHtml(id)} · ${escapeHtml(split.role)}</small>
          <b>${ladder}</b>
          <i>25% / 50% / 100% ceiling-breach rate · endpoint multiplier med / p95 / max ${metric(split.medianStressMultiplier)}× / ${metric(split.p95StressMultiplier)}× / ${metric(split.maximumStressMultiplier)}×</i>
          <i>effective bets med / min ${metric(split.medianEffectiveRiskBets)} / ${metric(split.minimumEffectiveRiskBets)} · ${split.availableDates}/${split.totalDates} dates</i>
        </span>`;
    })
    .join("");
  const activePositions = current.positions.filter((item) => item.active);
  target.innerHTML = `
    <div class="diversification-summary">
      <span class="${available ? "" : "warning"}">
        <small>Effective risk bets</small>
        <b>${available ? metric(current.effectiveRiskBets) : current.state.replaceAll("-", " ").toUpperCase()}</b>
        <i>${current.activeAssets} active · HHI ${metric(current.absoluteComponentRiskHhi)}</i>
      </span>
      <span>
        <small>Observed covariance forecast</small>
        <b>${percent(current.sampleForecastAnnualized)}</b>
        <i>${current.covarianceObservations} causal observations</i>
      </span>
      <span class="${breachTone}">
        <small>Perfect-correlation upper bound</small>
        <b>${percent(current.perfectCorrelationForecastAnnualized)} · ${metric(current.stressMultiplier)}×</b>
        <i>ceiling ${percent(current.ceilingAnnualized)} · breach ${String(current.stressBreachesCeiling)}</i>
      </span>
      <span>
        <small>Largest component-risk contributor</small>
        <b>${escapeHtml(current.largestAbsoluteComponentRiskContributor ?? "NONE")}</b>
        <i>signed components retain hedging effects</i>
      </span>
    </div>
    <div class="diversification-ladder" aria-label="Current correlation breakdown stress ladder">
      ${currentLadder}
    </div>
    <div class="diversification-disclosure">
      The ladder rebuilds the same causal covariance horizon, then blends 25%, 50%, and 100%
      toward the perfect position-aligned endpoint that reinforces PnL risk. Scenarios are
      deterministic context with no assigned probability, selection role, resizing authority,
      or trading authority.
    </div>
    <div class="diversification-splits">${splitCards}</div>
    ${
      activePositions.length
        ? `
          <div class="diversification-table-scroll">
            <div class="diversification-table" role="table" aria-label="Current diversification stress by asset">
              <div class="diversification-row heading" role="row">
                <span>Asset</span>
                <span>Executed weight</span>
                <span>Causal own vol</span>
                <span>Signed component risk</span>
                <span>Absolute component share</span>
                <span>Stress-risk share</span>
              </div>
              ${activePositions
                .map(
                  (position) => `
                    <div class="diversification-row" role="row">
                      <span><b>${escapeHtml(position.asset)}</b></span>
                      <span>${signedPercent(position.executedWeight)}</span>
                      <span>${percent(position.causalOwnVolatility)}</span>
                      <span class="${position.componentRiskShare < 0 ? "positive" : ""}">${signedPercent(position.componentRiskShare)}</span>
                      <span>${percent(position.absoluteComponentRiskShare)}</span>
                      <span>${percent(position.stressRiskShare)}</span>
                    </div>`,
                )
                .join("")}
            </div>
          </div>`
        : '<div class="empty-panel">The current historical book is flat or lacks a complete causal covariance history.</div>'
    }`;
}

function renderPortfolioStrategyViability(explorer) {
  const viability = explorer.strategyViability;
  const diagnosis = viability.diagnosis;
  const validation = viability.validation;
  const test = viability.test;
  const friction = validation.friction;
  const temporal = validation.temporal;
  const breakEven = friction.breakEvenCost;
  const breakEvenLabel =
    breakEven.bps == null
      ? breakEven.status.replaceAll("-", " ")
      : `${metric(breakEven.bps)} bps`;
  const stageLabel = diagnosis.stage.replaceAll("-", " ").toUpperCase();
  const stageTone =
    diagnosis.stage === "post-cost-edge-positive" ? "positive" : "adverse";
  const costCurve = validation.costStress
    .map(
      (item) => `
        <span class="${item.netSharpe > 0 ? "positive" : "adverse"}">
          <small>${metric(item.costBps)} BPS</small>
          <b>${metric(item.netSharpe)}</b>
          <i>${signedPercent(item.annualReturn)} annual</i>
        </span>`,
    )
    .join("");
  element("portfolio-strategy-viability").innerHTML = `
    <div class="viability-diagnosis ${stageTone}">
      <span>
        <small>Where the edge stops</small>
        <b>${escapeHtml(stageLabel)}</b>
        <i>next focus · ${escapeHtml(diagnosis.iterationFocus.replaceAll("-", " "))}</i>
      </span>
      <p>${escapeHtml(diagnosis.explanation)}</p>
    </div>
    <div class="viability-chain" role="list" aria-label="Validation strategy viability chain">
      <span class="${validation.factorRankIc > 0 ? "positive" : "adverse"}" role="listitem">
        <small>01 · Factor prediction</small>
        <b>Rank IC ${metric(validation.factorRankIc)}</b>
        <i>validation · causal cross-section</i>
      </span>
      <span class="${validation.gross.sharpe > 0 ? "positive" : "adverse"}" role="listitem">
        <small>02 · Gross monetization</small>
        <b>Sharpe ${metric(validation.gross.sharpe)}</b>
        <i>${signedPercent(validation.gross.annualReturn)} annual · before cost</i>
      </span>
      <span class="${friction.grossToNetSharpeDelta < 0 ? "warning" : ""}" role="listitem">
        <small>03 · Trading friction</small>
        <b>${metric(friction.annualizedOneWayTurnover)}× turnover</b>
        <i>${metric(friction.baseCostBps)} bps base · break-even ${escapeHtml(breakEvenLabel)}</i>
      </span>
      <span class="${validation.net.sharpe > 0 ? "positive" : "adverse"}" role="listitem">
        <small>04 · Post-cost evidence</small>
        <b>Sharpe ${metric(validation.net.sharpe)}</b>
        <i>${signedPercent(validation.net.annualReturn)} annual · Δ ${signedMetric(friction.grossToNetSharpeDelta)}</i>
      </span>
    </div>
    <div class="viability-detail-grid">
      <div class="viability-cost-curve">
        <small>Validation cost curve</small>
        <div>${costCurve}</div>
      </div>
      <div class="viability-temporal">
        <span><small>Positive months</small><b>${percent(temporal.positiveNetMonthRate)}</b></span>
        <span><small>Max underwater</small><b>${temporal.maximumUnderwaterBars} bars</b></span>
        <span><small>Without best ${temporal.bestDayCount} days</small><b>${signedPercent(temporal.netTotalReturnWithoutBestDays)}</b></span>
        <span><small>Extra-delay Sharpe Δ</small><b>${signedMetric(validation.extraDelay.netSharpeDelta)}</b></span>
      </div>
    </div>
    <div class="viability-test-audit">
      <small>TEST · VISIBLE AUDIT ONLY · NEVER ENTERS DIAGNOSIS</small>
      <span>rank IC <b>${metric(test.factorRankIc)}</b></span>
      <span>gross → net Sharpe <b>${metric(test.gross.sharpe)} → ${metric(test.net.sharpe)}</b></span>
      <span>positive months <b>${percent(test.temporal.positiveNetMonthRate)}</b></span>
      <span>without best ${test.temporal.bestDayCount} days <b>${signedPercent(test.temporal.netTotalReturnWithoutBestDays)}</b></span>
    </div>
    <p class="viability-disclosure">
      Stage and research focus use validation only. Return-per-turnover and break-even cost are
      descriptive diagnostics on the frozen bar-target-weight path—not spread, impact, fill,
      selection, promotion, order, or account authority.
    </p>`;
}

function renderPortfolioSignalMonetization(explorer) {
  const monetization = explorer.signalMonetization;
  const diagnosis = monetization.diagnosis;
  const validation = monetization.validation;
  const test = monetization.test;
  const stages = validation.stages;
  const tone =
    diagnosis.outcome === "monetized-positive" ? "positive" : "adverse";
  element("portfolio-signal-monetization").innerHTML = `
    <div class="monetization-diagnosis ${tone}">
      <span>
        <small>Validation transmission</small>
        <b>${escapeHtml(diagnosis.outcome.replaceAll("-", " ").toUpperCase())}</b>
        <i>focus · ${escapeHtml(diagnosis.iterationFocus.replaceAll("-", " "))}</i>
      </span>
      <p>${escapeHtml(diagnosis.explanation)}</p>
    </div>
    <div class="monetization-chain" role="list" aria-label="Validation signal monetization stages">
      ${stages
        .map(
          (stage, index) => `
            <span class="${stage.annualizedContribution > 0 ? "positive" : "adverse"}" role="listitem">
              <small>0${index + 1} · ${escapeHtml(stage.label)}</small>
              <b>${signedPercent(stage.annualizedContribution)}</b>
              <i>annualized additive contribution</i>
            </span>`,
        )
        .join("")}
    </div>
    <div class="monetization-deltas">
      ${validation.deltas
        .map(
          (delta) => `
            <span class="${delta.annualizedContributionDelta < 0 ? "adverse" : "positive"}">
              <small>${escapeHtml(delta.label)}</small>
              <b>${signedPercent(delta.annualizedContributionDelta)}</b>
            </span>`,
        )
        .join("")}
    </div>
    <div class="monetization-audit">
      <span><small>Normalized-intent active dates</small><b>${validation.coverage.equalIntentActiveDates} / ${validation.coverage.decisionDates}</b></span>
      <span><small>Risk-limited dates</small><b>${validation.coverage.riskLimitedDates}</b></span>
      <span><small>No-trade retention</small><b>${validation.coverage.noTradeRetentionDates}</b></span>
      <span><small>Rebalanced dates</small><b>${validation.coverage.rebalancedDates}</b></span>
      <span><small>Test intent → net</small><b>${signedPercent(test.stages[0].annualizedContribution)} → ${signedPercent(test.stages[4].annualizedContribution)}</b></span>
      <span><small>Reconciliation</small><b>${validation.reconciliation.passed ? "PASS" : "FAIL"}</b></span>
    </div>
    <p class="monetization-disclosure">
      Normalized intent uses ${escapeHtml(monetization.semantics.evaluationMode)} ·
      ${escapeHtml(monetization.semantics.intentConstruction)}—not an investable comparator.
      Values are additive weight × next-bar return; no counterfactual compounding, KEEP/REVERT,
      promotion, order, or account authority. Largest adverse:
      ${escapeHtml(diagnosis.largestAdverseStage)} (${signedPercent(diagnosis.largestAdverseAnnualizedDelta)}).
    </p>`;
}

function renderPortfolioBook(explorer) {
  const book = explorer.currentBook;
  const latestCapacity = explorer.liquidityCapacity?.latestTrade;
  const capacityDisclosure = latestCapacity
    ? latestCapacity.status === "available"
      ? ` · latest rebalance ${latestCapacity.timestamp}: 1% capacity ${capital(latestCapacity.capacity1Pct)} · binding ${latestCapacity.bindingAsset}`
      : ` · latest rebalance ${latestCapacity.timestamp}: capacity unavailable`
    : "";
  const maximumWeight = Number(
    explorer.signalPolicy?.parameters?.max_abs_weight ?? 0.3,
  );
  element("portfolio-book-note").textContent =
    `${book.timestamp} · gross ${metric(book.grossExposure)} · net ${metric(book.netExposure)} · cash ${percent(book.cashWeight)} · executed risk ${book.executionRiskStatus}`;
  element("portfolio-book").innerHTML = `
    <div class="book-disclosure">Historical target/executed weights · target risk ${percent(book.riskForecastPreAnnualized)} → ${percent(book.riskForecastPostAnnualized)} · executed book ${percent(book.executedRiskForecastAnnualized)} / ${percent(book.executionRiskCeilingAnnualized)} · ${escapeHtml(book.executionReason)}${escapeHtml(capacityDisclosure)} · no Broker or account state</div>
    <div class="position-table" role="table" aria-label="Latest mechanical research book">
      <div class="position-row heading" role="row">
        <span>Asset / state</span><span>Target</span><span>Executed</span><span>Action</span>
      </div>
      ${book.positions
        .map((position) => {
          const stateLabel = position.tradable
            ? signalStateLabel(position.signalState)
            : "CONTEXT";
          const side = !position.tradable
            ? "context"
            : position.executedWeight > 0
              ? "long"
              : position.executedWeight < 0
                ? "short"
                : "flat";
          const magnitude = Math.min(
            100,
            (Math.abs(position.executedWeight) / Math.max(maximumWeight, 1e-12)) * 100,
          );
          return `
            <div class="position-row ${position.tradable ? "" : "context-only"}" role="row">
              <span class="position-asset">
                <b>${escapeHtml(position.asset)}</b>
                <i class="${side}">${stateLabel}</i>
                <small>${escapeHtml(position.allocationStatus)} · ${escapeHtml(position.executionAction)}</small>
              </span>
              <span title="Pre-governor ${signedPercent(position.preGovernorTargetWeight)} → governed ${signedPercent(position.targetWeight)}">
                ${signedPercent(position.targetWeight)}
              </span>
              <span class="position-weight ${side}">
                <b>${signedPercent(position.executedWeight)}</b>
                <i style="--position-size:${magnitude.toFixed(2)}%"></i>
              </span>
              <span class="position-action" title="${escapeHtml(position.executionReason)}">
                ${escapeHtml(position.executionAction)}
              </span>
            </div>`;
        })
        .join("")}
    </div>`;
}

function renderPortfolioAttribution(explorer) {
  const split = state.attributionSplit;
  const rows = explorer.attribution[split];
  const maximum = Math.max(
    1e-12,
    ...rows.map((item) => Math.abs(item.annualizedNetContribution)),
  );
  element("portfolio-attribution").innerHTML = `
    <div class="attribution-disclosure">${split === "validation" ? "Selection split" : "Visible audit only"} · annualized net contribution and mean component-risk share</div>
    <div class="attribution-table">
      ${rows
        .map((item) => {
          const contribution = item.annualizedNetContribution;
          const width = Math.abs(contribution) / maximum * 50;
          const left = contribution >= 0 ? 50 : 50 - width;
          return `
            <div class="attribution-row">
              <b>${escapeHtml(item.asset)}</b>
              <span class="contribution-track">
                <i class="${contribution >= 0 ? "positive" : "negative"}"
                  style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%"></i>
              </span>
              <span class="${contribution < 0 ? "adverse" : ""}">${signedPercent(contribution)}</span>
              <small>risk ${signedPercent(item.meanVarianceContributionShare)}</small>
            </div>`;
        })
        .join("")}
    </div>`;
  document.querySelectorAll("[data-attribution-split]").forEach((button) => {
    button.setAttribute(
      "aria-selected",
      String(button.dataset.attributionSplit === split),
    );
  });
}

function renderPortfolioTransitions(explorer) {
  const transitions = explorer.recentTransitions.slice().reverse().slice(0, 10);
  element("portfolio-transitions").innerHTML =
    transitions
      .map(
        (item) => `
          <div class="transition-row">
            <time>${escapeHtml(item.timestamp)}</time>
            <b>${escapeHtml(item.asset)}</b>
            <span>${escapeHtml(item.signalEvent)}</span>
            <code>${signalStateLabel(item.priorSignalState)} → ${signalStateLabel(item.signalState)}</code>
            <small>${escapeHtml(item.executionAction)} · ${signedPercent(item.tradeWeight)} · ${escapeHtml(item.executionReason)}</small>
          </div>`,
      )
      .join("") ||
    '<div class="empty-panel">No mechanical transitions in the bounded evidence window.</div>';
}

function renderPortfolioExplorer(project) {
  const section = element("portfolio-explorer");
  const explorer = project.portfolioExplorer;
  if (!explorer) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const summary = explorer.path.summary;
  const validationCapacity = explorer.liquidityCapacity?.validation;
  const validationExecutionRisk = explorer.executedBookRisk?.validation;
  element("portfolio-meta").textContent =
    `${explorer.run.id} · ${explorer.selection.selectionSplit} selection · ${explorer.selection.testRole} test`;
  element("portfolio-mandate").innerHTML = mandateMarkup(explorer.mandate);
  element("portfolio-summary").innerHTML = [
    ["Net total return", signedPercent(summary.netTotalReturn), summary.netTotalReturn < 0 ? "bad" : ""],
    ["Maximum drawdown", signedPercent(summary.maximumDrawdown), "bad"],
    ["Total cost drag", percent(summary.totalCost), summary.totalCost > 0 ? "bad" : ""],
    ["One-way turnover", metric(summary.totalOneWayTurnover), "neutral"],
    [
      "Validation risk-limited",
      percent(explorer.signalPolicy.validation.riskLimitedRate),
      explorer.signalPolicy.validation.riskLimitedRate > 0 ? "warning" : "neutral",
    ],
    [
      "Executed risk",
      validationExecutionRisk
        ? `${validationExecutionRisk.executedBreachDates} breach · ${validationExecutionRisk.riskRebalanceOverrideDates} override`
        : "LEGACY",
      validationExecutionRisk?.executedBreachDates > 0 ? "bad" : "neutral",
    ],
    [
      "1% capacity · p10",
      validationCapacity?.capacity1Pct?.status === "available"
        ? capital(validationCapacity.capacity1Pct.tenthPercentileNav)
        : "UNAVAILABLE",
      validationCapacity?.capacity1Pct?.status === "available" ? "neutral" : "warning",
    ],
    [
      "Capacity coverage",
      validationCapacity ? percent(validationCapacity.tradeDateCoverage) : "LEGACY",
      validationCapacity?.tradeDateCoverage === 1 ? "neutral" : "warning",
    ],
  ]
    .map(
      ([label, value, tone]) => `
        <span class="${tone}">
          <small>${escapeHtml(label)}</small>
          <b>${escapeHtml(value)}</b>
        </span>`,
    )
    .join("");
  renderPortfolioChart(explorer);
  renderPortfolioStrategyViability(explorer);
  renderPortfolioSignalMonetization(explorer);
  renderPortfolioMechanicalDecision(explorer);
  renderPortfolioSizingAnatomy(explorer);
  renderPortfolioDiversificationStress(explorer);
  renderPortfolioBook(explorer);
  renderPortfolioAttribution(explorer);
  renderPortfolioTransitions(explorer);
  renderPortfolioTranslationRobustness(explorer);
  renderPortfolioParameterNeighborhood(explorer);
  renderPortfolioLifecycle(explorer);
}

function renderPortfolioTranslationRobustness(explorer) {
  const target = element("portfolio-translation-robustness");
  const robustness = explorer.translationRobustness;
  if (!robustness || robustness.reason === "legacy-run-evidence-unavailable") {
    target.innerHTML =
      '<div class="empty-panel">Legacy Run: target-translation robustness evidence is unavailable.</div>';
    return;
  }
  if (!robustness.applicable) {
    target.innerHTML = `
      <div class="empty-panel">
        Not applicable: cross-sectional scores use the same-timestamp prediction population and have no temporal history window.
      </div>`;
    return;
  }
  const diagnosis = robustness.diagnosis;
  const profiles = robustness.validation.profiles;
  const tone = diagnosis.status === "stable-target-path" ? "positive" : "adverse";
  target.innerHTML = `
    <div class="monetization-diagnosis ${tone}">
      <span>
        <small>Validation target path</small>
        <b>${escapeHtml(diagnosis.status.replaceAll("-", " ").toUpperCase())}</b>
        <i>60/20 remains the fixed production translation</i>
      </span>
      <p>${escapeHtml(diagnosis.explanation)}</p>
    </div>
    <div class="monetization-chain" role="list" aria-label="Target translation history-window profiles">
      ${profiles
        .map(
          (profile) => `
            <span class="${profile.isBase ? "positive" : ""}" role="listitem">
              <small>${escapeHtml(profile.label)} · ${profile.windowObservations} bars</small>
              <b>${metric(profile.netSharpe)} Sharpe</b>
              <i>active-state agreement ${profile.activeStateAgreementWithBaseRate == null ? "N/A" : percent(profile.activeStateAgreementWithBaseRate)} · target MAE ${percent(profile.meanAbsoluteTargetDeltaVsBase)}</i>
            </span>`,
        )
        .join("")}
    </div>
    <p class="monetization-disclosure">
      Validation alone determines the stability label. Test remains visible audit; no profile can be selected, promoted, or treated as an Order.
    </p>`;
}

function renderPortfolioParameterNeighborhood(explorer) {
  const target = element("portfolio-parameter-neighborhood");
  const neighborhood = explorer.parameterNeighborhood;
  document.querySelectorAll("[data-parameter-split]").forEach((button) => {
    button.setAttribute(
      "aria-selected",
      String(button.dataset.parameterSplit === state.parameterSplit),
    );
  });
  if (!neighborhood?.available) {
    target.innerHTML =
      '<div class="empty-panel">Legacy Run: mechanical parameter-neighborhood evidence is unavailable.</div>';
    return;
  }
  const split = neighborhood[state.parameterSplit];
  const aggregate = split.aggregate;
  const profiles = neighborhood.policy.signalProfiles;
  const bands = neighborhood.policy.noTradeBands;
  const cells = new Map(
    split.configurations.map((item) => [
      `${item.signalProfile}:${Number(item.noTradeOneWay).toFixed(2)}`,
      item,
    ]),
  );
  const maximumMagnitude = Math.max(
    1e-12,
    ...split.configurations.map((item) => Math.abs(item.netSharpe)),
  );
  const stats = [
    ["Positive Sharpe", percent(aggregate.positiveNetSharpeRate)],
    ["Sign agreement", percent(aggregate.signAgreementWithBaseRate)],
    ["Worst Δ vs base", `${aggregate.worstNetSharpeDelta >= 0 ? "+" : ""}${metric(aggregate.worstNetSharpeDelta)}`],
    ["Sharpe min / median / max", `${metric(aggregate.minimumNetSharpe)} / ${metric(aggregate.medianNetSharpe)} / ${metric(aggregate.maximumNetSharpe)}`],
    ["Annual turnover range", `${metric(aggregate.minimumAnnualizedOneWayTurnover)}–${metric(aggregate.maximumAnnualizedOneWayTurnover)}`],
    ["Signal transitions", `${aggregate.minimumSignalTransitions}–${aggregate.maximumSignalTransitions}`],
  ];
  const header = bands
    .map(
      (band) =>
        `<span class="parameter-band"><small>No-trade</small><b>${percent(band)}</b></span>`,
    )
    .join("");
  const rows = profiles
    .map((profile) => {
      const profileCells = bands
        .map((band) => {
          const cell = cells.get(`${profile.id}:${Number(band).toFixed(2)}`);
          if (!cell) return '<span class="parameter-cell missing">—</span>';
          const alpha = 0.08 + Math.min(0.24, Math.abs(cell.netSharpe) / maximumMagnitude * 0.24);
          const delta = `${cell.netSharpeDeltaVsBase >= 0 ? "+" : ""}${metric(cell.netSharpeDeltaVsBase)}`;
          return `
            <span
              class="parameter-cell ${cell.netSharpe >= 0 ? "positive" : "negative"} ${cell.isBase ? "base" : ""}"
              style="--parameter-alpha:${alpha.toFixed(3)}"
              title="${escapeHtml(profile.label)} · no-trade ${percent(band)} · Sharpe ${metric(cell.netSharpe)} · delta ${delta} · turnover ${metric(cell.annualizedOneWayTurnover)}"
            >
              ${cell.isBase ? '<i>BASE</i>' : '<i>LOCAL</i>'}
              <b>${metric(cell.netSharpe)}</b>
              <small>Δ ${delta}</small>
            </span>`;
        })
        .join("");
      return `
        <span class="parameter-profile">
          <b>${escapeHtml(profile.label)}</b>
          <small>L ${metric(profile.longEntry)}→${metric(profile.longExit)} · S ${metric(profile.shortEntry)}→${metric(profile.shortExit)}</small>
        </span>
        ${profileCells}`;
    })
    .join("");
  target.innerHTML = `
    <div class="parameter-stats">
      ${stats.map(([label, value]) => `<span><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></span>`).join("")}
    </div>
    <div class="parameter-grid-scroll">
      <div class="parameter-grid" style="--parameter-columns:${bands.length}">
        <span class="parameter-corner">SIGNAL PROFILE × EXECUTION BAND</span>
        ${header}
        ${rows}
      </div>
    </div>
    <p class="parameter-disclosure">
      ${state.parameterSplit === "validation" ? "Validation context" : "Visible test audit"} ·
      ${aggregate.configurationCount} predeclared cells · base is outlined only for identity.
      No cell is selected, recommended, or allowed to change KEEP/REVERT. Test-guided iteration requires a fresh external holdout.
    </p>`;
}

function renderPortfolioLifecycle(explorer) {
  const target = element("portfolio-lifecycle");
  const lifecycle = explorer.positionLifecycle;
  document.querySelectorAll("[data-lifecycle-split]").forEach((button) => {
    button.setAttribute(
      "aria-selected",
      String(button.dataset.lifecycleSplit === state.lifecycleSplit),
    );
  });
  if (!lifecycle?.available) {
    target.innerHTML =
      '<div class="empty-panel">Legacy Run: mechanical position lifecycle evidence is unavailable.</div>';
    return;
  }
  const split = lifecycle[state.lifecycleSplit];
  const episodes = lifecycle.recentEpisodes.filter(
    (episode) => episode.split === state.lifecycleSplit,
  );
  const stats = [
    ["Complete episodes", split.completeEpisodes],
    ["Win rate", percent(split.completeEpisodeWinRate)],
    ["Median holding", `${metric(split.medianCompleteHoldingBars, 1)} bars`],
    ["Payoff", metric(split.completePayoffRatio)],
    ["Intent mismatch", percent(split.intentMismatchRate)],
    [
      "MFE / MAE",
      `${signedPercent(split.averageSegmentMfe)} / ${signedPercent(split.averageSegmentMae)}`,
    ],
  ];
  target.innerHTML = `
    <div class="lifecycle-stats">
      ${stats.map(([label, value]) => `<span><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></span>`).join("")}
    </div>
    <div class="lifecycle-detail-grid">
      <div>
        <div class="lifecycle-row">
          <small>Asset</small><small>Segments</small><small>Complete</small><small>Win rate</small><small>Net / cost</small>
        </div>
        <div class="lifecycle-table">
          ${split.byAsset.map((row) => `
            <div class="lifecycle-row">
              <b>${escapeHtml(row.asset)}</b>
              <span>${escapeHtml(row.activeSegments)}</span>
              <span>${escapeHtml(row.completeEpisodes)}</span>
              <span>${percent(row.completeEpisodeWinRate)}</span>
              <span>${signedPercent(row.totalNetContribution)} / ${percent(row.totalCost)}</span>
            </div>`).join("")}
        </div>
      </div>
      <div>
        <div class="lifecycle-episode">
          <small>Entry</small><small>Asset</small><small>Side</small><small>Lifecycle</small><small>Net</small><small>MFE / MAE</small>
        </div>
        <div class="lifecycle-episodes">
          ${episodes.map((episode) => `
            <div class="lifecycle-episode">
              <time>${escapeHtml(episode.entryTimestamp)}</time>
              <b>${escapeHtml(episode.asset)}</b>
              <span>${escapeHtml(episode.side)}</span>
              <span>${escapeHtml(episode.decisionBars)} bars · ${episode.complete ? "complete" : "censored"}</span>
              <span>${signedPercent(episode.netContribution)}</span>
              <small>${signedPercent(episode.maximumFavorableExcursion)} / ${signedPercent(episode.maximumAdverseExcursion)}</small>
            </div>`).join("") || '<div class="empty-panel">No recent active episodes in this split.</div>'}
        </div>
      </div>
    </div>
    <p class="lifecycle-disclosure">
      ${escapeHtml(split.leftCensoredSegments)} left-censored · ${escapeHtml(split.rightCensoredSegments)} right-censored ·
      complete-episode win/payoff statistics exclude censored segments. Episode P&amp;L is additive portfolio contribution, not a standalone compounded trade return.
    </p>`;
}

function rlBaselineLabel(value) {
  return String(value ?? "")
    .replace("fixed:", "")
    .replace("best-training-expert", "training expert")
    .replace("contextual-ridge", "contextual ridge")
    .replaceAll("_", " ");
}

function rlTrialLabel(trial) {
  return `${trial.fold.replace("fold-", "F")} · s${trial.seed}`;
}

function rlSplitEvidence(trial) {
  return state.rlSplit === "test" ? trial.test : trial.validation;
}

function rlAdvantage(trial) {
  return state.rlSplit === "test"
    ? trial.testAdvantage
    : trial.validationAdvantage;
}

function renderRlPerformance(explorer) {
  const trials = explorer.trials;
  const split = state.rlSplit;
  const selected = explorer.baselines.filter((row) => row.selectedOnValidation);
  const values = [
    ...trials.map((trial) => rlSplitEvidence(trial).netSharpe),
    ...selected.map((row) => row[split].netSharpe),
  ];
  const width = 760;
  const left = 48;
  const right = 16;
  const top = 22;
  const height = 210;
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = Math.max(0.5, (maximum - minimum) * 0.08);
  const low = minimum - padding;
  const high = maximum + padding;
  const spread = Math.max(1e-9, high - low);
  const y = (value) => top + ((high - value) / spread) * height;
  const step = (width - left - right) / Math.max(1, trials.length);
  const x = (index) => left + step * (index + 0.5);
  const baselineLines = explorer.protocol.folds
    .map((fold) => {
      const foldIndices = trials
        .map((trial, index) => [trial, index])
        .filter(([trial]) => trial.fold === fold)
        .map(([, index]) => index);
      const baseline = selected.find((row) => row.fold === fold);
      if (!baseline || !foldIndices.length) return "";
      const value = baseline[split].netSharpe;
      return `
        <line class="rl-baseline-line"
          x1="${(x(foldIndices[0]) - step * 0.38).toFixed(2)}"
          x2="${(x(foldIndices.at(-1)) + step * 0.38).toFixed(2)}"
          y1="${y(value).toFixed(2)}" y2="${y(value).toFixed(2)}">
          <title>${escapeHtml(fold)} · ${escapeHtml(rlBaselineLabel(baseline.name))} · ${metric(value)}</title>
        </line>`;
    })
    .join("");
  const points = trials
    .map((trial, index) => {
      const value = rlSplitEvidence(trial).netSharpe;
      const advantage = rlAdvantage(trial);
      return `
        <g class="rl-trial-point ${advantage >= 0 ? "positive" : "negative"}">
          <circle cx="${x(index).toFixed(2)}" cy="${y(value).toFixed(2)}" r="5">
            <title>${escapeHtml(rlTrialLabel(trial))} · Sharpe ${metric(value)} · advantage ${metric(advantage)}</title>
          </circle>
          <text x="${x(index).toFixed(2)}" y="${(y(value) - 10).toFixed(2)}"
            text-anchor="middle">${metric(value)}</text>
          <text class="rl-axis-label" x="${x(index).toFixed(2)}" y="258"
            text-anchor="middle">${escapeHtml(rlTrialLabel(trial))}</text>
        </g>`;
    })
    .join("");
  const zero = low <= 0 && high >= 0
    ? `<line class="rl-zero-line" x1="${left}" x2="${width - right}" y1="${y(0)}" y2="${y(0)}"></line>`
    : "";
  return `
    <svg viewBox="0 0 ${width} 270" role="img"
      aria-label="Every RL fold and seed compared with the validation-selected baseline">
      ${zero}
      <text class="rl-axis-label" x="5" y="${top + 5}">${metric(high)}</text>
      <text class="rl-axis-label" x="5" y="${top + height}">${metric(low)}</text>
      ${baselineLines}
      ${points}
    </svg>
    <div class="rl-legend">
      <span><i class="rl-positive"></i>RL beats selected baseline</span>
      <span><i class="rl-negative"></i>RL trails selected baseline</span>
      <span><i class="rl-baseline"></i>Validation-selected baseline</span>
      <b>${split === "validation" ? "SELECTION" : "TEST · VISIBLE AUDIT ONLY"}</b>
    </div>`;
}

function renderRlTraining(explorer) {
  const rows = explorer.training;
  const trials = explorer.trials;
  const values = rows.map((row) => row.totalReward);
  const width = 760;
  const left = 48;
  const right = 16;
  const top = 22;
  const height = 210;
  const low = Math.min(...values);
  const high = Math.max(...values);
  const spread = Math.max(1e-9, high - low);
  const x = (episode) =>
    left + ((episode - 1) / Math.max(1, explorer.protocol.episodes - 1)) *
      (width - left - right);
  const y = (value) => top + ((high - value) / spread) * height;
  const colors = ["c0", "c1", "c2", "c3", "c4", "c5"];
  const lines = trials
    .map((trial, index) => {
      const history = rows.filter(
        (row) => row.fold === trial.fold && row.seed === trial.seed,
      );
      const path = history
        .map(
          (row, pointIndex) =>
            `${pointIndex ? "L" : "M"}${x(row.episode).toFixed(2)},${y(row.totalReward).toFixed(2)}`,
        )
        .join(" ");
      const final = history.at(-1);
      return `
        <path class="rl-training-line ${colors[index % colors.length]}" d="${path}">
          <title>${escapeHtml(rlTrialLabel(trial))} · final reward ${metric(final?.totalReward)}</title>
        </path>
        <text class="rl-training-label ${colors[index % colors.length]}"
          x="${(x(final.episode) - 4).toFixed(2)}"
          y="${(y(final.totalReward) - 4 + index * 2).toFixed(2)}"
          text-anchor="end">${escapeHtml(rlTrialLabel(trial))}</text>`;
    })
    .join("");
  const episodeLabels = Array.from(
    { length: explorer.protocol.episodes },
    (_, index) => index + 1,
  )
    .map(
      (episode) => `
        <text class="rl-axis-label" x="${x(episode).toFixed(2)}" y="258"
          text-anchor="middle">E${episode}</text>`,
    )
    .join("");
  const contextual = (explorer.contextualBaselines ?? [])
    .map((baseline) => {
      if (!baseline.available) {
        return `
          <article class="rl-contextual-baseline legacy">
            <small>${escapeHtml(baseline.fold)} · contextual comparator</small>
            <strong>LEGACY FIXED-PATH LABELS</strong>
            <p>Historical immutable evidence predates same-pretrade train-only fitting.</p>
          </article>`;
      }
      const final = baseline.history.at(-1);
      return `
        <article class="rl-contextual-baseline">
          <small>${escapeHtml(baseline.fold)} · simple-policy challenger</small>
          <strong>SAME-PRETRADE · TRAIN ONLY</strong>
          <div>
            <span><b>${baseline.iterations}</b><i>iterations</i></span>
            <span><b>${metric(final?.improvedTrainingNetSharpe)}</b><i>train Sharpe</i></span>
            <span><b>${percent(final?.behaviorOracleHitRate)}</b><i>behavior hit</i></span>
            <span><b>${metric(final?.sharedPretradeActionEvaluations)}</b><i>action labels</i></span>
          </div>
          <p>Balanced anchor → fit all governed action rewards from one pretrade path → reroll train behavior. Frozen before validation.</p>
        </article>`;
    })
    .join("");
  return `
    <svg viewBox="0 0 ${width} 270" role="img"
      aria-label="Training total reward for every fold and seed">
      <line class="rl-zero-line" x1="${left}" x2="${width - right}"
        y1="${y(Math.max(low, Math.min(high, 0))).toFixed(2)}"
        y2="${y(Math.max(low, Math.min(high, 0))).toFixed(2)}"></line>
      <text class="rl-axis-label" x="5" y="${top + 5}">${metric(high)}</text>
      <text class="rl-axis-label" x="5" y="${top + height}">${metric(low)}</text>
      ${lines}
      ${episodeLabels}
    </svg>
    <div class="rl-legend">
      <span>Exact fixed-budget training history · all ${trials.length} trials</span>
      <b>DESCRIPTIVE · NOT A PROMOTION METRIC</b>
    </div>
    ${contextual ? `
      <section class="rl-contextual-baselines" aria-label="Contextual baseline training contract">
        ${contextual}
      </section>` : ""}`;
}

function renderRlActions(explorer) {
  const rows = explorer.actionSummaries.filter(
    (row) => row.split === state.rlSplit,
  );
  const actions = explorer.protocol.actions;
  const width = 760;
  const left = 48;
  const right = 16;
  const top = 22;
  const height = 210;
  const step = (width - left - right) / Math.max(1, rows.length);
  const barWidth = step * 0.58;
  const bars = rows
    .map((row, index) => {
      let cumulative = 0;
      const segments = actions
        .map((action) => {
          const value = row.actionFrequency[action];
          const y = top + height * (1 - cumulative - value);
          cumulative += value;
          return `
            <rect class="rl-action-${escapeHtml(action)}"
              x="${(left + index * step + (step - barWidth) / 2).toFixed(2)}"
              y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}"
              height="${(height * value).toFixed(2)}">
              <title>${escapeHtml(action)} · ${percent(value)}</title>
            </rect>`;
        })
        .join("");
      return `${segments}
        <text class="rl-axis-label" x="${(left + step * (index + 0.5)).toFixed(2)}"
          y="258" text-anchor="middle">${escapeHtml(row.fold.replace("fold-", "F"))} · s${row.seed}</text>`;
    })
    .join("");
  return `
    <svg viewBox="0 0 ${width} 270" role="img"
      aria-label="Fixed factor-mixture action allocation for every fold and seed">
      <text class="rl-axis-label" x="5" y="${top + 5}">100%</text>
      <text class="rl-axis-label" x="20" y="${top + height}">0</text>
      ${bars}
    </svg>
    <div class="rl-legend">
      ${actions
        .map(
          (action) =>
            `<span><i class="rl-action-${escapeHtml(action)}"></i>${escapeHtml(action)}</span>`,
        )
        .join("")}
      <b>${state.rlSplit === "validation" ? "SELECTION" : "TEST · VISIBLE AUDIT ONLY"}</b>
    </div>`;
}

function renderRlChart(explorer) {
  const title = {
    performance: "RL versus selected baseline",
    training: "Fixed-budget training behavior",
    actions: "Fixed factor-sleeve allocation",
  }[state.rlView];
  const note = {
    performance: "Every declared fold and seed · baseline chosen by fixed Judge",
    training: "Every episode · no lucky-seed selection",
    actions: "Allocation, transitions, turnover, and cost",
  }[state.rlView];
  element("rl-chart-title").textContent = title;
  element("rl-chart-note").textContent = note;
  element("rl-chart").innerHTML =
    state.rlView === "training"
      ? renderRlTraining(explorer)
      : state.rlView === "actions"
        ? renderRlActions(explorer)
        : renderRlPerformance(explorer);
  document.querySelectorAll("[data-rl-view]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.rlView === state.rlView));
  });
  document.querySelectorAll("[data-rl-split]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.rlSplit === state.rlSplit));
  });
}

function renderRlTrials(explorer) {
  const split = state.rlSplit;
  element("rl-trials").innerHTML = `
    <div class="rl-trial-table" role="table" aria-label="RL fold and seed audit">
      <div class="rl-trial-row heading" role="row">
        <span>Trial</span><span>Sharpe</span><span>vs baseline</span>
      </div>
      ${explorer.trials
        .map((trial) => {
          const evidence = trial[split];
          const advantage = split === "validation"
            ? trial.validationAdvantage
            : trial.testAdvantage;
          return `
            <div class="rl-trial-row ${advantage >= 0 ? "positive" : "negative"}" role="row">
              <span>
                <b>${escapeHtml(rlTrialLabel(trial))}</b>
                <small>${escapeHtml(rlBaselineLabel(trial.selectedBaseline))}</small>
              </span>
              <strong>${metric(evidence.netSharpe)}</strong>
              <i>${advantage > 0 ? "+" : ""}${metric(advantage)}</i>
            </div>`;
        })
        .join("")}
    </div>`;
}

function renderRlBaselines(explorer) {
  const split = state.rlSplit;
  const byName = new Map();
  for (const row of explorer.baselines) {
    const values = byName.get(row.name) ?? [];
    values.push(row[split].netSharpe);
    byName.set(row.name, values);
  }
  const rows = [...byName.entries()]
    .map(([name, values]) => ({
      name,
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      selected: explorer.baselines.some(
        (row) => row.name === name && row.selectedOnValidation,
      ),
    }))
    .sort((left, right) => right.mean - left.mean);
  const maximum = Math.max(...rows.map((row) => row.mean));
  const minimum = Math.min(0, ...rows.map((row) => row.mean));
  const spread = Math.max(1e-9, maximum - minimum);
  element("rl-baselines").innerHTML = `
    <div class="rl-baseline-list">
      ${rows
        .map(
          (row) => `
            <div class="rl-baseline-row ${row.selected ? "selected" : ""}">
              <span>
                <b>${escapeHtml(rlBaselineLabel(row.name))}</b>
                <small>${row.selected ? "selected in ≥1 fold" : "declared comparator"}</small>
              </span>
              <i><u style="width:${Math.max(0, (row.mean - minimum) / spread * 100).toFixed(2)}%"></u></i>
              <strong>${metric(row.mean)}</strong>
            </div>`,
        )
        .join("")}
    </div>`;
}

function renderRlDetail(explorer) {
  const rows = explorer.actionSummaries.filter(
    (row) => row.split === state.rlSplit,
  );
  const actions = explorer.protocol.actions;
  const meanFrequency = Object.fromEntries(
    actions.map((action) => [
      action,
      rows.reduce((sum, row) => sum + row.actionFrequency[action], 0) /
        Math.max(1, rows.length),
    ]),
  );
  const transitions = rows.reduce((sum, row) => sum + row.actionTransitions, 0);
  const turnover = rows.reduce((sum, row) => sum + row.meanOneWayTurnover, 0) /
    Math.max(1, rows.length);
  const cost = rows.reduce((sum, row) => sum + row.totalCostDrag, 0) /
    Math.max(1, rows.length);
  const executionRisk = explorer.executedBookRisk?.[state.rlSplit];
  element("rl-detail").innerHTML = `
    <div class="rl-action-mix">
      ${actions
        .map(
          (action) => `
            <div>
              <span><i class="rl-action-${escapeHtml(action)}"></i>${escapeHtml(action)}</span>
              <b>${percent(meanFrequency[action])}</b>
            </div>`,
        )
        .join("")}
    </div>
    <div class="rl-implementation-grid">
      <span><small>Mean one-way turnover</small><b>${metric(turnover)}</b></span>
      <span><small>Mean total cost drag</small><b>${percent(cost)}</b></span>
      <span><small>Action transitions</small><b>${metric(transitions)}</b></span>
      <span><small>Cost assumption</small><b>${metric(explorer.protocol.configuration.costBps)} bps</b></span>
      <span><small>Executed risk breaches</small><b>${executionRisk ? metric(executionRisk.executedBreachDates) : "LEGACY"}</b></span>
      <span><small>Risk-only overrides</small><b>${executionRisk ? metric(executionRisk.riskRebalanceOverrideDates) : "LEGACY"}</b></span>
    </div>
    <p class="book-disclosure">Actions select the content-locked candidate factor, fixed reference factors, or their governed blend. Final post-drift books are risk-checked before reward; all values remain historical research evidence, not orders or account positions.</p>`;
}

function renderRlIncremental(explorer) {
  const root = element("rl-incremental");
  const attribution = explorer.incrementalAttribution;
  if (!attribution?.available) {
    root.innerHTML = `
      <div class="rl-behavior-empty">
        Legacy Run: full-path incremental attribution was not recorded.
      </div>`;
    return;
  }
  const split = attribution[state.rlSplit];
  const regimes = [...split.byRegime].sort(
    (left, right) =>
      left.dimension.localeCompare(right.dimension) ||
      left.bucket.localeCompare(right.bucket),
  );
  const assets = [...split.byAsset].sort(
    (left, right) =>
      Math.abs(right.totalGrossActiveContribution) -
        Math.abs(left.totalGrossActiveContribution) ||
      left.asset.localeCompare(right.asset),
  );
  const actionPairs = [...split.byActionPair]
    .sort(
      (left, right) =>
        right.decisions - left.decisions ||
        left.key.localeCompare(right.key),
    )
    .slice(0, 8);
  root.innerHTML = `
    <div class="rl-incremental-stats">
      <span>
        <small>Gross selection edge</small>
        <b class="${split.meanTrialTotalGrossActiveReturn >= 0 ? "positive" : "negative"}">${signedPercent(split.meanTrialTotalGrossActiveReturn)}</b>
        <i>mean trial path</i>
      </span>
      <span>
        <small>Incremental cost</small>
        <b class="${split.meanTrialTotalIncrementalCost <= 0 ? "positive" : "negative"}">${signedPercent(split.meanTrialTotalIncrementalCost)}</b>
        <i>mean trial path</i>
      </span>
      <span>
        <small>Net active return</small>
        <b class="${split.meanTrialTotalNetActiveReturn >= 0 ? "positive" : "negative"}">${signedPercent(split.meanTrialTotalNetActiveReturn)}</b>
        <i>mean trial path</i>
      </span>
      <span>
        <small>Mean trial IR</small>
        <b class="${split.informationRatio >= 0 ? "positive" : "negative"}">${metric(split.informationRatio)}</b>
      </span>
      <span>
        <small>Active-day win</small>
        <b>${percent(split.conditionalActiveWinRate)}</b>
        <i>${percent(split.activeDecisionRate)} active days</i>
      </span>
      <span>
        <small>Mean relative max DD</small>
        <b class="${split.relativeMaximumDrawdown < 0 ? "negative" : ""}">${percent(split.relativeMaximumDrawdown)}</b>
      </span>
    </div>
    <div class="rl-incremental-grid">
      <section>
        <h3>Where the active return appears</h3>
        <div class="rl-incremental-table regime-table" role="table" aria-label="RL active return by causal market regime">
          <div class="heading" role="row">
            <span>Regime</span><span>Days</span><span>Mean active</span><span>Win</span>
          </div>
          ${regimes.map((row) => `
            <div role="row">
              <span><b>${escapeHtml(row.dimension)}</b> · ${escapeHtml(row.bucket)}</span>
              <span>${metric(row.decisions)}</span>
              <span class="${row.meanNetActiveReturn >= 0 ? "positive" : "negative"}">${signedPercent(row.meanNetActiveReturn)}</span>
              <span>${percent(row.conditionalActiveWinRate)}</span>
            </div>`).join("")}
        </div>
      </section>
      <section>
        <h3>Asset gross contribution</h3>
        <div class="rl-incremental-table asset-table" role="table" aria-label="RL active gross contribution by asset">
          <div class="heading" role="row">
            <span>Asset</span><span>Mean trial</span><span>Mean / day</span>
          </div>
          ${assets.map((row) => `
            <div role="row">
              <span><b>${escapeHtml(row.asset)}</b></span>
              <span class="${row.meanTrialTotalGrossActiveContribution >= 0 ? "positive" : "negative"}">${signedPercent(row.meanTrialTotalGrossActiveContribution)}</span>
              <span>${signedPercent(row.meanGrossActiveContribution)}</span>
            </div>`).join("")}
        </div>
      </section>
      <section>
        <h3>Most frequent policy → baseline pairs</h3>
        <div class="rl-incremental-table pair-table" role="table" aria-label="RL and baseline action pair attribution">
          <div class="heading" role="row">
            <span>Action pair</span><span>Days</span><span>Mean active</span><span>Win</span>
          </div>
          ${actionPairs.map((row) => `
            <div role="row">
              <span><b>${escapeHtml(row.policyAction)}</b> → ${escapeHtml(row.baselineAction)}</span>
              <span>${metric(row.decisions)}</span>
              <span class="${row.meanNetActiveReturn >= 0 ? "positive" : "negative"}">${signedPercent(row.meanNetActiveReturn)}</span>
              <span>${percent(row.conditionalActiveWinRate)}</span>
            </div>`).join("")}
        </div>
      </section>
    </div>
    <p class="book-disclosure">
      Each policy carries its own holdings, drift, no-trade decisions, risk repair, turnover, and costs. Gross edge − incremental cost = net active return; asset contributions reconcile gross edge. Regime tables are descriptive diagnostics, not new selection objectives. ${state.rlSplit === "test" ? "TEST IS VISIBLE AUDIT ONLY." : "VALIDATION IS THE SELECTION SPLIT."}
    </p>`;
}

function renderRlFusionDiagnosis(explorer) {
  const root = element("rl-fusion-diagnosis");
  const fusion = explorer.factorFusionDiagnosis;
  if (!fusion?.available) {
    root.innerHTML = `
      <div class="rl-behavior-empty">
        Legacy Run: candidate-factor fusion diagnosis evidence is unavailable.
      </div>`;
    return;
  }
  const diagnosis = fusion.diagnosis;
  const validation = fusion.validation;
  const candidate = validation.candidateFactor;
  const policy = validation.policySelection;
  const transmission = validation.adaptiveTransmission;
  const stability = validation.stability;
  const losses = validation.lossLocator;
  const test = fusion.testAudit;
  const tone =
    diagnosis.stage === "adaptive-value-positive" ? "positive" : "adverse";
  root.innerHTML = `
    <div class="rl-fusion-diagnosis ${tone}">
      <span>
        <small>Where adaptive value stops</small>
        <b>${escapeHtml(diagnosis.stage.replaceAll("-", " ").toUpperCase())}</b>
        <i>next focus · ${escapeHtml(diagnosis.iterationFocus.replaceAll("-", " "))}</i>
      </span>
      <p>${escapeHtml(diagnosis.explanation)}</p>
    </div>
    <div class="rl-fusion-chain" role="list" aria-label="Validation RL factor-fusion value chain">
      <span class="${candidate.fixedSleeveSharpeDeltaVsBalanced > 0 ? "positive" : "adverse"}" role="listitem">
        <small>01 · Candidate sleeve</small>
        <b>${signedMetric(candidate.fixedSleeveSharpeDeltaVsBalanced)} Δ Sharpe</b>
        <i>${escapeHtml(candidate.assessment.replaceAll("-", " "))}</i>
      </span>
      <span class="${candidate.meanLocalRewardDeltaVsBalanced > 0 ? "positive" : "adverse"}" role="listitem">
        <small>02 · Local opportunity capture</small>
        <b>${percent(candidate.oracleCaptureRate)} captured</b>
        <i>${percent(candidate.selectedFrequency)} selected · ${percent(candidate.localBestFrequency)} locally best</i>
      </span>
      <span class="${transmission.meanTrialGrossActiveReturn > 0 ? "positive" : "adverse"}" role="listitem">
        <small>03 · Adaptive book selection</small>
        <b>${signedPercent(transmission.meanTrialGrossActiveReturn)}</b>
        <i>gross active · independent paths</i>
      </span>
      <span class="${transmission.meanTrialIncrementalCost <= 0 ? "positive" : "warning"}" role="listitem">
        <small>04 · Incremental cost</small>
        <b>${signedPercent(transmission.meanTrialIncrementalCost)}</b>
        <i>${percent(transmission.policySwitchRate)} policy switches</i>
      </span>
      <span class="${transmission.meanTrialNetActiveReturn > 0 && transmission.meanSharpeAdvantageVsSelectedBaseline > 0 ? "positive" : "adverse"}" role="listitem">
        <small>05 · Stable net adaptive value</small>
        <b>${signedPercent(transmission.meanTrialNetActiveReturn)}</b>
        <i>Sharpe Δ ${signedMetric(transmission.meanSharpeAdvantageVsSelectedBaseline)} · ${percent(stability.positiveNetTrialRate)} positive trials</i>
      </span>
    </div>
    <div class="rl-fusion-audit">
      <span><small>Selected = local best</small><b>${percent(policy.oracleHitRate)}</b></span>
      <span><small>Mean selected rank</small><b>${metric(policy.meanSelectedRank)}</b></span>
      <span><small>Active-day win</small><b>${percent(transmission.conditionalActiveWinRate)}</b></span>
      <span><small>Worst causal regime</small><b>${escapeHtml(losses.worstRegime.key)}</b></span>
      <span><small>Worst action pair</small><b>${escapeHtml(losses.worstActionPair.key)}</b></span>
      <span><small>Worst switch state</small><b>${escapeHtml(losses.worstSwitchState.key)}</b></span>
    </div>
    <div class="rl-fusion-test">
      <small>TEST · VISIBLE AUDIT ONLY · NEVER ENTERS DIAGNOSIS</small>
      <span>candidate Δ Sharpe <b>${signedMetric(test.candidateFactor.fixedSleeveSharpeDeltaVsBalanced)}</b></span>
      <span>gross → net active <b>${signedPercent(test.adaptiveTransmission.meanTrialGrossActiveReturn)} → ${signedPercent(test.adaptiveTransmission.meanTrialNetActiveReturn)}</b></span>
      <span>Sharpe advantage <b>${signedMetric(test.adaptiveTransmission.meanSharpeAdvantageVsSelectedBaseline)}</b></span>
      <span>positive net trials <b>${percent(test.stability.positiveNetTrialRate)}</b></span>
    </div>
    <p class="rl-fusion-disclosure">
      Candidate fixed-sleeve evidence and same-pretrade one-step opportunity are distinct.
      Adaptive gross/cost/net uses independent complete policy paths. Local best is ex-post;
      Q margins are uncalibrated; validation alone sets the research focus. No training,
      KEEP/REVERT, promotion, order, account, or trading authority.
    </p>`;
}

function renderRlBehavior(explorer) {
  const root = element("rl-behavior");
  const behavior = explorer.policyBehavior;
  if (!behavior?.available) {
    root.innerHTML = `
      <div class="rl-behavior-empty">
        Legacy Run: exact policy-rationale evidence was not recorded.
      </div>`;
    return;
  }
  const split = behavior[state.rlSplit];
  const actions = [...split.byAction].sort(
    (left, right) => right.frequency - left.frequency ||
      left.action.localeCompare(right.action),
  );
  const features = [...split.byFeature]
    .sort(
      (left, right) => right.dominantRate - left.dominantRate ||
        right.meanAbsoluteMarginContribution -
          left.meanAbsoluteMarginContribution ||
        left.feature.localeCompare(right.feature),
    )
    .slice(0, 8);
  const decisions = behavior.representativeDecisions
    .filter((row) => row.split === state.rlSplit)
    .sort(
      (left, right) => left.actionMargin - right.actionMargin ||
        left.timestamp.localeCompare(right.timestamp),
    );
  const representatives = [
    ...decisions.slice(0, 3),
    ...decisions.slice(-3),
  ];
  root.innerHTML = `
    <div class="rl-behavior-stats">
      <span><small>Mean action run</small><b>${metric(split.meanActionRunLength)} bars</b></span>
      <span><small>Transition / retention</small><b>${percent(split.transitionRate)} / ${percent(split.retentionRate)}</b></span>
      <span><small>Single-bar runs</small><b>${percent(split.singleBarRunRate)}</b></span>
      <span><small>Median Q margin</small><b>${metric(split.medianActionMargin)}</b></span>
      <span><small>Q ties</small><b>${percent(split.tieRate)}</b></span>
      <span><small>Evidence coverage</small><b>${metric(split.decisions)} decisions · ${metric(split.trialPaths)} paths</b></span>
    </div>
    <div class="rl-behavior-grid">
      <section>
        <h3>Action sleeves</h3>
        <div class="rl-behavior-table action-table" role="table" aria-label="Action sleeve behavior">
          <div class="heading" role="row">
            <span>Action</span><span>Use</span><span>Run</span><span>Q margin</span><span>Reward</span><span>Turnover</span>
          </div>
          ${actions
            .map(
              (row) => `
                <div role="row">
                  <span><i class="rl-action-${escapeHtml(row.action)}"></i><b>${escapeHtml(row.action)}</b></span>
                  <span>${percent(row.frequency)}</span>
                  <span>${metric(row.meanActionRunLength)}</span>
                  <span>${metric(row.meanActionMargin)}</span>
                  <span class="${row.meanReward >= 0 ? "positive" : "negative"}">${metric(row.meanReward)}</span>
                  <span>${metric(row.meanOneWayTurnover)}</span>
                </div>`,
            )
            .join("")}
        </div>
      </section>
      <section>
        <h3>Dominant margin drivers</h3>
        <div class="rl-behavior-table feature-table" role="table" aria-label="Dominant linear margin features">
          <div class="heading" role="row">
            <span>Feature</span><span>Dominant</span><span>Mean |contrib|</span><span>Mean signed</span>
          </div>
          ${features
            .map(
              (row) => `
                <div role="row">
                  <span><b>${escapeHtml(row.feature)}</b></span>
                  <span>${percent(row.dominantRate)}</span>
                  <span>${metric(row.meanAbsoluteMarginContribution)}</span>
                  <span class="${row.meanSignedMarginContribution >= 0 ? "positive" : "negative"}">${metric(row.meanSignedMarginContribution)}</span>
                </div>`,
            )
            .join("")}
        </div>
      </section>
    </div>
    <section class="rl-rationale-decisions">
      <h3>Representative low / high-margin decisions</h3>
      <div class="rl-rationale-list">
        ${representatives
          .map(
            (row, index) => `
              <div>
                <span>
                  <small>${index < 3 ? "LOW MARGIN" : "HIGH MARGIN"} · ${escapeHtml(row.fold)} / s${metric(row.seed)} · ${escapeHtml(row.timestamp)}</small>
                  <b>${escapeHtml(row.selectedAction)} <i>over</i> ${escapeHtml(row.runnerUpAction)}</b>
                </span>
                <span>
                  <small>Q margin</small>
                  <b>${metric(row.actionMargin)}</b>
                </span>
                <span>
                  <small>Dominant contribution</small>
                  <b>${escapeHtml(row.dominantMarginFeature)} · ${metric(row.dominantMarginContribution)}</b>
                </span>
                <span>
                  <small>Realized reward</small>
                  <b class="${row.reward >= 0 ? "positive" : "negative"}">${metric(row.reward)}</b>
                </span>
              </div>`,
          )
          .join("")}
      </div>
    </section>
      <p class="book-disclosure">Q margins are uncalibrated linear-model scores—not probability or confidence. Feature contributions exactly decompose the chosen-minus-runner-up margin, but are not causal importance. Realized action outcomes are descriptive and endogenous. No Broker, account, capital, or order authority.</p>`;
}

function renderRlOpportunity(explorer) {
  const root = element("rl-opportunity");
  const audit = explorer.factorOpportunity;
  if (!audit?.available) {
    root.innerHTML = `
      <div class="rl-behavior-empty">
        Legacy Run: same-pretrade one-step factor opportunity evidence was not recorded.
      </div>`;
    return;
  }
  const split = audit[state.rlSplit];
  const candidate = split.candidate;
  const actions = [...split.byAction].sort(
    (left, right) => right.oracleFrequency - left.oracleFrequency ||
      left.action.localeCompare(right.action),
  );
  const decisions = audit.representativeDecisions
    .filter((row) => row.split === state.rlSplit)
    .sort(
      (left, right) => right.realizedRegret - left.realizedRegret ||
        left.timestamp.localeCompare(right.timestamp),
    )
    .slice(0, 6);
  root.innerHTML = `
    <div class="rl-behavior-stats rl-opportunity-stats">
      <span><small>Selected = local best</small><b>${percent(split.oracleHitRate)}</b></span>
      <span><small>Mean selected rank</small><b>${metric(split.meanSelectedRank)} / ${metric(explorer.protocol.actions.length)}</b></span>
      <span><small>Mean one-step regret</small><b>${metric(split.meanRealizedRegret)}</b></span>
      <span><small>P90 / max regret</small><b>${metric(split.p90RealizedRegret)} / ${metric(split.maximumRealizedRegret)}</b></span>
      <span><small>Candidate locally best</small><b>${percent(candidate.oracleFrequency)}</b></span>
      <span><small>Candidate vs balanced</small><b>${percent(candidate.winRateVsBalanced)} wins</b></span>
    </div>
    <div class="rl-behavior-grid rl-opportunity-grid">
      <section>
        <h3>Selected mix versus ex-post local-best mix</h3>
        <div class="rl-behavior-table opportunity-table" role="table" aria-label="Selected and locally best factor sleeves">
          <div class="heading" role="row">
            <span>Sleeve</span><span>Selected</span><span>Locally best</span><span>Mean reward</span><span>Turnover</span>
          </div>
          ${actions
            .map(
              (row) => `
                <div role="row">
                  <span><i class="rl-action-${escapeHtml(row.action)}"></i><b>${escapeHtml(row.action)}</b></span>
                  <span>${percent(row.selectedFrequency)}</span>
                  <span>${percent(row.oracleFrequency)}</span>
                  <span class="${row.meanLocalReward >= 0 ? "positive" : "negative"}">${metric(row.meanLocalReward)}</span>
                  <span>${metric(row.meanOneWayTurnover)}</span>
                </div>`,
            )
            .join("")}
        </div>
      </section>
      <section>
        <h3>Candidate factor capture</h3>
        <div class="rl-candidate-opportunity">
          <span><small>Selected / locally best</small><b>${percent(candidate.selectedFrequency)} / ${percent(candidate.oracleFrequency)}</b></span>
          <span><small>Missed opportunity</small><b>${percent(candidate.missedOpportunityRate)}</b></span>
          <span><small>Mean Δ vs selected</small><b class="${candidate.meanVsSelectedReward >= 0 ? "positive" : "negative"}">${metric(candidate.meanVsSelectedReward)}</b></span>
          <span><small>Mean Δ vs balanced</small><b class="${candidate.meanVsBalancedReward >= 0 ? "positive" : "negative"}">${metric(candidate.meanVsBalancedReward)}</b></span>
        </div>
      </section>
    </div>
    <section class="rl-rationale-decisions rl-opportunity-decisions">
      <h3>Largest realized one-step opportunity gaps</h3>
      <div class="rl-rationale-list">
        ${decisions
          .map(
            (row) => `
              <div>
                <span>
                  <small>${escapeHtml(row.fold)} / s${metric(row.seed)} · ${escapeHtml(row.timestamp)} · rank ${metric(row.selectedRank)}</small>
                  <b>${escapeHtml(row.selectedAction)} <i>→ local best</i> ${escapeHtml(row.oracleAction)}</b>
                </span>
                <span>
                  <small>Selected / local-best reward</small>
                  <b>${metric(row.selectedReward)} / ${metric(row.oracleReward)}</b>
                </span>
                <span>
                  <small>Realized regret</small>
                  <b class="negative">${metric(row.realizedRegret)}</b>
                </span>
                <span>
                  <small>Candidate Δ vs selected / balanced</small>
                  <b>${metric(row.candidateMinusSelectedReward)} / ${metric(row.candidateMinusBalancedReward)}</b>
                </span>
              </div>`,
          )
          .join("")}
      </div>
    </section>
    <p class="book-disclosure">Each alternative starts from the selected policy path’s exact actual pretrade book, uses the same target, no-trade, volatility-risk, cost, and next-bar reward primitives, then stops. “Local best” is known only after the bar: it is a hindsight audit upper bound—not a strategy, confidence score, selection input, or trading authority.</p>`;
}

function renderRlExplorer(project) {
  const section = element("rl-explorer");
  const explorer = project.rlExplorer;
  if (!explorer) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const summary = explorer.summary;
  const fusion = explorer.factorFusion;
  const advantage = summary.meanValidationAdvantageVsBestBaseline;
  const candidateAdvantage = fusion.meanValidationAdvantageVsCandidateFactor;
  const learningContract = explorer.protocol.configuration.learningContract;
  const seedStability = summary.withinFoldSeedStability;
  element("rl-meta").textContent =
    `${explorer.run.id} · ${summary.trialCount} fold/seed trials · ${
      learningContract ? "train-only frozen learner" : "legacy learner"
    } · validation selection`;
  element("rl-mandate").innerHTML = mandateMarkup(explorer.portfolioMandate);
  const fusionCards = fusion.available
    ? [
        ["vs candidate factor", `${candidateAdvantage > 0 ? "+" : ""}${metric(candidateAdvantage)}`, "content-locked baseline", candidateAdvantage >= 0 ? "positive" : "negative"],
        ["Candidate usage", percent(fusion.meanValidationCandidateActionFrequency), "validation action frequency", ""],
      ]
    : [
        ["Factor fusion", "Legacy", "reference sleeves only", "audit"],
      ];
  element("rl-summary").innerHTML = [
    ["RL value-add", `${advantage > 0 ? "+" : ""}${metric(advantage)}`, "vs best validation baseline", advantage >= 0 ? "positive" : "negative"],
    ...fusionCards,
    ["Validation Sharpe", metric(summary.validation.mean), `minimum ${metric(summary.validation.minimum)}`, ""],
    [
      "Within-fold seed σ",
      metric(seedStability.maximumStandardDeviation),
      learningContract
        ? `${seedStability.exactConsensusFolds}/${seedStability.folds} action consensus · frozen config`
        : `${seedStability.exactConsensusFolds}/${seedStability.folds} action consensus · legacy config`,
      "",
    ],
    ["Failure rate", percent(summary.failureRate), "all declared trials", summary.failureRate ? "negative" : ""],
    ["Mean turnover", metric(summary.meanValidationOneWayTurnover), "one-way · validation", ""],
    ["Mean cost drag", percent(summary.meanValidationCostDrag), "validation", ""],
    ["Test Sharpe", metric(summary.testAudit.mean), "VISIBLE AUDIT ONLY", "audit"],
  ]
    .map(
      ([label, value, note, tone]) => `
        <span class="${tone}">
          <small>${escapeHtml(label)}</small>
          <b>${escapeHtml(value)}</b>
          <i>${escapeHtml(note)}</i>
        </span>`,
    )
    .join("");
  renderRlChart(explorer);
  renderRlTrials(explorer);
  renderRlBaselines(explorer);
  renderRlDetail(explorer);
  renderRlFusionDiagnosis(explorer);
  renderRlIncremental(explorer);
  renderRlBehavior(explorer);
  renderRlOpportunity(explorer);
  const command = project.commands?.find((item) => item.id === "run.rl");
  element("rl-warning").innerHTML = `
    <span>${escapeHtml(explorer.warning)}</span>
    ${copyCommandButton(command, "Copy RL JSON command")}`;
}

function matrixValue(value, unit) {
  if (unit === "percent") return percent(value);
  if (unit === "count") {
    return value === null || value === undefined ? "—" : metric(Math.round(Number(value)));
  }
  return metric(value);
}

function matrixRelationLabel(relation) {
  return {
    better: "BETTER",
    worse: "WORSE",
    same: "SAME",
    context: "CONTEXT",
    unavailable: "N/A",
    "audit-better": "AUDIT ↑",
    "audit-worse": "AUDIT ↓",
    "audit-same": "AUDIT =",
    "display-better": "DISPLAY ↑",
    "display-worse": "DISPLAY ↓",
    "display-same": "DISPLAY =",
  }[relation] ?? "";
}

function renderDecisionMatrix(project) {
  const section = element("decision-matrix");
  const session = selectedSession(project);
  const matrix = session?.decisionMatrix;
  if (!matrix) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  const descriptors = matrix.metrics.filter(
    (item) => state.matrixView === "all" || item.split !== "test",
  );
  const descriptorByKey = Object.fromEntries(
    matrix.metrics.map((item) => [item.key, item]),
  );
  const leader = matrix.trials.find((trial) => trial.isCurrentLeader);
  const leaderTradeoffs = matrix.tradeoffs.leaderVsBaseline;
  const comparableCount = matrix.tradeoffs.selectionEligibleMetricKeys.length;
  element("decision-matrix-meta").textContent =
    `${matrix.metricFamily} · ${matrix.scope.displayedCandidateTrials}/${matrix.scope.totalCandidateTrials} candidates · ${matrix.selectionIntegrity.selectionSplit} selection`;
  element("decision-summary").innerHTML = [
    [
      "Leader objective",
      matrixValue(leader?.primaryValue, "number"),
      matrix.objective.metric,
      "leader",
    ],
    [
      "Better vs baseline",
      `${leaderTradeoffs.improved.length}/${comparableCount}`,
      "validation-eligible fields",
      "better",
    ],
    [
      "Worse vs baseline",
      `${leaderTradeoffs.regressed.length}/${comparableCount}`,
      "trade-offs to inspect",
      leaderTradeoffs.regressed.length ? "worse" : "",
    ],
    [
      "Non-dominated",
      matrix.tradeoffs.nonDominatedRunIds.length,
      "displayed successful Runs",
      "neutral",
    ],
  ]
    .map(
      ([label, value, note, tone]) => `
        <span class="${tone}">
          <small>${escapeHtml(label)}</small>
          <b>${escapeHtml(value)}</b>
          <i>${escapeHtml(note)}</i>
        </span>`,
    )
    .join("");

  const trialHeaders = matrix.trials
    .map((trial) => {
      const identity =
        trial.role === "baseline"
          ? "B0"
          : `E${String(trial.sequence).padStart(2, "0")}`;
      return `
        <th class="matrix-trial-head ${normalizedStatus(trial.verdict)} ${trial.isCurrentLeader ? "leader" : ""}"
          scope="col" title="${escapeHtml(trial.hypothesis)}">
          <small>${identity}${trial.isCurrentLeader ? " · LEADER" : ""}</small>
          <b>${escapeHtml(trial.verdict)}</b>
          <code>${escapeHtml(shortHash(trial.runId))}</code>
        </th>`;
    })
    .join("");
  let previousGroup = null;
  const rows = [];
  for (const descriptor of descriptors) {
    if (descriptor.group !== previousGroup) {
      rows.push(`
        <tr class="matrix-group-row">
          <th colspan="${matrix.trials.length + 1}">${escapeHtml(descriptor.group)} · ${escapeHtml(descriptor.split)}</th>
        </tr>`);
      previousGroup = descriptor.group;
    }
    const cells = matrix.trials
      .map((trial) => {
        const value = trial.metrics[descriptor.key];
        const relation = trial.vsBaseline[descriptor.key];
        const failed = trial.status !== "succeeded";
        return `
          <td class="matrix-value ${failed ? "failed" : normalizedStatus(relation)} ${trial.isCurrentLeader ? "leader" : ""}">
            <b>${failed ? "CRASH" : escapeHtml(matrixValue(value, descriptor.unit))}</b>
            <small>${trial.role === "baseline" ? "REFERENCE" : escapeHtml(matrixRelationLabel(relation))}</small>
          </td>`;
      })
      .join("");
    rows.push(`
      <tr class="${descriptor.primary ? "primary" : ""} ${descriptor.split === "test" ? "audit" : ""}">
        <th class="matrix-metric" scope="row">
          <b>${escapeHtml(descriptor.label)}</b>
          <small>${descriptor.primary ? "PRIMARY · " : ""}${escapeHtml(descriptor.preference)}${descriptor.selectionEligible ? " · COMPARED" : " · DISPLAY ONLY"}</small>
        </th>
        ${cells}
      </tr>`);
  }
  element("decision-matrix-table").innerHTML = `
    <table class="decision-table" aria-label="Verified Session metric comparison">
      <thead>
        <tr>
          <th class="matrix-corner" scope="col">
            <small>METRIC DICTIONARY</small>
            <b>${descriptors.length} evidence rows</b>
          </th>
          ${trialHeaders}
        </tr>
      </thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;
  const labels = (keys) =>
    keys
      .map((key) => descriptorByKey[key]?.label ?? key)
      .join(", ") || "none";
  element("decision-matrix-note").textContent =
    state.matrixView === "all"
      ? "Test evidence is visible audit only and remains excluded from every comparison claim."
      : "Validation and fixed full-scope evidence; test audit is hidden.";
  element("decision-tradeoff-note").innerHTML =
    `<b>Leader gains:</b> ${escapeHtml(labels(leaderTradeoffs.improved))} ` +
    `<span>·</span> <b>Watch:</b> ${escapeHtml(labels(leaderTradeoffs.regressed))} ` +
    `<span>·</span> ${escapeHtml(matrix.tradeoffs.warning)}`;
  document.querySelectorAll("[data-matrix-view]").forEach((button) => {
    button.setAttribute(
      "aria-selected",
      String(button.dataset.matrixView === state.matrixView),
    );
  });
}

function renderTrajectory(project) {
  const session = selectedSession(project);
  const experiments = session?.experiments ?? [];
  const familyTrials =
    session?.selectionIntegrity.researchFamily?.uniqueSourceTrials ??
    session?.selectionIntegrity.candidateTrials ??
    0;
  element("trajectory-meta").textContent = session
    ? `${session.session.studyId} · ${familyTrials} Project-family trials · ${selectionContext(session.selectionIntegrity)} · ${session.selectionIntegrity.selectionSplit} selection · ${testExposureContext(session.selectionIntegrity)} · ${session.selectionIntegrity.externalHoldoutRequired ? "new holdout required" : "no new holdout yet"}`
    : "No Experiments";
  if (!experiments.length) {
    element("trajectory-chart").innerHTML =
      project.externalHoldout
        ? '<div class="empty-panel">Candidate iteration is disabled; the external audit preserves no mutable trajectory.</div>'
        : '<div class="empty-panel">Candidate verdicts will appear here.</div>';
    return;
  }
  const numeric = experiments
    .map((item) => item.candidateValue)
    .filter((value) => value !== null && Number.isFinite(Number(value)))
    .map(Number);
  const low = Math.min(...numeric, Number(session.session.baseline.value));
  const high = Math.max(...numeric, Number(session.session.leader.value));
  const spread = Math.max(0.000001, high - low);
  element("trajectory-chart").innerHTML = experiments
    .map((experiment, index) => {
      const value = experiment.candidateValue;
      const height =
        experiment.verdict === "CRASH" || value === null
          ? 7
          : 24 + ((Number(value) - low) / spread) * 130;
      const level = Math.max(1, Math.min(20, Math.ceil(height / 8)));
      const title = `${experiment.verdict}: ${experiment.hypothesis} — ${metric(value)}`;
      return `
        <button class="trace-column ${normalizedStatus(experiment.verdict)}" type="button"
          data-experiment="${escapeHtml(experiment.id)}" title="${escapeHtml(title)}"
          aria-label="${escapeHtml(title)}">
          <i class="trace-level-${level}"></i>
          <span>${index + 1}</span>
        </button>`;
    })
    .join("");
  document.querySelectorAll("[data-experiment]").forEach((button) => {
    button.addEventListener("click", () => {
      const experiment = experiments.find((item) => item.id === button.dataset.experiment);
      if (experiment) renderExperimentInspector(session, experiment);
    });
  });
}

function eventSubtitle(event) {
  const labels = {
    run: "Immutable Run",
    session: "Session pointer",
    experiment: "Experiment verdict",
    campaign: "Terminal Campaign",
    report: "Immutable Research Report",
    dossier: "Immutable Project Research Dossier",
    progress: "Mutable Campaign progress",
  };
  return `${labels[event.kind] ?? event.kind} · ${event.status}`;
}

function renderTimeline(project) {
  element("evidence-stream").innerHTML =
    project.timeline
      .slice(0, 14)
      .map(
        (event) => `
          <li class="evidence-item ${normalizedStatus(event.status)} ${event.mutable ? "mutable" : ""}">
            <i aria-hidden="true"></i>
            <span class="evidence-copy">
              <b>${escapeHtml(event.title)}</b>
              <small>${escapeHtml(eventSubtitle(event))}</small>
            </span>
            <time datetime="${escapeHtml(event.at)}">${escapeHtml(relativeTime(event.at))}</time>
          </li>`,
      )
      .join("") || '<li class="empty-panel">No verified evidence yet.</li>';
}

function runMetricLayers(item) {
  const layers = item.metricLayers;
  if (!layers) return "";
  if (layers.kind === "portfolio") {
    const signal = layers.signalPolicy;
    const attribution = layers.attribution;
    return `
      <div class="catalog-evidence" aria-label="Portfolio evidence">
        <span><b>${metric(layers.factor.validationRankIc)}</b><i>validation IC</i></span>
        <span><b>${metric(layers.portfolio.validationNetSharpe)}</b><i>validation</i></span>
        ${signal ? `<span><b>${metric(signal.validationStateChangeRate)}</b><i>state change</i></span>` : ""}
        ${signal ? `<span><b>${metric(signal.validationTransitionReductionRate)}</b><i>hysteresis saved</i></span>` : ""}
        ${attribution ? `<span><b>${metric(attribution.validationMaximumAbsoluteNetContributionShare)}</b><i>max asset contrib.</i></span>` : ""}
        ${attribution ? `<span><b>${metric(attribution.validationMaximumAbsoluteRiskContributionShare)}</b><i>max risk contrib.</i></span>` : ""}
        ${attribution ? `<span><b>${attribution.validationReconciliationPassed ? "pass" : "fail"}</b><i>attribution</i></span>` : ""}
        <span><b>${metric(layers.portfolio.testNetSharpe)}</b><i>test audit</i></span>
        <span><b>${metric(layers.implementation.testAnnualizedTurnover)}</b><i>ann. turn</i></span>
        <span><b>${metric(layers.robustness.testAdverseCostSharpe)}</b><i>${metric(layers.robustness.adverseCostBps)}bps stress</i></span>
      </div>`;
  }
  if (layers.kind === "rl-policy") {
    return `
      <div class="catalog-evidence" aria-label="RL policy evidence">
        <span><b>${metric(layers.validationMeanNetSharpe)}</b><i>validation</i></span>
        <span><b>${metric(layers.testMeanNetSharpe)}</b><i>test audit</i></span>
        <span><b>${metric(layers.validationSeedFoldStd)}</b><i>seed/fold σ</i></span>
        <span><b>${metric(layers.validationBaselineAdvantage)}</b><i>vs baseline</i></span>
        <span><b>${metric(layers.failureRate)}</b><i>fail rate</i></span>
        <span><b>${layers.folds}×${layers.seeds}</b><i>folds × seeds</i></span>
      </div>`;
  }
  if (layers.kind === "factor") {
    const horizon = layers.researchHorizon;
    const primary = horizon?.primaryForwardBars ?? 1;
    const farthest = layers.farthestForwardBars ?? primary;
    return `
      <div class="catalog-evidence" aria-label="Factor evidence">
        <span><b>${metric(layers.validationMeanIc)}</b><i>validation ${primary}b IC</i></span>
        <span><b>${metric(layers.validationPearsonIc)}</b><i>Pearson IC</i></span>
        <span><b>${metric(layers.validationHacTStatistic)}</b><i>HAC t-stat</i></span>
        <span><b>${metric(layers.validationFarthestHorizonMeanIc)}</b><i>validation ${farthest}b IC</i></span>
        <span><b>${metric(layers.validationQuantileSpread)}</b><i>tertile spread</i></span>
        <span><b>${metric(layers.validationWorstFoldMeanIc)}</b><i>worst fold IC</i></span>
        <span><b>${metric(layers.validationMaximumAbsoluteStyleCorrelation)}</b><i>max style |ρ|</i></span>
        <span><b>${metric(layers.testMeanIc)}</b><i>test audit IC</i></span>
        <span><b>${metric(layers.meanRankTurnover)}</b><i>rank turn</i></span>
      </div>`;
  }
  return "";
}

function renderCatalog(project) {
  const items = project[state.catalog];
  document.querySelectorAll("[data-catalog]").forEach((button) => {
    button.setAttribute(
      "aria-selected",
      String(button.dataset.catalog === state.catalog),
    );
  });
  if (!items.length) {
    element("catalog").innerHTML = `<div class="empty-panel">No ${escapeHtml(state.catalog)} yet.</div>`;
    return;
  }
  element("catalog").innerHTML = `
    <div class="catalog-grid">
      ${items
        .slice()
        .reverse()
        .slice(0, 12)
        .map((item) =>
          state.catalog === "studies"
            ? `
              <article class="catalog-card">
                <small>${escapeHtml(item.subjectKind)} · ${escapeHtml(item.direction)}</small>
                <strong>${escapeHtml(item.name)}</strong>
                <p>${escapeHtml(item.description || "No description recorded.")}</p>
                <code>${escapeHtml(item.primaryMetric)} · ${escapeHtml(item.id)}</code>
              </article>`
            : `
              <article class="catalog-card">
                <small>${escapeHtml(item.status)}${item.failureDisposition ? ` · ${escapeHtml(item.failureDisposition)}` : ""} · ${escapeHtml(item.subject.kind)}</small>
                <strong>${escapeHtml(item.studyId)}</strong>
                <p>${item.status === "failed" ? escapeHtml(item.summary || "Failed Run requires inspection.") : `${escapeHtml(item.primaryMetric)} = ${metric(item.primaryValue)}`}</p>
                ${item.status === "failed" && item.errors?.length ? `<p><code>${escapeHtml(item.errors.map((error) => error.code).join(" · "))}</code></p>` : ""}
                ${runMetricLayers(item)}
                <code>${escapeHtml(relativeTime(item.startedAt))} · ${item.durationMs}ms</code>
              </article>`,
        )
        .join("")}
    </div>`;
}

function campaignRows(session) {
  const running = session.progress.map(
    (progress) => `
      <div class="campaign-row">
        <span>
          <strong>${escapeHtml(progress.message)}</strong>
          <small>turn ${progress.turn}/${progress.budget.maxTurns} · mutable</small>
        </span>
        <span class="status-chip running">${escapeHtml(progress.phase)}</span>
      </div>`,
  );
  const terminal = session.campaigns
    .slice()
    .reverse()
    .slice(0, 5)
    .map(
      (campaign) => `
        <div class="campaign-row">
          <span>
            <strong>${escapeHtml(campaign.reason)}</strong>
            <small>${campaign.experiments} experiments · ${escapeHtml(relativeTime(campaign.completedAt))}</small>
          </span>
          <span class="status-chip ${normalizedStatus(campaign.status)}">${escapeHtml(campaign.status)}</span>
        </div>`,
    );
  return [...running, ...terminal].join("") || '<p class="empty-copy">No Campaigns recorded.</p>';
}

function renderInspector(project) {
  const session = selectedSession(project);
  if (!session) {
    element("inspector-kind").textContent = "PROJECT";
    const intake = project.intake;
    const baseline = projectFocusRun(project);
    if (intake) {
      const request = intake.request;
      const dataset = intake.dataset;
      const program = project.researchProgramStatus;
      const holdout = project.externalHoldout;
      const lane = projectFocusLane(project);
      const portfolio =
        baseline?.metricLayers?.kind === "portfolio"
          ? baseline.metricLayers
          : null;
      const next =
        holdout?.nextAction ??
        program?.recommendedAction ??
        intake.commands.find((item) => item.id === "session.start");
      element("inspector-content").innerHTML = `
        <section class="inspector-section">
          <small>Research mandate</small>
          <h3>${escapeHtml(request.title)}</h3>
          <p>${escapeHtml(request.question)}</p>
          <dl class="inspector-kv">
            <dt>Requested</dt><dd>${escapeHtml(request.assets.map((item) => item.symbol).join(", "))}</dd>
            <dt>Research universe</dt><dd>${escapeHtml(dataset.universe.join(", "))}</dd>
            <dt>Direction</dt><dd>${escapeHtml(request.direction)}</dd>
            <dt>Horizon</dt><dd>${escapeHtml(request.horizon)} · ${escapeHtml(horizonPolicyText(request))}</dd>
          </dl>
        </section>
        <section class="inspector-section">
          <small>Dataset authority</small>
          <h3>${escapeHtml(dataset.id)}@${escapeHtml(dataset.version)}</h3>
          <p>Provider, calendar, venue, and adjustment values are caller-supplied claims. Canonical Project-local bytes are content locked.</p>
          <dl class="inspector-kv">
            <dt>Provider claim(s)</dt><dd>${escapeHtml(datasetProviderClaim(dataset))}</dd>
            <dt>Adjustment</dt><dd>${escapeHtml(dataset.priceAdjustment)}</dd>
            <dt>Calendar</dt><dd>${escapeHtml(dataset.market.calendar)} · ${escapeHtml(dataset.frequency)}</dd>
            <dt>Coverage</dt><dd>${escapeHtml(dataset.timeRange.start)} → ${escapeHtml(dataset.timeRange.end)}</dd>
            <dt>Dataset hash</dt><dd title="${escapeHtml(intake.manifest.datasetHash)}">${escapeHtml(shortHash(intake.manifest.datasetHash))}</dd>
          </dl>
        </section>
        <section class="inspector-section">
          <small>${holdout ? "Frozen external audit" : lane ? "Recommended lane evidence" : "Immutable baseline"}</small>
          <h3>${holdout ? `${holdout.binding.laneIds.length} bound source lanes` : escapeHtml(lane?.name ?? baseline?.studyId ?? intake.study.name)}</h3>
          ${baseline ? `<span class="status-chip ${valueTone(baseline.primaryValue) === "bad" ? "revert" : "published"}">${escapeHtml(baseline.status)}</span>` : '<span class="status-chip active">pending</span>'}
          <dl class="inspector-kv">
            <dt>${escapeHtml(baseline?.primaryMetric ?? "Primary metric")}</dt><dd>${metric(baseline?.primaryValue)}</dd>
            ${portfolio ? `<dt>Validation rank IC</dt><dd>${metric(portfolio.factor.validationRankIc)}</dd>
            <dt>Test max drawdown</dt><dd>${percent(portfolio.portfolio.testMaximumDrawdown)}</dd>
            <dt>Annual turnover</dt><dd>${percent(portfolio.implementation.testAnnualizedTurnover)}</dd>
            <dt>Cost drag</dt><dd>${percent(portfolio.implementation.testCostDrag)}</dd>` : ""}
            <dt>Selection</dt><dd>validation only</dd>
          </dl>
          ${holdout ? "<p>Only the immutable holdout Run is authorized. Candidate iteration and ordinary Sessions are disabled.</p>" : ""}
          ${copyCommandButton(next, holdout ? (holdout.state === "assessed" ? "Copy holdout show command" : holdout.state === "completed" ? "Copy holdout assess command" : "Copy holdout run command") : program ? "Copy recommended command" : "Copy start command")}
        </section>
        ${dossierInspectorSection(project)}
        ${reportCorrectionInspectorSection(project)}
        ${reviewInspectorSection(project)}
        ${holdout ? "" : `<details class="program-details">
          <summary>Research program</summary>
          <pre class="program-copy">${escapeHtml(project.researchProgram.text)}</pre>
        </details>`}`;
      return;
    }
    const program = project.researchProgramStatus;
    if (program) {
      const assessment = programAssessment(project);
      const laneRows = program.lanes
        .map((lane) => {
          const readout = laneReadout(project, lane);
          return `
            <button class="inspector-lane" type="button" data-open-evidence="${escapeHtml(readout.kind)}">
              <span>
                <small>${escapeHtml(lane.name)}</small>
                <strong>${escapeHtml(readout.verdict)}</strong>
              </span>
              <b class="${escapeHtml(readout.tone)}">${escapeHtml(readout.display)}</b>
            </button>`;
        })
        .join("");
      element("inspector-content").innerHTML = `
        <section class="inspector-section program-verdict">
          <small>Current evidence readout</small>
          <h3>${escapeHtml(assessment.title)}</h3>
          <span class="status-chip ${assessment.tone === "bad" ? "adverse" : "active"}">${escapeHtml(assessment.label)}</span>
          <p>${escapeHtml(assessment.detail)}</p>
        </section>
        <section class="inspector-section">
          <small>Evidence chain</small>
          <div class="inspector-lanes">${laneRows}</div>
        </section>
        <section class="inspector-section">
          <small>Research scope</small>
          <h3>${escapeHtml(program.dataset.id)}@${escapeHtml(program.dataset.version)}</h3>
          <dl class="inspector-kv">
            <dt>Universe</dt><dd>${program.dataset.universe.length} assets</dd>
            <dt>Asset class</dt><dd>${escapeHtml(program.dataset.assetClass)}</dd>
            <dt>Coverage</dt><dd>${escapeHtml(program.dataset.timeRange.start)} → ${escapeHtml(program.dataset.timeRange.end)}</dd>
            <dt>Evidence</dt><dd>validation selects</dd>
          </dl>
        </section>
        <section class="inspector-section">
          <small>Next governed action</small>
          <p>Work the earliest failed lane before interpreting downstream complexity as value-add.</p>
          ${copyCommandButton(program.recommendedAction, "Copy recommended CLI")}
        </section>
        <details class="program-details">
          <summary>Program contract</summary>
          <pre class="program-copy">${escapeHtml(project.researchProgram.text)}</pre>
        </details>`;
      return;
    }
    element("inspector-content").innerHTML = `
      <section class="inspector-section">
        <small>Research program</small>
        <h3>${escapeHtml(project.name)}</h3>
        <p>${escapeHtml(project.description || "No Project description recorded.")}</p>
        <pre class="program-copy">${escapeHtml(project.researchProgram.text)}</pre>
      </section>`;
    return;
  }
  const manifest = session.session;
  const delegation = session.delegation;
  const latestReport = session.reports.at(-1);
  element("inspector-kind").textContent = "SESSION";
  element("inspector-content").innerHTML = `
    ${delegation ? `
    <section class="inspector-section">
      <small>Incoming research brief</small>
      <h3>${escapeHtml(delegation.request.title)}</h3>
      <p>${escapeHtml(delegation.request.question)}</p>
      <dl class="inspector-kv">
        <dt>Direction</dt><dd>${escapeHtml(delegation.request.direction)}</dd>
        <dt>Horizon</dt><dd>${escapeHtml(delegation.request.horizon)} · ${escapeHtml(horizonPolicyText(delegation.request))}</dd>
        <dt>Brief</dt><dd title="${escapeHtml(delegation.brief.id)}">${escapeHtml(delegation.brief.id)}</dd>
        <dt>Origin</dt><dd>caller-supplied</dd>
      </dl>
    </section>` : ""}
    <section class="inspector-section">
      <small>Current leader</small>
      <h3>${escapeHtml(manifest.studyId)}</h3>
      <span class="status-chip ${normalizedStatus(manifest.status)}">${escapeHtml(manifest.status)}</span>
      <dl class="inspector-kv">
        <dt>Metric</dt><dd>${escapeHtml(manifest.leader.metric)}</dd>
        <dt>Value</dt><dd>${metric(manifest.leader.value)}</dd>
        <dt>Baseline</dt><dd>${metric(manifest.baseline.value)}</dd>
        <dt>Experiments</dt><dd>${session.experiments.length}</dd>
        <dt>Test exposure</dt><dd>${escapeHtml(testExposureContext(session.selectionIntegrity))}</dd>
        <dt>Post-audit edits</dt><dd>${session.selectionIntegrity.postAuditCandidateIterations ?? "unknown"}</dd>
        <dt>Authority</dt><dd>${session.authority.valid ? "verified" : "stale"}</dd>
      </dl>
    </section>
    ${selectionRiskSection(session.selectionIntegrity)}
    <section class="inspector-section">
      <small>Researcher Campaigns</small>
      <div class="campaign-list">${campaignRows(session)}</div>
    </section>
    <section class="inspector-section">
      <small>Candidate worktree</small>
      <p>${escapeHtml(session.candidate?.differsFromLeader ? "Candidate differs from the verified leader." : "Candidate matches the verified leader.")}</p>
      <dl class="inspector-kv">
        <dt>Session</dt><dd title="${escapeHtml(manifest.id)}">${escapeHtml(manifest.id)}</dd>
        <dt>Next sequence</dt><dd>${manifest.nextExperiment}</dd>
        <dt>Editable</dt><dd>${escapeHtml(manifest.editablePaths.join(", "))}</dd>
      </dl>
    </section>
    <section class="inspector-section">
      <small>Research report</small>
      <h3>${escapeHtml(latestReport?.title ?? "No report published")}</h3>
      <p>${escapeHtml(latestReport?.executiveSummary ?? (delegation ? "Publish structured analysis when the evidence is ready." : "This manual Session has no delegated report brief."))}</p>
      ${reportDecisionProof(latestReport)}
      ${delegation ? copyCommandButton(commandFor(session, latestReport ? "report.show" : "report.publish")) : ""}
    </section>
    ${dossierInspectorSection(project)}
    ${reportCorrectionInspectorSection(project)}
    ${reviewInspectorSection(project)}
    <section class="inspector-section">
      <small>Agent control surface</small>
      ${copyCommandButton(commandFor(session, "session.complete"), "Copy completion CLI")}
      ${copyCommandButton(commandFor(session, "session.show"))}
    </section>
    <section class="inspector-section">
      <small>Research program</small>
      <pre class="program-copy">${escapeHtml(project.researchProgram.text)}</pre>
    </section>`;
}

function renderExperimentInspector(session, experiment) {
  element("inspector-kind").textContent = "EXPERIMENT";
  element("inspector-content").innerHTML = `
    <section class="inspector-section">
      <small>Immutable verdict</small>
      <h3>${escapeHtml(experiment.hypothesis)}</h3>
      <span class="status-chip ${normalizedStatus(experiment.verdict)}">${escapeHtml(experiment.verdict)}</span>
      <dl class="inspector-kv">
        <dt>Leader</dt><dd>${metric(experiment.leaderValue)}</dd>
        <dt>Candidate</dt><dd>${metric(experiment.candidateValue)}</dd>
        <dt>Improvement</dt><dd>${metric(experiment.improvement)}</dd>
        <dt>Sequence</dt><dd>${experiment.sequence}</dd>
        <dt>Completed</dt><dd>${escapeHtml(relativeTime(experiment.completedAt))}</dd>
      </dl>
    </section>
    <section class="inspector-section">
      <small>Evidence identity</small>
      <dl class="inspector-kv">
        <dt>Experiment</dt><dd title="${escapeHtml(experiment.id)}">${escapeHtml(experiment.id)}</dd>
        <dt>Candidate Run</dt><dd title="${escapeHtml(experiment.runId)}">${escapeHtml(experiment.runId)}</dd>
        <dt>Session</dt><dd title="${escapeHtml(session.session.id)}">${escapeHtml(session.session.id)}</dd>
      </dl>
    </section>`;
}

function renderDiagnostics(project) {
  const all = [...state.snapshot.diagnostics, ...project.diagnostics];
  const banner = element("diagnostics");
  if (!all.length) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }
  banner.hidden = false;
  banner.textContent = `${all.length} verification ${all.length === 1 ? "issue" : "issues"} — ${all
    .slice(0, 2)
    .map((issue) => `${issue.category}: ${issue.message}`)
    .join(" · ")}`;
}

function renderEmptyWorkspace(message = "Create a Project with aq project create.") {
  element("project-state").textContent = "EMPTY WORKSPACE";
  element("project-title").textContent = "No research Projects yet";
  element("project-description").textContent = message;
  element("decision-brief").className = "decision-brief neutral";
  element("decision-brief").innerHTML = `
    <header><small>Current research decision</small><span class="decision-status">NO PROJECT</span></header>
    <h2>Research workspace is ready</h2>
    <p>Create a bounded Project and fixed Study before interpreting any evidence.</p>
    <footer><span><small>Next investigation</small><b>${escapeHtml(message)}</b></span><code>LOCAL / READ ONLY</code></footer>`;
  element("scoreboard").innerHTML = ["Projects", "Studies", "Runs", "Sessions"]
    .map(
      (label) => `
        <div class="score-cell">
          <small>${label}</small>
          <strong>0</strong>
          <span>waiting</span>
        </div>`,
    )
    .join("");
  element("pulse-meta").textContent = "No active Sessions";
  element("session-lanes").innerHTML =
    '<div class="empty-panel">A governed Session will appear here after its first fixed baseline.</div>';
  element("handoff-flow").textContent = "REQUEST → EVIDENCE → REPORT";
  element("handoff-meta").textContent = "No delegated request";
  element("research-handoff").hidden = false;
  element("handoff-board").innerHTML =
    '<div class="empty-panel handoff-empty">Delegated research requests will appear here.</div>';
  element("research-program-status").hidden = true;
  element("research-agenda").hidden = true;
  element("external-holdout").hidden = true;
  element("evidence-workbench").hidden = true;
  element("book-risk-explorer").hidden = true;
  element("event-study-explorer").hidden = true;
  element("factor-explorer").hidden = true;
  element("portfolio-explorer").hidden = true;
  element("rl-explorer").hidden = true;
  element("decision-matrix").hidden = true;
  element("trajectory-meta").textContent = "No Experiments";
  element("trajectory-chart").innerHTML =
    '<div class="empty-panel">Candidate verdicts will appear here.</div>';
  element("evidence-stream").innerHTML =
    '<li class="empty-panel">No verified evidence yet.</li>';
  element("catalog").innerHTML =
    '<div class="empty-panel">No fixed Studies yet.</div>';
  const diagnostics = state.snapshot?.diagnostics ?? [];
  element("diagnostics").hidden = diagnostics.length === 0;
  element("diagnostics").textContent = diagnostics.length
    ? `${diagnostics.length} Workspace verification ${diagnostics.length === 1 ? "issue" : "issues"} — ${diagnostics
        .slice(0, 2)
        .map((issue) => `${issue.category}: ${issue.message}`)
        .join(" · ")}`
    : "";
  element("inspector-kind").textContent = "WORKSPACE";
  element("inspector-content").innerHTML =
    '<p class="empty-copy">Workspace discovery is ready. Projects remain self-contained.</p>';
  renderDeskContext(null);
  document.title = "AutoQuant Studio";
  studio.setAttribute("aria-busy", "false");
}

function render() {
  if (!state.snapshot) return;
  const projects = state.snapshot.projects;
  if (!projects.some((project) => project.id === state.projectId)) {
    const hashId = hashProjectId();
    const workspaceDefault = state.snapshot.source.workspace?.defaultProject;
    state.projectId =
      projects.find((project) => project.id === hashId)?.id ??
      projects.find((project) => project.id === workspaceDefault)?.id ??
      projects[0]?.id ??
      null;
  }
  const project = selectedProject();
  renderProjects();
  if (!project) {
    renderEmptyWorkspace();
    return;
  }
  if (!project.sessions.some((item) => item.session.id === state.sessionId)) {
    state.sessionId =
      project.sessions
        .slice()
        .reverse()
        .find((item) => item.session.status === "active")?.session.id ??
      project.sessions.at(-1)?.session.id ??
      null;
  }
  syncEvidenceSelection(project);
  element("project-state").textContent = project.valid
    ? project.externalHoldout
      ? project.externalHoldout.state === "assessed"
        ? "EXTERNAL HOLDOUT COMPLETE"
        : project.externalHoldout.state === "completed"
          ? "HOLDOUT ASSESSMENT REQUIRED"
          : "FROZEN EXTERNAL HOLDOUT"
      : project.counts.runningCampaigns
      ? "RESEARCHER IN PROGRESS"
      : project.bookRiskExplorer || project.eventStudyExplorer || project.bookPathStressExplorer || project.allocationExplorer
        ? "DESCRIPTIVE EVIDENCE READY"
      : project.intake && project.counts.sessions === 0
        ? "CONTENT-LOCKED INTAKE READY"
        : "VERIFIED RESEARCH PROJECT"
    : "ATTENTION REQUIRED";
  element("project-title").textContent = project.name;
  element("project-description").textContent =
    project.description ||
    projectFocusStudy(project)?.description ||
    (project.researchProgramStatus
      ? "One research question tested through predictive signal, costed portfolio, and adaptive-policy evidence."
      : "No Project description recorded.");
  document.title = `${project.name} — AutoQuant Studio`;
  renderDecisionBrief(project);
  renderResearchAgenda(project);
  renderExternalHoldout(project);
  renderScoreboard(project);
  renderDiagnostics(project);
  renderHandoff(project);
  renderResearchProgram(project);
  renderBookRiskExplorer(project);
  renderAllocationExplorer(project);
  renderEventStudyExplorer(project);
  renderBookPathStressExplorer(project);
  renderFactorExplorer(project);
  renderPortfolioExplorer(project);
  renderRlExplorer(project);
  renderSessions(project);
  renderDecisionMatrix(project);
  renderTrajectory(project);
  renderTimeline(project);
  renderCatalog(project);
  renderInspector(project);
  renderEvidenceWorkbench(project);
  renderDeskContext(project);
  bindCopyCommands();
  studio.setAttribute("aria-busy", "false");
}

async function refresh({ quiet = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  if (!quiet) setConnection("", "Verifying");
  try {
    const response = await fetch("/api/v1/snapshot", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      throw new Error(failure?.error?.message ?? `Snapshot failed (${response.status})`);
    }
    state.snapshot = await response.json();
    const source = state.snapshot.source;
    const harness = state.snapshot.harness;
    const configurationSource = source.workspace?.configurationSource;
    const harnessBuild =
      harness.commit === "unavailable"
        ? `${harness.version}@unavailable`
        : `${harness.version}@${shortHash(harness.commit)}${harness.dirty ? "+dirty" : ""}`;
    element("source-scope").textContent =
      `AQ ${harnessBuild} / ${source.scope.toUpperCase()} / ${
        configurationSource === "local-override" ? "LOCAL OVERRIDE" : "WORKSPACE MANIFEST"
      } / READ ONLY`;
    element("source-name").textContent =
      source.workspace?.name ?? source.rootDir;
    element("source-name").title =
      `${source.workspace?.projectsDir ?? source.rootDir}\nHarness source ${harness.sourceHash}`;
    render();
    setConnection("live", `Synced ${relativeTime(state.snapshot.generatedAt)}`);
  } catch (error) {
    console.error("AutoQuant Studio refresh failed", error);
    setConnection("error", "Sync failed");
    if (!state.snapshot) {
      renderEmptyWorkspace(`Studio could not verify this source: ${error.message}`);
    }
  } finally {
    state.loading = false;
  }
}

function scheduleRefresh() {
  window.clearInterval(state.timer);
  if (state.autoRefresh) {
    state.timer = window.setInterval(() => {
      if (!document.hidden) refresh({ quiet: true });
    }, 4000);
  }
}

element("refresh").addEventListener("click", () => refresh());
window.addEventListener("scroll", updateDeskNavActive, { passive: true });
element("inspector-toggle").addEventListener("click", (event) => {
  state.inspectorOpen = !state.inspectorOpen;
  studio.classList.toggle("inspector-collapsed", !state.inspectorOpen);
  element("research-inspector").setAttribute(
    "aria-hidden",
    String(!state.inspectorOpen),
  );
  event.currentTarget.setAttribute(
    "aria-pressed",
    String(state.inspectorOpen),
  );
  event.currentTarget.textContent = state.inspectorOpen ? "Close" : "Inspect";
});
element("auto-refresh").addEventListener("click", (event) => {
  state.autoRefresh = !state.autoRefresh;
  event.currentTarget.setAttribute("aria-pressed", String(state.autoRefresh));
  scheduleRefresh();
});
document.querySelectorAll("[data-catalog]").forEach((button) => {
  button.addEventListener("click", () => {
    state.catalog = button.dataset.catalog;
    const project = selectedProject();
    if (project) renderCatalog(project);
  });
});
document.querySelectorAll("[data-portfolio-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.portfolioView = button.dataset.portfolioView;
    const explorer = selectedProject()?.portfolioExplorer;
    if (explorer) renderPortfolioChart(explorer);
  });
});
document.querySelectorAll("[data-lifecycle-split]").forEach((button) => {
  button.addEventListener("click", () => {
    state.lifecycleSplit = button.dataset.lifecycleSplit;
    const explorer = selectedProject()?.portfolioExplorer;
    if (explorer) renderPortfolioLifecycle(explorer);
  });
});
document.querySelectorAll("[data-parameter-split]").forEach((button) => {
  button.addEventListener("click", () => {
    state.parameterSplit = button.dataset.parameterSplit;
    const explorer = selectedProject()?.portfolioExplorer;
    if (explorer) renderPortfolioParameterNeighborhood(explorer);
  });
});
document.querySelectorAll("[data-factor-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.factorView = button.dataset.factorView;
    const explorer = selectedProject()?.factorExplorer;
    if (explorer) renderFactorChart(explorer);
  });
});
document.querySelectorAll("[data-factor-horizon]").forEach((button) => {
  button.addEventListener("click", () => {
    state.factorHorizon = button.dataset.factorHorizon;
    const explorer = selectedProject()?.factorExplorer;
    if (explorer) renderFactorChart(explorer);
  });
});
document.querySelectorAll("[data-factor-split]").forEach((button) => {
  button.addEventListener("click", () => {
    state.factorSplit = button.dataset.factorSplit;
    const explorer = selectedProject()?.factorExplorer;
    if (explorer) {
      renderFactorChart(explorer);
      renderFactorStability(explorer);
    }
  });
});
document.querySelectorAll("[data-factor-stability]").forEach((button) => {
  button.addEventListener("click", () => {
    state.factorStability = button.dataset.factorStability;
    const explorer = selectedProject()?.factorExplorer;
    if (explorer) renderFactorStability(explorer);
  });
});
document.querySelectorAll("[data-attribution-split]").forEach((button) => {
  button.addEventListener("click", () => {
    state.attributionSplit = button.dataset.attributionSplit;
    const explorer = selectedProject()?.portfolioExplorer;
    if (explorer) renderPortfolioAttribution(explorer);
  });
});
document.querySelectorAll("[data-rl-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.rlView = button.dataset.rlView;
    const explorer = selectedProject()?.rlExplorer;
    if (explorer) renderRlChart(explorer);
  });
});
document.querySelectorAll("[data-rl-split]").forEach((button) => {
  button.addEventListener("click", () => {
    state.rlSplit = button.dataset.rlSplit;
    const explorer = selectedProject()?.rlExplorer;
    if (explorer) {
      renderRlChart(explorer);
      renderRlTrials(explorer);
      renderRlBaselines(explorer);
      renderRlDetail(explorer);
      renderRlBehavior(explorer);
      renderRlOpportunity(explorer);
    }
  });
});
document.querySelectorAll("[data-matrix-view]").forEach((button) => {
  button.addEventListener("click", () => {
    state.matrixView = button.dataset.matrixView;
    const project = selectedProject();
    if (project) renderDecisionMatrix(project);
  });
});
window.addEventListener("hashchange", () => {
  state.projectId = null;
  state.sessionId = null;
  render();
});

scheduleRefresh();
refresh();
