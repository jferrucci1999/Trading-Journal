// P&L engine for Interactive Brokers .tlg trade logs.
//
// Sign convention in a .tlg: the Proceeds column is the *cost* view of a
// fill — positive for a buy (money out), negative for a sell (money in). It is
// NOT profit and loss. Real P&L comes from pairing buys with sells (FIFO) and
// comparing prices; adding Proceeds up inverts the sign of every result.
//
// Positions held overnight ("swings") are priced from the STOCK_POSITIONS /
// OPTION_POSITIONS section of the previous day's file, which carries the cost
// basis of every open lot. Each realized round trip is tagged:
//   kind 'day'   — opened and closed on the same day
//   kind 'swing' — closed a lot that was already open at the start of the day

const EPS = 1e-6;

export const multiplierOf = (t) => t.multiplier || (t.instrument === 'option' ? 100 : 1);

const num = (s) => {
  const n = parseFloat(String(s == null ? '' : s).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
};

// Pull open-lot snapshots (STK_LOT / OPT_LOT) out of a .tlg file's text.
// Fields: type|acct|symbol|desc|ccy||time|qty|mult|costPrice|costBasis|fx
export const parsePositionLots = (text) => {
  const lots = [];
  const clean = (text || '').replace(/^﻿/, '');
  for (const raw of clean.split(/\r?\n/)) {
    const line = raw.trim();
    const upper = line.toUpperCase();
    const isStk = upper.startsWith('STK_LOT|');
    const isOpt = upper.startsWith('OPT_LOT|');
    if (!isStk && !isOpt) continue;
    const f = line.split('|');
    if (f.length < 10) continue;
    const qty = num(f[7]);
    if (Math.abs(qty) < EPS) continue;
    lots.push({
      symbol: f[2],
      qty,
      multiplier: num(f[8]) || (isOpt ? 100 : 1),
      price: num(f[9]),
      instrument: isOpt ? 'option' : 'stock',
    });
  }
  return lots;
};

const sortFills = (a, b) => {
  const t = (a.time || '').localeCompare(b.time || '');
  if (t !== 0) return t;
  return num(a.id) - num(b.id);
};

// A fill that is purely a close (codes "C", never "C;O") and finds no lot to
// close is the tail of a position whose cost basis we were never given.
const isPureClose = (t) => {
  if (t.codes) {
    const c = String(t.codes).toUpperCase().split(';');
    return c.includes('C') && !c.includes('O');
  }
  return String(t.side || '').toUpperCase().includes('CLOSE');
};

const cloneState = (state) => {
  const out = {};
  Object.entries(state).forEach(([sym, lots]) => {
    out[sym] = lots.map((l) => ({ ...l, carried: true }));
  });
  return out;
};

const lotsFromSnapshot = (snapshotLots) => {
  const out = {};
  (snapshotLots || []).forEach((l) => {
    if (!out[l.symbol]) out[l.symbol] = [];
    out[l.symbol].push({
      qty: l.qty,
      origQty: Math.abs(l.qty),
      price: l.price,
      multiplier: l.multiplier || (l.instrument === 'option' ? 100 : 1),
      instrument: l.instrument,
      fee: 0,
      carried: true,
    });
  });
  return out;
};

// tradesByDate:    { 'YYYY-MM-DD': [fill, ...] }
// positionsByDate: { 'YYYY-MM-DD': { lots: [...] } }  (end-of-day snapshots)
export const buildLedger = (tradesByDate, positionsByDate) => {
  tradesByDate = tradesByDate || {};
  positionsByDate = positionsByDate || {};
  const dateSet = new Set([...Object.keys(tradesByDate), ...Object.keys(positionsByDate)]);
  const dates = [...dateSet].sort();

  const trips = [];
  const unknown = [];
  const byDate = {};
  let state = {}; // symbol -> open lots at the start of the next day

  dates.forEach((date) => {
    const fills = tradesByDate[date] || [];
    const lotsBySymbol = cloneState(state);
    const dayTrips = [];
    const dayUnknown = [];
    const fillCount = {};

    const bySym = {};
    fills.forEach((t) => {
      if (!bySym[t.symbol]) bySym[t.symbol] = [];
      bySym[t.symbol].push(t);
    });

    Object.entries(bySym).forEach(([symbol, symFills]) => {
      if (!lotsBySymbol[symbol]) lotsBySymbol[symbol] = [];
      const queue = lotsBySymbol[symbol];
      fillCount[symbol] = symFills.length;

      [...symFills].sort(sortFills).forEach((t) => {
        const mult = multiplierOf(t);
        const totalQty = Math.abs(t.qty);
        if (totalQty < EPS) return;
        const sign = t.qty > 0 ? 1 : -1;
        const fee = t.commission || 0; // negative number
        let remaining = totalQty;

        while (remaining > EPS && queue.length > 0 && Math.sign(queue[0].qty) !== sign) {
          const lot = queue[0];
          const n = Math.min(remaining, Math.abs(lot.qty));
          const isLongLot = lot.qty > 0;
          const gross = (isLongLot ? t.price - lot.price : lot.price - t.price) * n * mult;
          const fees = (lot.fee || 0) * (n / lot.origQty) + fee * (n / totalQty);
          dayTrips.push({
            date,
            symbol,
            side: isLongLot ? 'long' : 'short',
            kind: lot.carried ? 'swing' : 'day',
            entryTime: lot.carried ? 'prior' : lot.time,
            exitTime: t.time,
            qty: n,
            entryPrice: lot.price,
            exitPrice: t.price,
            multiplier: mult,
            fees,
            pnl: gross + fees,
          });
          lot.qty -= Math.sign(lot.qty) * n;
          remaining -= n;
          if (Math.abs(lot.qty) < EPS) queue.shift();
        }

        if (remaining > EPS) {
          if (queue.length === 0 && isPureClose(t)) {
            // Closing a position we have no cost basis for (opened before the
            // earliest imported file). Report it, but keep it out of the P&L.
            dayUnknown.push({
              date, symbol, qty: remaining * sign, price: t.price, time: t.time, multiplier: mult,
            });
          } else {
            queue.push({
              qty: remaining * sign,
              origQty: remaining,
              price: t.price,
              multiplier: mult,
              instrument: t.instrument,
              time: t.time,
              fee: fee * (remaining / totalQty),
              carried: false,
            });
          }
        }
      });
    });

    // The broker's end-of-day lots are authoritative when we have them.
    const snap = positionsByDate[date];
    let endState;
    if (snap && Array.isArray(snap.lots)) {
      endState = lotsFromSnapshot(snap.lots);
    } else {
      endState = {};
      Object.entries(lotsBySymbol).forEach(([sym, lots]) => {
        if (lots.length > 0) endState[sym] = lots.map((l) => ({ ...l }));
      });
    }

    // Per-symbol summary for the day.
    const symbols = {};
    Object.keys(fillCount).forEach((sym) => {
      const st = (endState[sym] || []).reduce((s, l) => s + l.qty, 0);
      symbols[sym] = { pnl: 0, dayPnl: 0, swingPnl: 0, fills: fillCount[sym], openQty: st, unknown: 0 };
    });
    dayTrips.forEach((tr) => {
      const s = symbols[tr.symbol];
      s.pnl += tr.pnl;
      if (tr.kind === 'swing') s.swingPnl += tr.pnl; else s.dayPnl += tr.pnl;
    });
    dayUnknown.forEach((u) => { if (symbols[u.symbol]) symbols[u.symbol].unknown += Math.abs(u.qty); });

    const day = dayTrips.filter((t) => t.kind === 'day').reduce((s, t) => s + t.pnl, 0);
    const swing = dayTrips.filter((t) => t.kind === 'swing').reduce((s, t) => s + t.pnl, 0);
    byDate[date] = {
      day,
      swing,
      total: day + swing,
      trips: dayTrips.sort((a, b) => a.exitTime.localeCompare(b.exitTime)),
      unknown: dayUnknown,
      symbols,
      hasTrades: fills.length > 0,
    };

    trips.push(...dayTrips);
    unknown.push(...dayUnknown);
    state = endState;
  });

  trips.sort((a, b) => (a.date + a.exitTime).localeCompare(b.date + b.exitTime));
  return { trips, unknown, byDate, openLots: state };
};

// What the old importer wrote into a day's P&L: it added up the raw Proceeds
// column (buys positive, sells negative — i.e. inverted) plus commissions, for
// symbols whose quantity netted to zero. Used to recognize and replace those
// auto-filled values without touching anything typed in by hand.
export const legacyDayPnl = (dayTrades) => {
  const bySymbol = {};
  (dayTrades || []).forEach((t) => {
    if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { qty: 0, pnl: 0 };
    bySymbol[t.symbol].qty += t.qty;
    bySymbol[t.symbol].pnl += (t.proceeds || 0) + (t.commission || 0);
  });
  let realized = 0;
  Object.values(bySymbol).forEach((d) => {
    if (Math.abs(d.qty) < 0.01) realized += d.pnl;
  });
  return realized;
};
