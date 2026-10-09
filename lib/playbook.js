// Playbook tagging + stats.
//
// Round trips come from lib/pnl.js (buildLedger). A tag is stored per round
// trip under the record key `tags:YYYY-MM-DD` as { [tripKey]: Tag }, so the
// existing entries/trades/positions records are never touched.
//
// Tag = {
//   play:   string   // a playbook play name ('' = untagged)
//   broke:  string[] // ids of RULES the trader broke on this trade
//   exit:   string   // id of EXIT_TYPES
//   note:   string
// }
// "Followed all rules" is derived: no manual rule broken AND size within cap.

export const DEFAULT_PLAYS = [
  'Micro momentum (2 vol bars)',
  'Opening range break',
  'VWAP reclaim',
  'Level 2 tape read',
  'Reversal / fade',
  'Other',
];

// Manually checked rules. Size cap is automatic (see tripFacts), so it is not here.
export const RULES = [
  { id: 'signal', label: 'Entry signal met' },
  { id: 'chase', label: 'No chase' },
  { id: 'stop', label: 'Stop set at entry' },
  { id: 'reentry', label: 'No re-entry after a loss' },
  { id: 'plan', label: 'Exit per plan' },
];

export const EXIT_TYPES = [
  { id: 'stop', label: 'Stopped out' },
  { id: 'trail', label: 'Trailed (9 EMA)' },
  { id: 'target', label: 'Hit target' },
  { id: 'early', label: 'Panic / early' },
  { id: 'late', label: 'Held too long' },
];

export const DEFAULT_CONFIG = { sizeCap: 400, microMaxPrice: 20 };

const money = (n) => Math.round(n * 100) / 100;

// Stable id for a round trip within its day.
export const tripKey = (t) =>
  [t.symbol, t.side, t.entryTime, t.exitTime, t.qty, t.entryPrice].join('|');

// Derived facts for each trip of ONE day (trips sorted however): which entry of
// the day on that ticker it is, the dollar size of the entry it belongs to, and
// whether that size is over the cap (cap applies to sub-$micro prices only).
export const tripFacts = (trips, config = DEFAULT_CONFIG) => {
  const cfg = { ...DEFAULT_CONFIG, ...(config || {}) };
  const entryId = (t) => `${t.symbol}|${t.side}|${t.entryTime}`;
  const sizeByEntry = {};
  trips.forEach((t) => {
    const id = entryId(t);
    sizeByEntry[id] = (sizeByEntry[id] || 0) + t.qty * t.entryPrice * (t.multiplier || 1);
  });
  // Entry order per symbol: carried positions first, then by entry time.
  const bySymbol = {};
  trips.forEach((t) => {
    (bySymbol[t.symbol] = bySymbol[t.symbol] || new Set()).add(`${t.entryTime}`);
  });
  const orderOf = {};
  Object.entries(bySymbol).forEach(([sym, set]) => {
    [...set].sort((a, b) => (a === 'prior' ? -1 : b === 'prior' ? 1 : a.localeCompare(b)))
      .forEach((time, i) => { orderOf[`${sym}|${time}`] = i + 1; });
  });
  const facts = {};
  trips.forEach((t) => {
    const size = sizeByEntry[entryId(t)];
    const capApplies = t.entryPrice < cfg.microMaxPrice;
    facts[tripKey(t)] = {
      tradeNo: orderOf[`${t.symbol}|${t.entryTime}`],
      size: money(size),
      overCap: capApplies && size > cfg.sizeCap,
      capApplies,
    };
  });
  return facts;
};

export const followedAll = (tag, fact) =>
  !!tag && !!tag.play && (tag.broke || []).length === 0 && !(fact && fact.overCap);

const blankBucket = () => ({ n: 0, wins: 0, losses: 0, pnl: 0, grossWin: 0, grossLoss: 0 });
const addTo = (b, pnl) => {
  b.n += 1;
  b.pnl += pnl;
  if (pnl > 0.005) { b.wins += 1; b.grossWin += pnl; }
  else if (pnl < -0.005) { b.losses += 1; b.grossLoss += -pnl; }
};
const finish = (b) => ({
  n: b.n,
  wins: b.wins,
  losses: b.losses,
  pnl: money(b.pnl),
  winRate: b.n ? b.wins / b.n : null,
  avgWin: b.wins ? money(b.grossWin / b.wins) : null,
  avgLoss: b.losses ? money(-b.grossLoss / b.losses) : null,
  expectancy: b.n ? money(b.pnl / b.n) : null,
  profitFactor: b.grossLoss > 0 ? Math.round((b.grossWin / b.grossLoss) * 100) / 100 : (b.grossWin > 0 ? Infinity : null),
});

