export const TYPE_RULES = Object.freeze({
  eventMinIndex: 10,
  burstWindowMs: 2000,
  cushionMatDrops: 3,
  drummerBurst: 6,
  drummerCount: 15,
  giantPeak: 180,
  giantMaxCount: 6,
  rewindCount: 2,
  quietMaxCount: 3,
  quietPeak: 60,
});

const TYPE_COPY = {
  cushioned: { title: "완충재 수집가형", copy: "매트 위에 몇 번이고 다시 떨어뜨려 봤습니다. 이제 아래층보다 당신이 조용함에 더 집착합니다." },
  drummer: { title: "쿵쿵 드러머형", copy: "박자감은 인정합니다. 아래층은 그 박자를 벌써 외웠습니다." },
  giant: { title: "한 방 거인형", copy: "자주는 아니지만, 한 번이면 충분했습니다. 6층 머그잔에 물결이 일었습니다." },
  rewind: { title: "되감기 반성형", copy: "자기 쿵을 몇 번이고 다시 들었습니다. 귀는 이미 아래층인데, 발뒤꿈치는 아직 위층입니다." },
  quiet: { title: "사뿐 고양이형", copy: "발소리가 너무 작아서, 아래층은 이 집이 빈 줄 압니다. 택배 기사님도요." },
  regular: { title: "보통의 위층형", copy: "특별히 시끄럽지도 조용하지도 않았습니다. 아래층에겐 그 ‘보통’이 매일입니다." },
};

function nonnegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function displayedPeak(peak) {
  return Math.min(999, Math.round(nonnegative(peak)));
}

export function summarizeMatComparison(record) {
  const { before, after } = record ?? {};
  if (!Number.isFinite(before) || before <= 0 || !Number.isFinite(after) || after < 0) return null;
  return { before, after, reduction: (before - after) / before };
}

function eventMetrics(events, rules) {
  let n = 0;
  let peak = 0;
  const times = [];
  const timedActions = new Set();
  for (const event of events) {
    if (!Number.isFinite(event?.index) || event.index < rules.eventMinIndex) continue;
    n++;
    peak = Math.max(peak, event.index);
    const timeMs = event.acceptedAtMs ?? event.timeMs;
    if (!Number.isFinite(timeMs)) continue;
    // Rebounds add to the thump count but share the original accepted action in the burst.
    if (event.actionId != null) {
      if (timedActions.has(event.actionId)) continue;
      timedActions.add(event.actionId);
    }
    times.push(timeMs);
  }

  times.sort((a, b) => a - b);
  let burst = 0;
  let first = 0;
  for (let last = 0; last < times.length; last++) {
    while (first < last && times[last] - times[first] > rules.burstWindowMs) first++;
    burst = Math.max(burst, last - first + 1);
  }
  return { n, peak, burst };
}

// Keep the current prototype site's displayed index until it sends calibrated events.
const prototypeIndex = impulse => Math.round(100 * Math.min(1, impulse / 320));

export function summarizeBehavior(record, rules = TYPE_RULES) {
  const input = record ?? {};
  const matComparison = summarizeMatComparison(input.matComparison);
  const events = Array.isArray(input.events) ? input.events : null;
  let count = 0;
  let average = 0;
  let maximum = 0;
  let prototypeCount = 0;
  if (Array.isArray(input.impulses)) {
    for (const impulse of input.impulses) {
      if (!Number.isFinite(impulse) || impulse < 0) continue;
      count++;
      average += (impulse - average) / count;
      maximum = Math.max(maximum, impulse);
      if (!events && prototypeIndex(impulse) >= rules.eventMinIndex) prototypeCount++;
    }
  }

  const averageImpulse = count ? average : nonnegative(input.averageImpulse);
  const maxImpulse = count ? maximum : Math.max(averageImpulse, nonnegative(input.maxImpulse));
  const metrics = events ? eventMetrics(events, rules) : {
    n: Math.floor(nonnegative(input.n ?? prototypeCount)),
    peak: nonnegative(input.peak ?? (prototypeCount > 0 ? prototypeIndex(maxImpulse) : 0)),
    burst: Math.floor(nonnegative(input.burst)),
  };
  return {
    tapCount: Math.floor(nonnegative(input.tapCount)),
    averageImpulse,
    maxImpulse,
    chairDrags: Math.floor(nonnegative(input.chairDrags)),
    cushionUses: Math.floor(nonnegative(input.cushionUses)),
    timeOfDay: ["day", "night"].includes(input.timeOfDay) ? input.timeOfDay : null,
    ...metrics,
    replays: Math.floor(nonnegative(input.replays)),
    flipMode: ["scroll", "button", "sensor"].includes(input.flipMode) ? input.flipMode : null,
    drag: nonnegative(input.drag),
    matTest: input.matTest === true,
    matDrops: Math.floor(nonnegative(input.matDrops)),
    matComparison,
    reduction: matComparison?.reduction ?? (input.matComparison === undefined && Number.isFinite(input.reduction)
      ? Math.min(1, input.reduction) : null),
  };
}

export function classifyBehavior(record, { enableV11 = false, ...overrides } = {}) {
  const rules = { ...TYPE_RULES, ...overrides };
  const stats = summarizeBehavior(record, rules);
  if (enableV11) {
    if (Number.isFinite(record?.sessionPeak) && record.sessionPeak >= 0) {
      stats.peak = record.sessionPeak;
    } else if (!record?.events?.length && stats.n === 0 && stats.peak === 0) {
      // S5 can provide the card peak without adding to the upstairs count or burst.
      stats.peak = nonnegative(record?.matBefore ?? record?.matComparison?.before);
    }
  }
  const { n, peak, burst, replays, flipMode, drag, matTest, matDrops, matComparison } = stats;
  let id;
  if (enableV11 && matTest && matDrops >= rules.cushionMatDrops) {
    id = "cushioned";
  } else if (burst >= rules.drummerBurst || n >= rules.drummerCount) {
    id = "drummer";
  } else if (peak >= rules.giantPeak && n <= rules.giantMaxCount) {
    id = "giant";
  } else if (replays >= rules.rewindCount) {
    id = "rewind";
  } else if (n <= rules.quietMaxCount && peak < rules.quietPeak) {
    id = "quiet";
  } else {
    id = "regular";
  }

  const shownPeak = displayedPeak(peak);
  const { title, copy } = TYPE_COPY[id];
  return {
    id,
    title,
    copy,
    cardVariant: "peak",
    headline: `최대 쿵 ${shownPeak}`,
    detail: `쿵 ${n}번 · 최대 ${shownPeak}${enableV11 && drag > 0 ? ` · 의자 끌기 ${Math.round(drag * 10) / 10}칸` : ""}`,
    matLine: enableV11 && matTest && matComparison
      ? `매트 위에선 쿵 ${displayedPeak(matComparison.before)} → ${displayedPeak(matComparison.after)}` : "",
    badge: enableV11 && flipMode === "sensor" ? "휴대폰으로 직접 뒤집음" : "",
    stats,
  };
}
