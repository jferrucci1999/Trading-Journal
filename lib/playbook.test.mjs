import test from 'node:test';
import assert from 'node:assert/strict';
import { tripKey, tripFacts, playbookStats, dayStats, followedAll } from './playbook.js';

const trip = (symbol, entryTime, exitTime, qty, entryPrice, exitPrice, date = '2026-10-08', kind = 'day') => ({
  date, symbol, side: 'long', kind, entryTime, exitTime, qty, entryPrice, exitPrice, multiplier: 1,
  pnl: (exitPrice - entryPrice) * qty,
});

test('trade number counts distinct entries per ticker; partial exits share one entry', () => {
  const trips = [
    trip('PROF', '10:22:00', '10:24:00', 500, 6.7, 6.65),
    trip('PROF', '10:22:00', '10:24:30', 500, 6.7, 6.62), // second exit of the same 1000-share entry
    trip('PROF', '10:25:00', '10:26:00', 500, 6.78, 6.7),
    trip('JZ', '09:48:00', '09:49:00', 1000, 0.895, 0.8229),
  ];
  const f = tripFacts(trips);
  assert.equal(f[tripKey(trips[0])].tradeNo, 1);
  assert.equal(f[tripKey(trips[1])].tradeNo, 1);
  assert.equal(f[tripKey(trips[2])].tradeNo, 2);
  assert.equal(f[tripKey(trips[3])].tradeNo, 1);
  // two exits of one entry add up to the full entry size
  assert.equal(f[tripKey(trips[0])].size, 6700);
});

test('size cap only applies to micro-priced entries', () => {
  const trips = [
    trip('JZ', '11:39:00', '11:41:00', 400, 1.009, 0.9366), // $403.6 > 400
    trip('JZ2', '11:50:00', '11:51:00', 300, 1.0, 1.01),    // $300 within cap
    trip('SOXL', '14:17:00', '14:25:00', 50, 143.54, 143.6), // $7k but price over micro threshold
  ];
  const f = tripFacts(trips, { sizeCap: 400, microMaxPrice: 20 });
  assert.equal(f[tripKey(trips[0])].overCap, true);
  assert.equal(f[tripKey(trips[1])].overCap, false);
  assert.equal(f[tripKey(trips[2])].capApplies, false);
  assert.equal(f[tripKey(trips[2])].overCap, false);
});

test('stats split by play, rule followed, rule broken, and trade number', () => {
  const t1 = trip('AAA', '09:40:00', '09:41:00', 100, 2, 2.5); // +50
  const t2 = trip('AAA', '09:45:00', '09:46:00', 100, 2, 1.8); // -20
  const t3 = trip('BBB', '09:50:00', '09:51:00', 100, 2, 2.1); // +10, untagged
  const tags = { '2026-10-08': {
    [tripKey(t1)]: { play: 'Micro momentum', broke: [], exit: 'trail' },
    [tripKey(t2)]: { play: 'Micro momentum', broke: ['chase'], exit: 'stop' },
  } };
  const s = playbookStats([t1, t2, t3], tags, { sizeCap: 400, microMaxPrice: 20 });
  assert.deepEqual(s.coverage, { tagged: 2, total: 3 });
  assert.equal(s.plays['Micro momentum'].n, 2);
  assert.equal(s.plays['Micro momentum'].pnl, 30);
  assert.equal(s.plays['(untagged)'].n, 1);
  assert.equal(s.followed.yes.pnl, 50);
  assert.equal(s.followed.no.pnl, -20);
  assert.equal(s.rules.chase.broke.pnl, -20);
  assert.equal(s.rules.chase.followed.pnl, 50);
  assert.equal(s.byTradeNo[1].n, 2); // AAA#1 and BBB#1
  assert.equal(s.byTradeNo[2].pnl, -20);
  assert.equal(s.exits.stop.n, 1);
  assert.equal(s.plays['Micro momentum'].winRate, 0.5);
});

test('swings are excluded unless asked for; date filter works', () => {
  const swing = trip('SPCX', 'prior', '10:15:45', 20, 150, 175, '2026-10-06', 'swing');
  const old = trip('OLD', '09:40:00', '09:41:00', 10, 1, 2, '2026-09-01');
  const s = playbookStats([swing, old], {}, undefined, { from: '2026-10-01' });
  assert.equal(s.coverage.total, 0);
  assert.equal(playbookStats([swing], {}, undefined, { includeSwings: true }).coverage.total, 1);
});

test('followedAll needs a play, no broken rules, and size within cap', () => {
  assert.equal(followedAll({ play: 'X', broke: [] }, { overCap: false }), true);
  assert.equal(followedAll({ play: 'X', broke: [] }, { overCap: true }), false);
  assert.equal(followedAll({ play: '', broke: [] }, { overCap: false }), false);
  assert.equal(followedAll(undefined, { overCap: false }), false);
});

test('day stats: grade vs P&L, resisted compulsions, study time; old entries tolerated', () => {
  const entries = {
    '2026-10-06': { pnl: '-50', processGrade: 'B', compulsionResisted: 2, studyMinutes: 30 },
    '2026-10-07': { pnl: '120', processGrade: 'A', compulsionResisted: 1, studyMinutes: 0 },
    '2026-10-08': { pnl: '-102', processGrade: 'B', compulsionResisted: 3, studyMinutes: 60 },
    '2026-09-01': { pnl: '10' }, // an old entry with none of the new fields
  };
  const d = dayStats(entries);
  assert.equal(d.days, 3);
  assert.equal(d.resisted, 6);
  assert.equal(d.studyMinutes, 90);
  assert.equal(d.avgStudy, 45);
  assert.equal(d.grades.B.days, 2);
  assert.equal(d.grades.B.avgPnl, -76);
  assert.equal(d.grades.A.avgPnl, 120);
});