// ledgerTrips: all round trips (ledger.trips). tagsByDate: { date: { key: Tag } }.
// Only 'day' trips are analysed by default — swings aren't playbook plays.
export const playbookStats = (ledgerTrips, tagsByDate, config = DEFAULT_CONFIG, { from = null, includeSwings = false } = {}) => {
  const byDate = {};
  ledgerTrips.forEach((t) => {
    if (from && t.date < from) return;
    if (!includeSwings && t.kind === 'swing') return;
    (byDate[t.date] = byDate[t.date] || []).push(t);
  });

  const plays = {};
  const rules = {};
  RULES.forEach((r) => { rules[r.id] = { followed: blankBucket(), broke: blankBucket() }; });
  const size = { within: blankBucket(), over: blankBucket() };
  const followed = { yes: blankBucket(), no: blankBucket() };
  const byTradeNo = {};
  const exits = {};
  const overall = blankBucket();
  let tagged = 0;
  let total = 0;

  Object.entries(byDate).forEach(([date, trips]) => {
    const facts = tripFacts(trips, config);
    const tags = (tagsByDate && tagsByDate[date]) || {};
    trips.forEach((t) => {
      const key = tripKey(t);
      const tag = tags[key];
      const fact = facts[key];
      total += 1;
      addTo(overall, t.pnl);

      const tradeNo = Math.min(fact.tradeNo, 4);
      addTo((byTradeNo[tradeNo] = byTradeNo[tradeNo] || blankBucket()), t.pnl);
      if (fact.capApplies) addTo(fact.overCap ? size.over : size.within, t.pnl);

      const playName = tag && tag.play ? tag.play : '(untagged)';
      addTo((plays[playName] = plays[playName] || blankBucket()), t.pnl);
      if (!tag || !tag.play) return;
      tagged += 1;

      addTo(followedAll(tag, fact) ? followed.yes : followed.no, t.pnl);
      RULES.forEach((r) => {
        addTo((tag.broke || []).includes(r.id) ? rules[r.id].broke : rules[r.id].followed, t.pnl);
      });
      if (tag.exit) addTo((exits[tag.exit] = exits[tag.exit] || blankBucket()), t.pnl);
    });
  });

  const fin = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, finish(v)]));
  return {
    overall: finish(overall),
    coverage: { tagged, total },
    plays: fin(plays),
    followed: { yes: finish(followed.yes), no: finish(followed.no) },
    rules: Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, { followed: finish(v.followed), broke: finish(v.broke) }])),
    size: { within: finish(size.within), over: finish(size.over) },
    byTradeNo: fin(byTradeNo),
    exits: fin(exits),
  };
};

// Day-level process stats from journal entries (grade, compulsion, study).
export const dayStats = (entries, { from = null } = {}) => {
  const grades = {};
  let days = 0, resisted = 0, study = 0, studyDays = 0;
  Object.entries(entries || {}).forEach(([date, e]) => {
    if (from && date < from) return;
    if (!e) return;
    const g = e.processGrade;
    const pnl = parseFloat(e.pnl);
    if (g) {
      const b = (grades[g] = grades[g] || { days: 0, pnl: 0, pnlDays: 0 });
      b.days += 1;
      if (!isNaN(pnl)) { b.pnl += pnl; b.pnlDays += 1; }
    }
    if (g || e.compulsionResisted || e.studyMinutes) days += 1;
    resisted += Number(e.compulsionResisted) || 0;
    if (Number(e.studyMinutes) > 0) { study += Number(e.studyMinutes); studyDays += 1; }
  });
  return {
    days,
    resisted,
    studyMinutes: study,
    avgStudy: studyDays ? Math.round(study / studyDays) : 0,
    grades: Object.fromEntries(Object.entries(grades).map(([g, b]) => [g, {
      days: b.days,
      avgPnl: b.pnlDays ? money(b.pnl / b.pnlDays) : null,
    }])),
  };
};
