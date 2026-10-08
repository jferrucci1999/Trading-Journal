import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLedger, parsePositionLots, legacyDayPnl } from './pnl.js';

const fill = (id, symbol, time, qty, price, codes, commission = 0) => ({
  id: String(id), symbol, time, qty, price, codes, commission, instrument: 'stock',
  side: qty > 0 ? (codes.includes('O') ? 'BUYTOOPEN' : 'BUYTOCLOSE') : (codes.includes('O') ? 'SELLTOOPEN' : 'SELLTOCLOSE'),
  // The .tlg Proceeds column: positive for buys, negative for sells.
  proceeds: qty * price,
});

test('a losing round trip is a loss (Proceeds column is not P&L)', () => {
  const trades = { '2026-10-06': [fill(1, 'AIFA', '10:09:55', 80, 8.34, 'O'), fill(2, 'AIFA', '10:10:13', -80, 8.14, 'C')] };
  const L = buildLedger(trades, {});
  assert.ok(Math.abs(L.byDate['2026-10-06'].total - -16) < 1e-9);
  // what the old importer wrote: the raw sum of Proceeds, i.e. the opposite sign
  assert.ok(Math.abs(legacyDayPnl(trades['2026-10-06']) - 16) < 1e-9);
});

test('closing a carried position is a swing, priced from the prior day snapshot', () => {
  const trades = {
    '2026-10-05': [fill(1, 'XYZ', '09:40:00', 100, 10, 'O'), fill(2, 'XYZ', '09:50:00', -100, 9, 'C')],
    '2026-10-06': [fill(3, 'SPCX', '10:15:45', -20, 175, 'C')],
  };
  const positions = {
    '2026-10-05': { lots: [{ symbol: 'SPCX', qty: 20, price: 150, multiplier: 1, instrument: 'stock' }] },
  };
  const L = buildLedger(trades, positions);
  assert.ok(Math.abs(L.byDate['2026-10-05'].day - -100) < 1e-9);
  assert.equal(L.byDate['2026-10-06'].swing, 500);
  assert.equal(L.byDate['2026-10-06'].day, 0);
  assert.equal(L.byDate['2026-10-06'].trips[0].kind, 'swing');
  assert.equal(L.unknown.length, 0);
});

test('a short carried overnight is priced correctly when covered', () => {
  const trades = { '2026-10-06': [fill(1, 'BWET', '09:30:58', 1, 900, 'C')] };
  const positions = { '2026-10-05': { lots: [{ symbol: 'BWET', qty: -2, price: 700, multiplier: 1, instrument: 'stock' }] } };
  const L = buildLedger(trades, positions);
  assert.equal(L.byDate['2026-10-06'].swing, -200);
});

test('a close with no known cost basis is reported, not silently counted', () => {
  const trades = { '2026-10-02': [fill(1, 'NFXL', '12:00:12', -25, 12.765, 'C')] };
  const L = buildLedger(trades, {});
  assert.equal(L.byDate['2026-10-02'].total, 0);
  assert.equal(L.unknown.length, 1);
  assert.equal(L.unknown[0].symbol, 'NFXL');
});

test('a fill that closes and flips (codes C;O) opens a new position, not an unknown close', () => {
  const trades = {
    '2026-10-06': [
      fill(1, 'NVDL', '16:53:08', 1, 40.31, 'O'),
      fill(2, 'NVDL', '16:54:02', -100, 40.264058, 'C;O'),
      fill(3, 'NVDL', '16:56:14', 100, 40.30, 'C;O'),
      fill(4, 'NVDL', '16:56:39', -1, 40.28, 'C'),
    ],
  };
  const L = buildLedger(trades, {});
  assert.equal(L.unknown.length, 0);
  assert.equal(L.byDate['2026-10-06'].symbols.NVDL.openQty, 0);
});

test('parsePositionLots reads stock and option lots', () => {
  const text = [
    'STK_LOT|U1|BBY|BEST BUY CO INC|USD||00:00:00|15.00|1.00|94.228403|1413.426045|1.00',
    'OPT_LOT|U1|HOOD  270115C00170000|HOOD 15JAN27 170 C|USD||00:00:00|-3.00|100.00|17.901921|-5370.57623|1.00',
  ].join('\n');
  const lots = parsePositionLots(text);
  assert.equal(lots.length, 2);
  assert.deepEqual([lots[0].symbol, lots[0].qty, lots[0].price], ['BBY', 15, 94.228403]);
  assert.deepEqual([lots[1].instrument, lots[1].multiplier, lots[1].qty], ['option', 100, -3]);
});
