import React, { useState, useEffect } from 'react';
import { Moon, Zap, Target, Smile, AlertCircle, Coffee, BookOpen, Calendar, TrendingUp, Save, ChevronLeft, ChevronRight, Trash2, Sparkles, Upload, X, BarChart3, AlertTriangle, Lightbulb, FileText, ArrowDownToLine, Activity } from 'lucide-react';

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const formatDate = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};

const formatShortDate = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const METRICS = [
  { id: 'sleep', label: 'Sleep Quality', sub: 'How well did you sleep last night?', icon: Moon, color: '#60a5fa' },
  { id: 'energy', label: 'Energy', sub: 'How energized do you feel?', icon: Zap, color: '#eab308' },
  { id: 'focus', label: 'Focus', sub: 'How clear is your mind?', icon: Target, color: '#06b6d4' },
  { id: 'mood', label: 'Mood', sub: "What's your emotional state?", icon: Smile, color: '#10b981' },
  { id: 'stress', label: 'Stress', sub: 'How stressed are you? (lower is better)', icon: AlertCircle, color: '#ef4444' },
  { id: 'caffeine', label: 'Caffeine', sub: 'How many cups today?', icon: Coffee, color: '#a16207', max: 10, default: 0 },
];

const TAGS = ['Broke Rules', 'FOMO Entry', 'Revenge Trading', 'Overtrading', 'Ignored Stop Loss', 'Moved Stop Loss', 'Position Too Large', 'Exited Too Early', 'Exited Too Late', 'Chased Entry', 'No Trading Plan', 'Emotional Decision', 'Poor Risk/Reward', 'Wrong Timeframe', 'No Man\'s Land'];

const MOODS = [
  { id: 'solid', label: 'Solid', emoji: '☀️' },
  { id: 'mixed', label: 'Mixed', emoji: '⛅' },
  { id: 'tough', label: 'Tough', emoji: '🌧️' },
];

// FIFO round-trip pairing for a single day's trades
const buildRoundTripsForDay = (dayTrades) => {
  const trips = [];
  const bySymbol = {};
  dayTrades.forEach(t => {
    if (!bySymbol[t.symbol]) bySymbol[t.symbol] = [];
    bySymbol[t.symbol].push(t);
  });
  Object.entries(bySymbol).forEach(([symbol, trades]) => {
    const sorted = [...trades].sort((a, b) => a.time.localeCompare(b.time));
    const longQueue = [];
    const shortQueue = [];
    sorted.forEach(t => {
      let qty = Math.abs(t.qty);
      const isBuy = t.qty > 0;
      const price = t.price;
      const time = t.time;
      const commPerShare = qty > 0 ? t.commission / qty : 0;
      if (isBuy) {
        while (qty > 0 && shortQueue.length > 0) {
          const s = shortQueue[0];
          const closeQty = Math.min(qty, s.qty);
          const pnl = (s.price - price) * closeQty + (s.commission * (closeQty / s.origQty)) + commPerShare * closeQty;
          trips.push({ symbol, side: 'short', entryTime: s.time, exitTime: time, qty: closeQty, entryPrice: s.price, exitPrice: price, pnl });
          s.qty -= closeQty;
          qty -= closeQty;
          if (s.qty <= 0.0001) shortQueue.shift();
        }
        if (qty > 0) longQueue.push({ qty, origQty: qty, price, time, commission: commPerShare * qty });
      } else {
        while (qty > 0 && longQueue.length > 0) {
          const l = longQueue[0];
          const closeQty = Math.min(qty, l.qty);
          const pnl = (price - l.price) * closeQty + (l.commission * (closeQty / l.origQty)) + commPerShare * closeQty;
          trips.push({ symbol, side: 'long', entryTime: l.time, exitTime: time, qty: closeQty, entryPrice: l.price, exitPrice: price, pnl });
          l.qty -= closeQty;
          qty -= closeQty;
          if (l.qty <= 0.0001) longQueue.shift();
        }
        if (qty > 0) shortQueue.push({ qty, origQty: qty, price, time, commission: commPerShare * qty });
      }
    });
  });
  return trips.sort((a, b) => a.exitTime.localeCompare(b.exitTime));
};

const fmtHoldDuration = (entryT, exitT) => {
  const t2s = (t) => {
    const [h, m, s] = t.split(':').map(Number);
    return h * 3600 + m * 60 + (s || 0);
  };
  const sec = Math.max(0, t2s(exitT) - t2s(entryT));
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
};

export default function TradingJournal() {
  const [view, setView] = useState('checkin');
  const [currentDate, setCurrentDate] = useState(todayKey());
  const [weeklyRecap, setWeeklyRecap] = useState('');
  const [monthlyRecap, setMonthlyRecap] = useState('');
  const [recapWeekStart, setRecapWeekStart] = useState(() => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay());
    return start;
  });
  const [recapMonth, setRecapMonth] = useState(() => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [entry, setEntry] = useState(null);
  const [allEntries, setAllEntries] = useState({});
  const [allTrades, setAllTrades] = useState({}); // keyed by date
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [importStatus, setImportStatus] = useState(null);
  const [earningsDate, setEarningsDate] = useState(todayKey());
  const [earningsData, setEarningsData] = useState(null);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [earningsError, setEarningsError] = useState(null);
  const [finnhubKey, setFinnhubKey] = useState('');
  const [earningsSort, setEarningsSort] = useState({ column: null, dir: 'desc' });

  const handleEarningsFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setEarningsLoading(true);
    setEarningsError(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      if (!data.date || !data.bmo || !data.amc || !data.other) {
        throw new Error('Invalid earnings file format. Expected: { date, bmo, amc, other }');
      }
      
      if (data.date !== earningsDate) {
        setEarningsDate(data.date);
      }
      
      setEarningsData(data);
      setEarningsError(null);
    } catch (err) {
      setEarningsError(`Failed to load file: ${err.message}`);
      setEarningsData(null);
    } finally {
      setEarningsLoading(false);
    }
  };

  const blankEntry = () => ({
    metrics: { sleep: 5, energy: 5, focus: 5, mood: 5, stress: 5, caffeine: 0, meditation: false },
    intention: '',
    preMarketNotes: '',
    pnl: '',
    fees: '',
    moodTag: '',
    reflection: '',
    workOn: [],
    bestDecision: '',
    screenshots: [],
    savedAt: null,
  });

  useEffect(() => {
    const load = async () => {
      try {
        const list = await window.storage.list('entry:');
        if (list && list.keys) {
          const entries = {};
          for (const key of list.keys) {
            try {
              const r = await window.storage.get(key);
              if (r) entries[key.replace('entry:', '')] = JSON.parse(r.value);
            } catch (e) {}
          }
          setAllEntries(entries);
          if (entries[currentDate]) {
            setEntry(entries[currentDate]);
          } else {
            setEntry(blankEntry());
          }
        } else {
          setEntry(blankEntry());
        }

        // Load trades
        const tradeList = await window.storage.list('trades:');
        if (tradeList && tradeList.keys) {
          const trades = {};
          for (const key of tradeList.keys) {
            try {
              const r = await window.storage.get(key);
              if (r) trades[key.replace('trades:', '')] = JSON.parse(r.value);
            } catch (e) {}
          }
          setAllTrades(trades);
        }

        // Load Finnhub API key
        try {
          const k = await window.storage.get('config:finnhub_key');
          if (k && k.value) setFinnhubKey(k.value);
        } catch (e) {}
      } catch (e) {
        setEntry(blankEntry());
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (view === 'recaps') {
      const loadRecaps = async () => {
        try {
          const weekKey = `recap-week-${recapWeekStart.getFullYear()}-${recapWeekStart.getMonth()}-${recapWeekStart.getDate()}`;
          const monthKey = `recap-month-${recapMonth.getFullYear()}-${recapMonth.getMonth()}`;
          const weekly = await window.storage?.get(weekKey);
          const monthly = await window.storage?.get(monthKey);
          if (weekly) setWeeklyRecap(weekly.value);
          else setWeeklyRecap('');
          if (monthly) setMonthlyRecap(monthly.value);
          else setMonthlyRecap('');
        } catch (e) {
          console.error('Error loading recaps:', e);
        }
      };
      loadRecaps();
    }
  }, [view, recapWeekStart, recapMonth]);

  useEffect(() => {
    if (loading) return;
    if (allEntries[currentDate]) {
      setEntry(allEntries[currentDate]);
    } else {
      setEntry(blankEntry());
    }
  }, [currentDate]);

  const handleScreenshotUpload = (e) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      if (!file.type.startsWith('image/')) return;
      if (file.size > 2 * 1024 * 1024) {
        alert(`${file.name} is too large. Max 2MB per image.`);
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        setEntry(prev => ({ ...prev, screenshots: [...(prev.screenshots || []), { id: Date.now() + Math.random(), data: ev.target.result, name: file.name }] }));
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removeScreenshot = (id) => {
    setEntry(prev => ({ ...prev, screenshots: (prev.screenshots || []).filter(s => s.id !== id) }));
  };

  // Parse Interactive Brokers .tlg file (pipe-delimited trade log)
  const parseTlg = (text) => {
    const lines = text.split(/\r?\n/);
    const trades = [];
    for (const line of lines) {
      if (!line.startsWith('STK_TRD|') && !line.startsWith('OPT_TRD|')) continue;
      const f = line.split('|');
      // STK_TRD|TradeID|Symbol|Description|Exchange|Side|Codes|YYYYMMDD|HH:MM:SS|Currency|Quantity|Multiplier|Price|Proceeds|Commission|FXRate
      if (f.length < 16) continue;
      const dateRaw = f[7];
      if (!/^\d{8}$/.test(dateRaw)) continue;
      const dateKey = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
      trades.push({
        id: f[1],
        symbol: f[2],
        description: f[3],
        exchange: f[4],
        side: f[5],
        date: dateKey,
        time: f[8],
        currency: f[9],
        qty: parseFloat(f[10]) || 0,
        price: parseFloat(f[12]) || 0,
        proceeds: parseFloat(f[13]) || 0,
        commission: parseFloat(f[14]) || 0,
        instrument: line.startsWith('OPT_TRD') ? 'option' : 'stock',
      });
    }
    return trades;
  };

  // Compute realized P&L by symbol for a given trade list (only fully closed positions)
  const computeRealizedPnl = (trades) => {
    const bySymbol = {};
    trades.forEach(t => {
      if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { qty: 0, pnl: 0, trades: [] };
      bySymbol[t.symbol].qty += t.qty;
      bySymbol[t.symbol].pnl += t.proceeds + t.commission;
      bySymbol[t.symbol].trades.push(t);
    });
    let realized = 0;
    let unrealized = 0;
    const symbolPnl = {};
    Object.entries(bySymbol).forEach(([sym, data]) => {
      // Round to 2 decimals to handle float drift
      if (Math.abs(data.qty) < 0.01) {
        realized += data.pnl;
        symbolPnl[sym] = { pnl: data.pnl, status: 'closed', trades: data.trades.length };
      } else {
        unrealized += data.pnl;
        symbolPnl[sym] = { pnl: data.pnl, status: 'open', qty: data.qty, trades: data.trades.length };
      }
    });
    return { realized, unrealized, symbolPnl, bySymbol };
  };

  const handleTlgImport = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length === 0) return;

    setImportStatus({ type: 'loading', msg: `Importing ${files.length} file${files.length > 1 ? 's' : ''}…` });

    try {
      const allParsed = [];
      for (const file of files) {
        const text = await file.text();
        const trades = parseTlg(text);
        allParsed.push(...trades);
      }

      if (allParsed.length === 0) {
        setImportStatus({ type: 'error', msg: 'No trades found. Is this an Interactive Brokers .tlg file?' });
        setTimeout(() => setImportStatus(null), 4000);
        return;
      }

      // Group by date
      const byDate = {};
      allParsed.forEach(t => {
        if (!byDate[t.date]) byDate[t.date] = [];
        byDate[t.date].push(t);
      });

      // Merge with existing trades, dedupe by trade id
      const updatedTrades = { ...allTrades };
      let newCount = 0;
      for (const [date, newTrades] of Object.entries(byDate)) {
        const existing = updatedTrades[date] || [];
        const existingIds = new Set(existing.map(t => t.id));
        const fresh = newTrades.filter(t => !existingIds.has(t.id));
        newCount += fresh.length;
        updatedTrades[date] = [...existing, ...fresh].sort((a, b) => a.time.localeCompare(b.time));
      }

      // Save trades to storage
      for (const date of Object.keys(byDate)) {
        await window.storage.set(`trades:${date}`, JSON.stringify(updatedTrades[date]));
      }
      setAllTrades(updatedTrades);

      // Auto-fill journal P&L for each affected date
      const updatedEntries = { ...allEntries };
      for (const date of Object.keys(byDate)) {
        const dayTrades = updatedTrades[date];
        const { realized } = computeRealizedPnl(dayTrades);
        const dayEntry = updatedEntries[date] || blankEntry();
        // Only overwrite if pnl is empty (don't clobber manual entries)
        if (dayEntry.pnl === '' || dayEntry.pnl == null) {
          dayEntry.pnl = realized.toFixed(2);
          dayEntry.savedAt = new Date().toISOString();
          updatedEntries[date] = dayEntry;
          await window.storage.set(`entry:${date}`, JSON.stringify(dayEntry));
        }
      }
      setAllEntries(updatedEntries);
      if (updatedEntries[currentDate]) setEntry(updatedEntries[currentDate]);

      setImportStatus({
        type: 'success',
        msg: `Imported ${newCount} new trade${newCount === 1 ? '' : 's'} across ${Object.keys(byDate).length} ${Object.keys(byDate).length === 1 ? 'day' : 'days'}.`,
      });
      setTimeout(() => setImportStatus(null), 5000);
    } catch (err) {
      setImportStatus({ type: 'error', msg: 'Import failed: ' + err.message });
      setTimeout(() => setImportStatus(null), 4000);
    }
  };

  const saveEntry = async () => {
    if (!entry) return;
    setSaving(true);
    const toSave = { ...entry, savedAt: new Date().toISOString() };
    try {
      await window.storage.set(`entry:${currentDate}`, JSON.stringify(toSave));
      setAllEntries({ ...allEntries, [currentDate]: toSave });
      setEntry(toSave);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
    } catch (e) {
      alert('Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async (dateKey) => {
    if (!confirm(`Delete entry for ${formatShortDate(dateKey)}?`)) return;
    try {
      await window.storage.delete(`entry:${dateKey}`);
      const next = { ...allEntries };
      delete next[dateKey];
      setAllEntries(next);
      if (dateKey === currentDate) setEntry(blankEntry());
    } catch (e) {}
  };

  const updateMetric = (id, val) => {
    setEntry({ ...entry, metrics: { ...entry.metrics, [id]: val } });
  };

  const toggleTag = (tag) => {
    const has = entry.workOn.includes(tag);
    setEntry({ ...entry, workOn: has ? entry.workOn.filter(t => t !== tag) : [...entry.workOn, tag] });
  };

  const readiness = () => {
    if (!entry) return 0;
    const { sleep, energy, focus, mood, stress } = entry.metrics;
    const inverted_stress = 11 - stress;
    return Math.round((sleep + energy + focus + mood + inverted_stress) / 5);
  };

  const readinessColor = (score) => {
    if (score >= 6) return '#10b981';
    if (score >= 5) return '#6ee7b7';
    if (score >= 3) return '#f97316';
    return '#ef4444';
  };

  const readinessLabel = (score) => {
    if (score >= 7) return 'Ready to trade';
    if (score >= 5) return 'Trade with caution';
    if (score >= 3) return 'Consider reducing position sizes';
    return "Don't trade today";
  };

  const shiftDate = (days) => {
    const [y, m, d] = currentDate.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    setCurrentDate(next);
  };

  if (loading || !entry) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0b0f', color: '#a1a1aa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Georgia, serif' }}>
        <div>Loading your journal…</div>
      </div>
    );
  }

  const score = readiness();
  const isToday = currentDate === todayKey();
  const sortedDates = Object.keys(allEntries).sort().reverse();

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(ellipse at top, #0f1e3d 0%, #060a14 60%)', color: '#e4e4e7', fontFamily: '"Inter", -apple-system, sans-serif' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Grotesk:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap');
        body { margin: 0; }
        * { box-sizing: border-box; }
        .display-font { font-family: 'Instrument Serif', Georgia, serif; }
        .number-font { font-family: 'Space Grotesk', -apple-system, sans-serif; font-feature-settings: 'tnum'; letter-spacing: -0.02em; }
        .body-font { font-family: 'Inter', -apple-system, sans-serif; }
        .slider {
          -webkit-appearance: none; appearance: none;
          width: 100%; height: 4px; border-radius: 2px;
          background: rgba(255,255,255,0.08);
          outline: none;
        }
        .slider::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 18px; height: 18px; border-radius: 50%;
          background: #fff; cursor: pointer;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4);
          transition: transform 0.15s;
        }
        .slider::-webkit-slider-thumb:hover { transform: scale(1.15); }
        .slider::-moz-range-thumb {
          width: 18px; height: 18px; border-radius: 50%;
          background: #fff; cursor: pointer; border: none;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        }
        textarea, input {
          font-family: inherit;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          color: #e4e4e7;
          border-radius: 8px;
          padding: 12px 14px;
          width: 100%;
          outline: none;
          transition: border-color 0.15s, background 0.15s;
        }
        textarea:focus, input:focus {
          border-color: rgba(59, 130, 246, 0.5);
          background: rgba(255,255,255,0.05);
        }
        textarea { resize: vertical; min-height: 80px; }
        .tag {
          display: inline-block;
          padding: 6px 12px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.1);
          background: rgba(255,255,255,0.02);
          color: #a1a1aa;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.15s;
          user-select: none;
        }
        .tag:hover { border-color: rgba(255,255,255,0.2); color: #e4e4e7; }
        .tag.active {
          background: rgba(239, 68, 68, 0.15);
          border-color: rgba(239, 68, 68, 0.5);
          color: #fca5a5;
        }
        .nav-btn {
          background: transparent;
          border: 1px solid rgba(255,255,255,0.08);
          color: #a1a1aa;
          padding: 8px 16px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-family: inherit;
          transition: all 0.15s;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .nav-btn:hover { border-color: rgba(255,255,255,0.2); color: #e4e4e7; }
        .nav-btn.active {
          background: rgba(59, 130, 246, 0.15);
          border-color: rgba(59, 130, 246, 0.4);
          color: #93c5fd;
        }
        .side-btn {
          background: transparent;
          border: none;
          color: #a1a1aa;
          padding: 10px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-family: inherit;
          font-weight: 500;
          transition: all 0.15s;
          display: flex;
          align-items: center;
          gap: 12px;
          text-align: left;
          width: 100%;
        }
        .side-btn:hover {
          background: rgba(255,255,255,0.04);
          color: #e4e4e7;
        }
        .side-btn.active {
          background: rgba(59, 130, 246, 0.12);
          color: #93c5fd;
          box-shadow: inset 2px 0 0 #3b82f6;
        }
        .save-btn {
          background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
          color: #fff;
          border: none;
          padding: 12px 28px;
          border-radius: 10px;
          font-family: inherit;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          box-shadow: 0 4px 14px rgba(59, 130, 246, 0.3);
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .save-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4); }
        .save-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .mood-btn {
          flex: 1;
          padding: 16px;
          border-radius: 12px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          color: #a1a1aa;
          cursor: pointer;
          transition: all 0.15s;
          font-family: inherit;
          font-size: 14px;
        }
        .mood-btn:hover { border-color: rgba(255,255,255,0.18); }
        .mood-btn.active {
          background: rgba(16, 185, 129, 0.1);
          border-color: rgba(16, 185, 129, 0.4);
          color: #6ee7b7;
        }
        .card {
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.06);
          border-radius: 16px;
          padding: 24px;
          backdrop-filter: blur(10px);
        }
        .grain {
          display: none;
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        .fade-in { animation: fadeIn 0.4s ease-out; }
      `}</style>

      <div style={{ position: 'relative', display: 'flex', minHeight: '100vh' }}>
        {/* Sidebar */}
        <aside style={{
          width: 240,
          flexShrink: 0,
          borderRight: '1px solid rgba(255,255,255,0.06)',
          padding: '32px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          position: 'sticky',
          top: 0,
          height: '100vh',
          background: 'rgba(0,0,0,0.2)',
          backdropFilter: 'blur(10px)',
        }}>
          <div style={{ padding: '0 12px 28px' }}>
            <div className="number-font" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: 6, background: 'linear-gradient(135deg, #3b82f6, #2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <TrendingUp size={14} color="#fff" />
              </div>
              Trading Journal
            </div>
          </div>

          <button className={`side-btn ${view === 'checkin' ? 'active' : ''}`} onClick={() => setView('checkin')}>
            <Sparkles size={16} /> Morning Check-in
          </button>
          <button className={`side-btn ${view === 'journal' ? 'active' : ''}`} onClick={() => setView('journal')}>
            <BookOpen size={16} /> Journal Entry
          </button>
          <button className={`side-btn ${view === 'calendar' ? 'active' : ''}`} onClick={() => setView('calendar')}>
            <Calendar size={16} /> Calendar
          </button>
          <button className={`side-btn ${view === 'analytics' ? 'active' : ''}`} onClick={() => setView('analytics')}>
            <BarChart3 size={16} /> Analytics
          </button>
          <button className={`side-btn ${view === 'trades' ? 'active' : ''}`} onClick={() => setView('trades')}>
            <Activity size={16} /> Trade Log
            {Object.keys(allTrades).length > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: 11, background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 999, color: '#a1a1aa' }}>
                {Object.values(allTrades).reduce((s, t) => s + t.length, 0)}
              </span>
            )}
          </button>
          <button className={`side-btn ${view === 'earnings' ? 'active' : ''}`} onClick={() => setView('earnings')}>
            <Lightbulb size={16} /> Earnings
          </button>
          <button className={`side-btn ${view === 'economic' ? 'active' : ''}`} onClick={() => setView('economic')}>
            <Activity size={16} /> Economic
          </button>
          <button className={`side-btn ${view === 'recaps' ? 'active' : ''}`} onClick={() => setView('recaps')}>
            <BarChart3 size={16} /> Recaps
          </button>

          <div style={{ marginTop: 16, padding: '0 4px' }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, background: 'linear-gradient(135deg, #3b82f6, #2563eb)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, boxShadow: '0 2px 8px rgba(59, 130, 246, 0.25)' }}>
              <ArrowDownToLine size={14} /> Import .tlg
              <input type="file" accept=".tlg,.txt" multiple onChange={handleTlgImport} style={{ display: 'none' }} />
            </label>
            {importStatus && (
              <div style={{
                marginTop: 8, padding: '8px 12px', borderRadius: 6, fontSize: 11, lineHeight: 1.4,
                background: importStatus.type === 'error' ? 'rgba(239,68,68,0.1)' : importStatus.type === 'success' ? 'rgba(16,185,129,0.1)' : 'rgba(255,255,255,0.04)',
                color: importStatus.type === 'error' ? '#fca5a5' : importStatus.type === 'success' ? '#6ee7b7' : '#a1a1aa',
                border: `1px solid ${importStatus.type === 'error' ? 'rgba(239,68,68,0.2)' : importStatus.type === 'success' ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)'}`,
              }}>
                {importStatus.msg}
              </div>
            )}
          </div>

          <div style={{ marginTop: 'auto', padding: '0 12px', fontSize: 11, color: '#52525b', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 16 }}>
            {entry.savedAt ? `Last saved ${new Date(entry.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Unsaved'}
          </div>
        </aside>

        {/* Main content */}
        <main style={{ flex: 1, minWidth: 0, padding: '40px 36px 80px', maxWidth: 1100 }}>
        {/* Header */}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 36, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#71717a', marginBottom: 6 }}>Trading Journal</div>
            <h1 className="number-font" style={{ fontSize: 44, fontWeight: 600, margin: 0, letterSpacing: '-0.03em' }}>
              {isToday ? 'Today' : formatShortDate(currentDate)}
            </h1>
            <div style={{ fontSize: 14, color: '#71717a', marginTop: 4 }}>{formatDate(currentDate)}</div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="nav-btn" onClick={() => shiftDate(-1)}><ChevronLeft size={16} /></button>
            <button className="nav-btn" onClick={() => setCurrentDate(todayKey())} disabled={isToday} style={{ opacity: isToday ? 0.5 : 1 }}>Today</button>
            <button className="nav-btn" onClick={() => shiftDate(1)} disabled={isToday} style={{ opacity: isToday ? 0.5 : 1 }}><ChevronRight size={16} /></button>
          </div>
        </header>

        {/* CHECK-IN VIEW */}
        {view === 'checkin' && (
          <div className="fade-in" style={{ display: 'grid', gap: 20 }}>
            {/* Readiness card */}
            <div className="card" style={{ background: `linear-gradient(135deg, ${readinessColor(score)}10 0%, transparent 100%)`, borderColor: `${readinessColor(score)}40` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', width: 110, height: 110, flexShrink: 0 }}>
                  <svg viewBox="0 0 110 110" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                    <circle cx="55" cy="55" r="48" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
                    <circle cx="55" cy="55" r="48" fill="none" stroke={readinessColor(score)} strokeWidth="6" strokeLinecap="round"
                      strokeDasharray={`${(score / 10) * 301.6} 301.6`} style={{ transition: 'stroke-dasharray 0.6s, stroke 0.4s' }} />
                  </svg>
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="number-font" style={{ fontSize: 38, fontWeight: 500, lineHeight: 1 }}>{score}</div>
                    <div style={{ fontSize: 11, color: '#71717a' }}>/ 10</div>
                  </div>
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 6 }}>Trading Readiness</div>
                  <div className="number-font" style={{ fontSize: 22, fontWeight: 500, color: readinessColor(score), marginBottom: 4, letterSpacing: '-0.01em' }}>
                    {readinessLabel(score)}
                  </div>
                  <div style={{ fontSize: 13, color: '#a1a1aa', lineHeight: 1.5 }}>
                    Composite of sleep, energy, focus, mood, and stress.
                  </div>
                </div>
              </div>
            </div>

            {/* Metrics */}
            <div className="card">
              <div style={{ fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 20 }}>Mental Metrics</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
                {METRICS.map(m => {
                  const Icon = m.icon;
                  const max = m.max || 10;
                  const min = m.id === 'caffeine' ? 0 : 1;
                  const val = entry.metrics[m.id];
                  return (
                    <div key={m.id} style={{ padding: 18, background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.04)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                          <div style={{ width: 32, height: 32, borderRadius: 8, background: `${m.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Icon size={16} color={m.color} />
                          </div>
                          <div>
                            <div style={{ fontWeight: 500, fontSize: 14 }}>{m.label}</div>
                            <div style={{ fontSize: 12, color: '#71717a', marginTop: 2 }}>{m.sub}</div>
                          </div>
                        </div>
                        <div className="number-font" style={{ fontSize: 26, fontWeight: 600, color: m.color, lineHeight: 1 }}>{val}</div>
                      </div>
                      <input type="range" min={min} max={max} value={val} className="slider"
                        onChange={(e) => updateMetric(m.id, Number(e.target.value))}
                        style={{ background: `linear-gradient(to right, ${m.color} 0%, ${m.color} ${((val - min) / (max - min)) * 100}%, rgba(255,255,255,0.08) ${((val - min) / (max - min)) * 100}%)` }} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#52525b', marginTop: 4 }}>
                        <span>{min}</span><span>{max}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Meditation Checkbox */}
            <div className="card">
              <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={entry.metrics.meditation || false}
                  onChange={(e) => updateMetric('meditation', e.target.checked)}
                  style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#8b5cf6' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>Meditated this morning</span>
                  <span style={{ fontSize: 20 }}>🧘</span>
                </div>
              </label>
            </div>

            {/* Today's Intention */}
            <div className="card">
              <div style={{ fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 14 }}>Today's Intention & Focus</div>
              <textarea
                placeholder="What's your main focus today? Key trades to look for, rules to follow, or mindset…"
                value={entry.intention}
                onChange={(e) => setEntry({ ...entry, intention: e.target.value })}
                style={{ minHeight: 100 }}
              />
            </div>

            {/* Pre-market notes */}
            <div className="card">
              <div style={{ fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 14 }}>Pre-Market Notes</div>
              <textarea
                placeholder="What's on your mind today? Any concerns, goals, or market observations…"
                value={entry.preMarketNotes}
                onChange={(e) => setEntry({ ...entry, preMarketNotes: e.target.value })}
                style={{ minHeight: 120 }}
              />
            </div>
          </div>
        )}

        {/* JOURNAL VIEW */}
        {view === 'journal' && (
          <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 1fr) 2fr', gap: 20, alignItems: 'flex-start' }}>
            <div style={{ display: 'grid', gap: 20 }}>
              <div className="card">
                <div style={{ fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 12 }}>P&L ($)</div>
                <input type="number" placeholder="0.00" value={entry.pnl} onChange={(e) => setEntry({ ...entry, pnl: e.target.value })}
                  className="number-font"
                  style={{ fontSize: 18, fontWeight: 500 }} />
                {entry.pnl !== '' && !isNaN(parseFloat(entry.pnl)) && (
                  <div className="number-font" style={{ fontSize: 34, fontWeight: 600, marginTop: 12, color: parseFloat(entry.pnl) >= 0 ? '#10b981' : '#ef4444' }}>
                    {parseFloat(entry.pnl) >= 0 ? '+' : ''}${Math.abs(parseFloat(entry.pnl)).toFixed(2)}
                  </div>
                )}
              </div>

              <div className="card">
                <div style={{ fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 12 }}>Fees ($)</div>
                <input type="number" placeholder="Enter today's fees" value={entry.fees} onChange={(e) => setEntry({ ...entry, fees: e.target.value })} />
              </div>

              <div className="card">
                <div style={{ fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Mental</span>
                  <span className="number-font" style={{ color: '#93c5fd', fontSize: 14, fontWeight: 600 }}>{readiness()}<span style={{ color: '#52525b', fontWeight: 400 }}>/10</span></span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {METRICS.map(m => {
                    const Icon = m.icon;
                    return (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)' }}>
                        <Icon size={14} color={m.color} />
                        <span className="number-font" style={{ fontSize: 14, fontWeight: 600, color: m.color }}>{entry.metrics[m.id]}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, color: '#52525b', marginTop: 12, textAlign: 'center' }}>
                  Edit on Morning Check-in
                </div>
              </div>

              <div className="card">
                <div style={{ fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 14 }}>Mood</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {MOODS.map(m => (
                    <button key={m.id} className={`mood-btn ${entry.moodTag === m.id ? 'active' : ''}`}
                      onClick={() => setEntry({ ...entry, moodTag: entry.moodTag === m.id ? '' : m.id })}>
                      <div style={{ fontSize: 26, marginBottom: 4 }}>{m.emoji}</div>
                      <div>{m.label}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 20 }}>
              <div className="card">
                <div style={{ fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 12 }}>Reflection</div>
                <textarea placeholder="How did the session go? What did you see, what did you do, what would you do differently?"
                  value={entry.reflection} onChange={(e) => setEntry({ ...entry, reflection: e.target.value })}
                  style={{ minHeight: 200 }} />
              </div>

              <div className="card">
                <div style={{ fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 14 }}>What to Work On</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {TAGS.map(t => (
                    <span key={t} className={`tag ${entry.workOn.includes(t) ? 'active' : ''}`} onClick={() => toggleTag(t)}>{t}</span>
                  ))}
                </div>
              </div>

              <div className="card">
                <div style={{ fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#eab308' }}>🏆</span> Best Decision Today
                </div>
                <input placeholder="e.g. Cut my loss early on TSLA" value={entry.bestDecision} onChange={(e) => setEntry({ ...entry, bestDecision: e.target.value })} />
              </div>

              <div className="card">
                <div style={{ fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Screenshots {entry.screenshots?.length > 0 && <span style={{ color: '#52525b', marginLeft: 6 }}>{entry.screenshots.length}</span>}</span>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: 'rgba(59, 130, 246, 0.12)', border: '1px solid rgba(59, 130, 246, 0.3)', color: '#93c5fd', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}>
                    <Upload size={12} /> Add
                    <input type="file" accept="image/*" multiple onChange={handleScreenshotUpload} style={{ display: 'none' }} />
                  </label>
                </div>
                {entry.screenshots?.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
                    {entry.screenshots.map(s => (
                      <div key={s.id} style={{ position: 'relative', aspectRatio: '16/10', borderRadius: 8, overflow: 'hidden', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <img src={s.data} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }} onClick={() => window.open(s.data, '_blank')} />
                        <button onClick={() => removeScreenshot(s.id)}
                          style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 20px', border: '1px dashed rgba(255,255,255,0.12)', borderRadius: 10, cursor: 'pointer', color: '#71717a', fontSize: 13, gap: 8 }}>
                    <Upload size={20} />
                    <span>Drop charts here or click to upload</span>
                    <span style={{ fontSize: 11, color: '#52525b' }}>PNG, JPG up to 2MB each</span>
                    <input type="file" accept="image/*" multiple onChange={handleScreenshotUpload} style={{ display: 'none' }} />
                  </label>
                )}
              </div>

              {/* Day's Imported Trades */}
              {(() => {
                const dayTrades = allTrades[currentDate] || [];
                if (dayTrades.length === 0) return null;
                const trips = buildRoundTripsForDay(dayTrades);
                const realized = trips.reduce((s, t) => s + t.pnl, 0);
                const winners = trips.filter(t => t.pnl > 0.01).length;
                const losers = trips.filter(t => t.pnl < -0.01).length;

                // Group by symbol for display
                const bySymbol = {};
                trips.forEach(t => {
                  if (!bySymbol[t.symbol]) bySymbol[t.symbol] = [];
                  bySymbol[t.symbol].push(t);
                });
                const sortedSymbols = Object.entries(bySymbol).sort((a, b) => {
                  const aPnl = a[1].reduce((s, t) => s + t.pnl, 0);
                  const bPnl = b[1].reduce((s, t) => s + t.pnl, 0);
                  return Math.abs(bPnl) - Math.abs(aPnl);
                });

                return (
                  <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Activity size={12} /> Imported Trades
                        <span style={{ color: '#52525b', textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>
                          {dayTrades.length} {dayTrades.length === 1 ? 'fill' : 'fills'} · {trips.length} round-trip{trips.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                        <div style={{ fontSize: 11, color: '#10b981' }}>{winners}W</div>
                        <div style={{ fontSize: 11, color: '#ef4444' }}>{losers}L</div>
                        <div className="number-font" style={{ fontSize: 16, fontWeight: 600, color: realized >= 0 ? '#10b981' : '#ef4444' }}>
                          {realized >= 0 ? '+' : '−'}${Math.abs(realized).toFixed(2)}
                        </div>
                      </div>
                    </div>

                    {/* Symbol cards */}
                    {sortedSymbols.length > 0 && (
                      <div style={{ display: 'grid', gap: 8, marginBottom: trips.length > 0 ? 16 : 0 }}>
                        {sortedSymbols.map(([symbol, symTrips]) => {
                          const symPnl = symTrips.reduce((s, t) => s + t.pnl, 0);
                          return (
                            <details key={symbol} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: `1px solid ${symPnl >= 0 ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
                              <summary style={{ padding: '10px 14px', cursor: 'pointer', userSelect: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', listStyle: 'none' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                  <span className="number-font" style={{ fontWeight: 700, fontSize: 14 }}>{symbol}</span>
                                  <span style={{ fontSize: 11, color: '#71717a' }}>{symTrips.length} {symTrips.length === 1 ? 'trip' : 'trips'}</span>
                                </div>
                                <div className="number-font" style={{ fontSize: 14, fontWeight: 600, color: symPnl >= 0 ? '#10b981' : '#ef4444' }}>
                                  {symPnl >= 0 ? '+' : '−'}${Math.abs(symPnl).toFixed(2)}
                                </div>
                              </summary>
                              <div style={{ padding: '0 14px 12px', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                                  <thead>
                                    <tr style={{ color: '#52525b', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                                      <th style={{ textAlign: 'left', padding: '6px 4px' }}>Side</th>
                                      <th style={{ textAlign: 'left', padding: '6px 4px' }}>Entry</th>
                                      <th style={{ textAlign: 'left', padding: '6px 4px' }}>Exit</th>
                                      <th style={{ textAlign: 'right', padding: '6px 4px' }}>Qty</th>
                                      <th style={{ textAlign: 'right', padding: '6px 4px' }}>In</th>
                                      <th style={{ textAlign: 'right', padding: '6px 4px' }}>Out</th>
                                      <th style={{ textAlign: 'right', padding: '6px 4px' }}>Hold</th>
                                      <th style={{ textAlign: 'right', padding: '6px 4px' }}>P&L</th>
                                    </tr>
                                  </thead>
                                  <tbody className="number-font">
                                    {symTrips.map((t, i) => (
                                      <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.03)' }}>
                                        <td style={{ padding: '6px 4px', color: t.side === 'long' ? '#6ee7b7' : '#fca5a5', fontSize: 11 }}>
                                          {t.side === 'long' ? 'LONG' : 'SHORT'}
                                        </td>
                                        <td style={{ padding: '6px 4px', color: '#a1a1aa' }}>{t.entryTime}</td>
                                        <td style={{ padding: '6px 4px', color: '#a1a1aa' }}>{t.exitTime}</td>
                                        <td style={{ padding: '6px 4px', textAlign: 'right' }}>{t.qty}</td>
                                        <td style={{ padding: '6px 4px', textAlign: 'right' }}>${t.entryPrice.toFixed(2)}</td>
                                        <td style={{ padding: '6px 4px', textAlign: 'right' }}>${t.exitPrice.toFixed(2)}</td>
                                        <td style={{ padding: '6px 4px', textAlign: 'right', color: '#71717a' }}>{fmtHoldDuration(t.entryTime, t.exitTime)}</td>
                                        <td style={{ padding: '6px 4px', textAlign: 'right', color: t.pnl >= 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                                          {t.pnl >= 0 ? '+' : '−'}${Math.abs(t.pnl).toFixed(2)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </details>
                          );
                        })}
                      </div>
                    )}

                    {/* All executions table (expandable) */}
                    <details>
                      <summary style={{ cursor: 'pointer', fontSize: 11, color: '#71717a', userSelect: 'none', padding: '6px 0' }}>
                        Show all {dayTrades.length} executions chronologically
                      </summary>
                      <div style={{ marginTop: 8, overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                          <thead>
                            <tr style={{ color: '#52525b', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                              <th style={{ textAlign: 'left', padding: '6px 4px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Time</th>
                              <th style={{ textAlign: 'left', padding: '6px 4px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Sym</th>
                              <th style={{ textAlign: 'left', padding: '6px 4px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Side</th>
                              <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Qty</th>
                              <th style={{ textAlign: 'right', padding: '6px 4px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Price</th>
                            </tr>
                          </thead>
                          <tbody className="number-font">
                            {[...dayTrades].sort((a, b) => a.time.localeCompare(b.time)).map(t => (
                              <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                <td style={{ padding: '6px 4px', color: '#71717a' }}>{t.time}</td>
                                <td style={{ padding: '6px 4px', fontWeight: 600 }}>{t.symbol}</td>
                                <td style={{ padding: '6px 4px', color: t.side.startsWith('BUY') ? '#6ee7b7' : '#fca5a5', fontSize: 10 }}>
                                  {t.side.replace('TOOPEN', ' OPEN').replace('TOCLOSE', ' CLOSE')}
                                </td>
                                <td style={{ padding: '6px 4px', textAlign: 'right' }}>{t.qty}</td>
                                <td style={{ padding: '6px 4px', textAlign: 'right' }}>${t.price.toFixed(4)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* CALENDAR VIEW */}
        {view === 'calendar' && (() => {
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const firstDay = new Date(calendarMonth.year, calendarMonth.month, 1).getDay();
          const daysInMonth = new Date(calendarMonth.year, calendarMonth.month + 1, 0).getDate();
          const today = todayKey();

          const cells = [];
          for (let i = 0; i < firstDay; i++) cells.push(null);
          for (let d = 1; d <= daysInMonth; d++) {
            const key = `${calendarMonth.year}-${String(calendarMonth.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            cells.push({ day: d, key, entry: allEntries[key], isToday: key === today });
          }
          while (cells.length % 7 !== 0) cells.push(null);

          const shiftMonth = (delta) => {
            let m = calendarMonth.month + delta;
            let y = calendarMonth.year;
            if (m < 0) { m = 11; y--; }
            if (m > 11) { m = 0; y++; }
            setCalendarMonth({ year: y, month: m });
          };

          // Monthly stats
          const monthEntries = Object.entries(allEntries).filter(([k]) => k.startsWith(`${calendarMonth.year}-${String(calendarMonth.month + 1).padStart(2, '0')}`));
          const monthPnl = monthEntries.reduce((sum, [, e]) => sum + (parseFloat(e.pnl) || 0), 0);
          const tradingDays = monthEntries.filter(([, e]) => e.pnl !== '' && !isNaN(parseFloat(e.pnl))).length;
          const winningDays = monthEntries.filter(([, e]) => parseFloat(e.pnl) > 0).length;
          const losingDays = monthEntries.filter(([, e]) => parseFloat(e.pnl) < 0).length;

          return (
            <div className="fade-in">
              {/* Calendar header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button className="nav-btn" onClick={() => shiftMonth(-1)}><ChevronLeft size={16} /></button>
                  <h2 className="number-font" style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: '-0.02em', minWidth: 220, textAlign: 'center' }}>
                    {monthNames[calendarMonth.month]} {calendarMonth.year}
                  </h2>
                  <button className="nav-btn" onClick={() => shiftMonth(1)}><ChevronRight size={16} /></button>
                </div>
                <button className="nav-btn" onClick={() => {
                  const d = new Date();
                  setCalendarMonth({ year: d.getFullYear(), month: d.getMonth() });
                }}>Today</button>
              </div>

              {/* Monthly stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 8 }}>Month P&L</div>
                  <div className="number-font" style={{ fontSize: 24, fontWeight: 600, color: monthPnl >= 0 ? '#10b981' : '#ef4444' }}>
                    {monthPnl >= 0 ? '+' : ''}${Math.abs(monthPnl).toFixed(2)}
                  </div>
                </div>
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 8 }}>Trading Days</div>
                  <div className="number-font" style={{ fontSize: 24, fontWeight: 600 }}>{tradingDays}</div>
                </div>
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 8 }}>Win Rate</div>
                  <div className="number-font" style={{ fontSize: 24, fontWeight: 600, color: '#93c5fd' }}>
                    {tradingDays > 0 ? Math.round((winningDays / tradingDays) * 100) : 0}%
                  </div>
                </div>
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 8 }}>W / L Days</div>
                  <div className="number-font" style={{ fontSize: 24, fontWeight: 600 }}>
                    <span style={{ color: '#10b981' }}>{winningDays}</span>
                    <span style={{ color: '#52525b' }}> / </span>
                    <span style={{ color: '#ef4444' }}>{losingDays}</span>
                  </div>
                </div>
              </div>

              {/* Calendar grid */}
              <div className="card" style={{ padding: 20 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6, marginBottom: 8 }}>
                  {dayNames.map(d => (
                    <div key={d} style={{ fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#52525b', textAlign: 'center', padding: '8px 0' }}>{d}</div>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
                  {cells.map((cell, i) => {
                    if (!cell) return <div key={i} />;
                    const pnl = cell.entry ? parseFloat(cell.entry.pnl) : NaN;
                    const hasPnl = !isNaN(pnl);
                    const isWin = hasPnl && pnl > 0;
                    const isLoss = hasPnl && pnl < 0;
                    const hasMental = cell.entry && cell.entry.metrics && (cell.entry.preMarketNotes || cell.entry.savedAt);

                    let bg = 'rgba(255,255,255,0.02)';
                    let border = 'rgba(255,255,255,0.06)';
                    let pnlColor = '#71717a';

                    if (isWin) {
                      bg = 'rgba(16, 185, 129, 0.08)';
                      border = 'rgba(16, 185, 129, 0.3)';
                      pnlColor = '#10b981';
                    } else if (isLoss) {
                      bg = 'rgba(239, 68, 68, 0.08)';
                      border = 'rgba(239, 68, 68, 0.3)';
                      pnlColor = '#ef4444';
                    } else if (hasMental) {
                      bg = 'rgba(59, 130, 246, 0.04)';
                      border = 'rgba(59, 130, 246, 0.2)';
                    }

                    if (cell.isToday) {
                      border = 'rgba(147, 197, 253, 0.6)';
                    }

                    return (
                      <div key={i}
                        onClick={() => { setCurrentDate(cell.key); setView('journal'); }}
                        style={{
                          aspectRatio: '1',
                          background: bg,
                          border: `1px solid ${border}`,
                          borderRadius: 10,
                          padding: 10,
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          minHeight: 80,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.borderColor = border; }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div className="number-font" style={{ fontSize: 14, fontWeight: cell.isToday ? 700 : 500, color: cell.isToday ? '#93c5fd' : '#a1a1aa' }}>
                            {cell.day}
                          </div>
                          {hasMental && !hasPnl && (
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6' }} />
                          )}
                        </div>
                        {hasPnl && (
                          <div className="number-font" style={{ fontSize: 13, fontWeight: 600, color: pnlColor, lineHeight: 1.2 }}>
                            {pnl >= 0 ? '+' : '−'}${Math.abs(pnl).toFixed(0)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Legend */}
                <div style={{ display: 'flex', gap: 20, marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap', fontSize: 12, color: '#71717a' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 4, background: 'rgba(16, 185, 129, 0.2)', border: '1px solid rgba(16, 185, 129, 0.4)' }} />
                    Winning day
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 12, height: 12, borderRadius: 4, background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.4)' }} />
                    Losing day
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6' }} />
                    Journal entry
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ANALYTICS VIEW */}
        {view === 'analytics' && (() => {
          // Build round-trip "trades" by pairing buys and sells per symbol per day (FIFO).
          const buildRoundTrips = () => {
            const trips = [];
            Object.entries(allTrades).forEach(([date, dayTrades]) => {
              const bySymbol = {};
              dayTrades.forEach(t => {
                if (!bySymbol[t.symbol]) bySymbol[t.symbol] = [];
                bySymbol[t.symbol].push(t);
              });
              Object.entries(bySymbol).forEach(([symbol, trades]) => {
                const sorted = [...trades].sort((a, b) => a.time.localeCompare(b.time));
                const longQueue = [];
                const shortQueue = [];
                sorted.forEach(t => {
                  let qty = Math.abs(t.qty);
                  const isBuy = t.qty > 0;
                  const price = t.price;
                  const time = t.time;
                  const commPerShare = qty > 0 ? t.commission / qty : 0;
                  if (isBuy) {
                    while (qty > 0 && shortQueue.length > 0) {
                      const s = shortQueue[0];
                      const closeQty = Math.min(qty, s.qty);
                      const pnl = (s.price - price) * closeQty + (s.commission * (closeQty / s.origQty)) + commPerShare * closeQty;
                      trips.push({
                        date, symbol, side: 'short',
                        entryTime: s.time, exitTime: time,
                        qty: closeQty,
                        entryPrice: s.price, exitPrice: price,
                        pnl,
                      });
                      s.qty -= closeQty;
                      qty -= closeQty;
                      if (s.qty <= 0.0001) shortQueue.shift();
                    }
                    if (qty > 0) longQueue.push({ qty, origQty: qty, price, time, commission: commPerShare * qty });
                  } else {
                    while (qty > 0 && longQueue.length > 0) {
                      const l = longQueue[0];
                      const closeQty = Math.min(qty, l.qty);
                      const pnl = (price - l.price) * closeQty + (l.commission * (closeQty / l.origQty)) + commPerShare * closeQty;
                      trips.push({
                        date, symbol, side: 'long',
                        entryTime: l.time, exitTime: time,
                        qty: closeQty,
                        entryPrice: l.price, exitPrice: price,
                        pnl,
                      });
                      l.qty -= closeQty;
                      qty -= closeQty;
                      if (l.qty <= 0.0001) longQueue.shift();
                    }
                    if (qty > 0) shortQueue.push({ qty, origQty: qty, price, time, commission: commPerShare * qty });
                  }
                });
              });
            });
            return trips.sort((a, b) => (a.date + a.exitTime).localeCompare(b.date + b.exitTime));
          };

          const trips = buildRoundTrips();
          const allTradesArr = Object.values(allTrades).flat();

          const winners = trips.filter(t => t.pnl > 0.01);
          const losers = trips.filter(t => t.pnl < -0.01);
          const scratch = trips.filter(t => Math.abs(t.pnl) <= 0.01);
          const totalPnL = trips.reduce((s, t) => s + t.pnl, 0);
          const grossWins = winners.reduce((s, t) => s + t.pnl, 0);
          const grossLosses = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));
          const profitFactor = grossLosses > 0 ? grossWins / grossLosses : (grossWins > 0 ? Infinity : 0);
          const largestWin = winners.length > 0 ? Math.max(...winners.map(t => t.pnl)) : 0;
          const largestLoss = losers.length > 0 ? Math.min(...losers.map(t => t.pnl)) : 0;
          const winRate = trips.length > 0 ? (winners.length / trips.length) * 100 : 0;
          const avgWin = winners.length > 0 ? grossWins / winners.length : 0;
          const avgLoss = losers.length > 0 ? -grossLosses / losers.length : 0;

          const byDay = {};
          trips.forEach(t => { byDay[t.date] = (byDay[t.date] || 0) + t.pnl; });
          const tradingDays = Object.keys(byDay).length;
          const avgDailyPnL = tradingDays > 0 ? totalPnL / tradingDays : 0;

          let maxConsecWins = 0, maxConsecLosses = 0, curW = 0, curL = 0;
          trips.forEach(t => {
            if (t.pnl > 0.01) { curW++; curL = 0; if (curW > maxConsecWins) maxConsecWins = curW; }
            else if (t.pnl < -0.01) { curL++; curW = 0; if (curL > maxConsecLosses) maxConsecLosses = curL; }
            else { curW = 0; curL = 0; }
          });

          const totalFees = Math.abs(allTradesArr.reduce((s, t) => s + (t.commission || 0), 0));

          const dowLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const dowPnL = [0, 0, 0, 0, 0, 0, 0];
          Object.entries(byDay).forEach(([date, pnl]) => {
            const [y, m, d] = date.split('-').map(Number);
            const dow = new Date(y, m - 1, d).getDay();
            dowPnL[dow] += pnl;
          });
          const dowTotal = dowPnL.reduce((s, v) => s + Math.abs(v), 0);

          const hourPnL = {};
          trips.forEach(t => {
            const hour = parseInt(t.exitTime.split(':')[0], 10);
            hourPnL[hour] = (hourPnL[hour] || 0) + t.pnl;
          });
          const hourEntries = Object.entries(hourPnL).map(([h, p]) => [parseInt(h, 10), p]).sort((a, b) => a[0] - b[0]);
          const hourTotal = hourEntries.reduce((s, [, v]) => s + Math.abs(v), 0);

          const priceBuckets = [
            { label: '< $2', min: 0, max: 2 },
            { label: '$2 - $4.99', min: 2, max: 5 },
            { label: '$5 - $9.99', min: 5, max: 10 },
            { label: '$10 - $19.99', min: 10, max: 20 },
            { label: '$20 - $49.99', min: 20, max: 50 },
            { label: '$50 - $99.99', min: 50, max: 100 },
            { label: '$100 - $199.99', min: 100, max: 200 },
            { label: '$200 - $499.99', min: 200, max: 500 },
            { label: '$500+', min: 500, max: Infinity },
          ];
          const priceBucketPnL = priceBuckets.map(b => {
            const matched = trips.filter(t => t.entryPrice >= b.min && t.entryPrice < b.max);
            return { ...b, pnl: matched.reduce((s, t) => s + t.pnl, 0), count: matched.length };
          });
          const priceTotal = priceBucketPnL.reduce((s, b) => s + Math.abs(b.pnl), 0);

          const intradayTrips = trips;
          const totalIntraday = intradayTrips.reduce((s, t) => s + t.pnl, 0);

          const timeToSeconds = (t) => {
            const [h, m, s] = t.split(':').map(Number);
            return h * 3600 + m * 60 + (s || 0);
          };
          const avgHoldWinners = winners.length > 0 ? winners.reduce((s, t) => s + Math.max(0, timeToSeconds(t.exitTime) - timeToSeconds(t.entryTime)), 0) / winners.length : 0;
          const avgHoldLosers = losers.length > 0 ? losers.reduce((s, t) => s + Math.max(0, timeToSeconds(t.exitTime) - timeToSeconds(t.entryTime)), 0) / losers.length : 0;
          const fmtDuration = (sec) => {
            if (sec < 60) return `${Math.round(sec)}s`;
            if (sec < 3600) return `${Math.round(sec / 60)}m`;
            return `${(sec / 3600).toFixed(1)}h`;
          };

          const sortedDays = Object.keys(byDay).sort();
          let running = 0;
          const cumulative = sortedDays.map(d => { running += byDay[d]; return { date: d, value: running, dayPnL: byDay[d] }; });

          let peak = 0;
          const drawdownSeries = cumulative.map(p => {
            if (p.value > peak) peak = p.value;
            return { date: p.date, value: p.value - peak };
          });
          const maxDrawdown = drawdownSeries.length > 0 ? Math.min(...drawdownSeries.map(p => p.value)) : 0;

          const dailyVolume = {};
          allTradesArr.forEach(t => {
            dailyVolume[t.date] = (dailyVolume[t.date] || 0) + Math.abs(t.qty);
          });
          const volumeDays = Object.keys(dailyVolume).sort();

          const mistakeCounts = {};
          Object.values(allEntries).forEach(e => {
            (e.workOn || []).forEach(t => { mistakeCounts[t] = (mistakeCounts[t] || 0) + 1; });
          });
          const topMistakes = Object.entries(mistakeCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
          const maxMistake = topMistakes[0]?.[1] || 1;

          const allEntriesArr = Object.entries(allEntries);
          const last30Cutoff = new Date();
          last30Cutoff.setDate(last30Cutoff.getDate() - 30);
          const last30Key = `${last30Cutoff.getFullYear()}-${String(last30Cutoff.getMonth() + 1).padStart(2, '0')}-${String(last30Cutoff.getDate()).padStart(2, '0')}`;
          const last30 = allEntriesArr.filter(([k]) => k >= last30Key);
          const withReflection = last30.filter(([, e]) => (e.reflection || '').trim().length > 20).length;
          const reflectionRate = last30.length > 0 ? Math.round((withReflection / last30.length) * 100) : 0;

          const Tile = ({ icon: Icon, iconColor, label, value, valueColor, sub }) => (
            <div style={{ padding: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#71717a', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                {Icon && <Icon size={11} color={iconColor || '#71717a'} />} {label}
              </div>
              <div className="number-font" style={{ fontSize: 22, fontWeight: 600, color: valueColor || '#e4e4e7', lineHeight: 1.1 }}>{value}</div>
              {sub && <div style={{ fontSize: 11, color: '#52525b', marginTop: 4 }}>{sub}</div>}
            </div>
          );

          const BarRow = ({ label, value, percent, color }) => (
            <div style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4, fontSize: 13 }}>
                <span style={{ color: '#a1a1aa' }}>{label}</span>
                <span>
                  <span className="number-font" style={{ color: value >= 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                    {value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}
                  </span>
                  <span style={{ color: '#52525b', marginLeft: 8, fontSize: 11 }} className="number-font">{percent.toFixed(1)}%</span>
                </span>
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, percent)}%`, background: color, borderRadius: 2, transition: 'width 0.4s' }} />
              </div>
            </div>
          );

          const renderLineChart = (data, accessor, color, height = 140) => {
            if (data.length < 2) {
              return <div style={{ fontSize: 12, color: '#52525b', textAlign: 'center', padding: '40px 0' }}>Need at least 2 days of data</div>;
            }
            const values = data.map(accessor);
            const min = Math.min(...values, 0);
            const max = Math.max(...values, 0);
            const range = max - min || 1;
            const w = 600;
            const padTop = 10, padBot = 20;
            const inner = height - padTop - padBot;
            const points = data.map((d, i) => {
              const x = (i / Math.max(1, data.length - 1)) * w;
              const y = padTop + inner - ((accessor(d) - min) / range) * inner;
              return { x, y };
            });
            const path = `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`;
            const zeroY = padTop + inner - ((0 - min) / range) * inner;
            const fill = `${path} L ${w},${height - padBot} L 0,${height - padBot} Z`;
            const gradId = `grad-${color.replace(/[^a-z0-9]/gi, '')}`;
            return (
              <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
                <defs>
                  <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                  </linearGradient>
                </defs>
                {min < 0 && max > 0 && (
                  <line x1="0" x2={w} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.1)" strokeDasharray="3,3" />
                )}
                <path d={fill} fill={`url(#${gradId})`} />
                <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                {points.length <= 30 && points.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={color} />
                ))}
              </svg>
            );
          };

          const renderBarChart = (data, accessor, height = 140) => {
            if (data.length === 0) return <div style={{ fontSize: 12, color: '#52525b', textAlign: 'center', padding: '40px 0' }}>No data yet</div>;
            const values = data.map(accessor);
            const max = Math.max(...values, 1);
            const w = 600;
            const padBot = 20, padTop = 10;
            const inner = height - padBot - padTop;
            const barW = Math.max(2, w / data.length - 2);
            return (
              <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
                {data.map((d, i) => {
                  const v = accessor(d);
                  const h = (v / max) * inner;
                  const x = (i / data.length) * w;
                  const y = padTop + inner - h;
                  return <rect key={i} x={x} y={y} width={barW} height={h} fill="#3b82f6" rx="1" opacity="0.8" />;
                })}
              </svg>
            );
          };

          return (
            <div className="fade-in" style={{ display: 'grid', gap: 24 }}>
              <div>
                <h2 className="number-font" style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>Analytics</h2>
                <div style={{ fontSize: 13, color: '#71717a', marginTop: 4 }}>
                  {trips.length > 0
                    ? `${trips.length} round-trip ${trips.length === 1 ? 'trade' : 'trades'} across ${tradingDays} ${tradingDays === 1 ? 'day' : 'days'}`
                    : 'Import trades to see analytics'}
                </div>
              </div>

              {trips.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: 60 }}>
                  <BarChart3 size={32} color="#52525b" style={{ marginBottom: 12 }} />
                  <div style={{ fontSize: 15, color: '#a1a1aa', marginBottom: 4 }}>No data yet</div>
                  <div style={{ fontSize: 13, color: '#52525b' }}>Use the "Import .tlg" button in the sidebar to load trade history.</div>
                </div>
              ) : (
                <>
                  <div className="card">
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <TrendingUp size={16} color="#10b981" /> Profitability Overview
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                      <Tile label="Total P&L" value={`${totalPnL >= 0 ? '+' : '−'}$${Math.abs(totalPnL).toFixed(2)}`} valueColor={totalPnL >= 0 ? '#10b981' : '#ef4444'} />
                      <Tile label="Largest Win" value={`+$${largestWin.toFixed(2)}`} valueColor="#10b981" />
                      <Tile label="Largest Loss" value={`−$${Math.abs(largestLoss).toFixed(2)}`} valueColor="#ef4444" />
                      <Tile label="Avg Daily P&L" value={`${avgDailyPnL >= 0 ? '+' : '−'}$${Math.abs(avgDailyPnL).toFixed(2)}`} valueColor={avgDailyPnL >= 0 ? '#10b981' : '#ef4444'} />
                      <Tile label="Profit Factor" value={isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞'} valueColor="#93c5fd" />
                      <Tile label="Total Fees" value={`$${totalFees.toFixed(2)}`} valueColor="#f97316" />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginTop: 10 }}>
                      <Tile label="Total Trades" value={trips.length} />
                      <Tile label="Winning" value={winners.length} valueColor="#10b981" />
                      <Tile label="Losing" value={losers.length} valueColor="#ef4444" />
                      <Tile label="Scratch" value={scratch.length} valueColor="#a1a1aa" />
                      <Tile label="Max Win Streak" value={maxConsecWins} valueColor="#10b981" />
                      <Tile label="Max Loss Streak" value={maxConsecLosses} valueColor="#ef4444" />
                    </div>
                  </div>

                  <div className="card">
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 18 }}>Key Metrics</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                      <Tile label="Win Rate" value={`${winRate.toFixed(1)}%`} valueColor="#93c5fd" />
                      <Tile label="Avg Win" value={`+$${avgWin.toFixed(2)}`} valueColor="#10b981" />
                      <Tile label="Avg Loss" value={`−$${Math.abs(avgLoss).toFixed(2)}`} valueColor="#ef4444" />
                      <Tile label="Avg Hold (Win)" value={fmtDuration(avgHoldWinners)} valueColor="#10b981" />
                      <Tile label="Avg Hold (Loss)" value={fmtDuration(avgHoldLosers)} valueColor="#ef4444" />
                      <Tile label="Reflection Rate" value={`${reflectionRate}%`} valueColor="#eab308" sub={`${withReflection}/${last30.length} (30d)`} />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
                    <div className="card">
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Cumulative P&L</div>
                      {renderLineChart(cumulative, d => d.value, '#10b981')}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#52525b', marginTop: 4 }}>
                        <span>{cumulative[0] && formatShortDate(cumulative[0].date)}</span>
                        <span>{cumulative[cumulative.length - 1] && formatShortDate(cumulative[cumulative.length - 1].date)}</span>
                      </div>
                    </div>
                    <div className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>Cumulative Drawdown</div>
                        <div className="number-font" style={{ fontSize: 13, fontWeight: 600, color: '#ef4444' }}>
                          Max: −${Math.abs(maxDrawdown).toFixed(2)}
                        </div>
                      </div>
                      {renderLineChart(drawdownSeries, d => d.value, '#ef4444')}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#52525b', marginTop: 4 }}>
                        <span>{drawdownSeries[0] && formatShortDate(drawdownSeries[0].date)}</span>
                        <span>{drawdownSeries[drawdownSeries.length - 1] && formatShortDate(drawdownSeries[drawdownSeries.length - 1].date)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="card">
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Daily Volume (shares)</div>
                    {renderBarChart(volumeDays, d => dailyVolume[d])}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#52525b', marginTop: 4 }}>
                      <span>{volumeDays[0] && formatShortDate(volumeDays[0])}</span>
                      <span>{volumeDays[volumeDays.length - 1] && formatShortDate(volumeDays[volumeDays.length - 1])}</span>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
                    <div className="card">
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 18 }}>Performance by Day of Week</div>
                      {dowLabels.map((label, i) => (
                        <BarRow key={label} label={label} value={dowPnL[i]}
                          percent={dowTotal > 0 ? (Math.abs(dowPnL[i]) / dowTotal) * 100 : 0}
                          color={dowPnL[i] >= 0 ? '#10b981' : '#ef4444'} />
                      ))}
                    </div>
                    <div className="card">
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 18 }}>Performance by Hour of Day</div>
                      {hourEntries.length === 0 ? (
                        <div style={{ fontSize: 12, color: '#52525b', textAlign: 'center', padding: '32px 0' }}>No trade hours yet</div>
                      ) : (
                        hourEntries.map(([hour, pnl]) => (
                          <BarRow key={hour} label={`${String(hour).padStart(2, '0')}:00`} value={pnl}
                            percent={hourTotal > 0 ? (Math.abs(pnl) / hourTotal) * 100 : 0}
                            color={pnl >= 0 ? '#10b981' : '#ef4444'} />
                        ))
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
                    <div className="card">
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 18 }}>Performance by Entry Price</div>
                      {priceBucketPnL.filter(b => b.count > 0).map(b => (
                        <BarRow key={b.label} label={`${b.label} (${b.count})`} value={b.pnl}
                          percent={priceTotal > 0 ? (Math.abs(b.pnl) / priceTotal) * 100 : 0}
                          color={b.pnl >= 0 ? '#10b981' : '#ef4444'} />
                      ))}
                    </div>
                    <div className="card">
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 18 }}>Performance by Duration</div>
                      <BarRow label={`Intraday (${intradayTrips.length})`} value={totalIntraday} percent={100} color={totalIntraday >= 0 ? '#10b981' : '#ef4444'} />
                      <div style={{ fontSize: 11, color: '#52525b', marginTop: 12, lineHeight: 1.5 }}>
                        Multi-day positions don't appear here yet — they'll show when the position fully closes.
                      </div>
                      <div style={{ marginTop: 24, paddingTop: 18, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#71717a', marginBottom: 12 }}>Hold Time</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          <Tile label="Avg Hold (Wins)" value={fmtDuration(avgHoldWinners)} valueColor="#10b981" />
                          <Tile label="Avg Hold (Losses)" value={fmtDuration(avgHoldLosers)} valueColor="#ef4444" />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* MONTHLY BREAKDOWN */}
                  {(() => {
                    const byMonth = {};
                    trips.forEach(t => {
                      const [y, m] = t.date.split('-');
                      const key = `${y}-${m}`;
                      if (!byMonth[key]) byMonth[key] = { count: 0, pnl: 0 };
                      byMonth[key].count += 1;
                      byMonth[key].pnl += t.pnl;
                    });
                    const monthlyEntries = Object.entries(byMonth).sort();
                    if (monthlyEntries.length === 0) return null;

                    const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const monthlyData = monthlyEntries.map(([k, v]) => {
                      const m = parseInt(k.split('-')[1], 10);
                      return { date: k, label: monthLabels[m - 1], count: v.count, pnl: v.pnl };
                    });
                    const monthlyMaxCount = Math.max(...monthlyData.map(d => d.count), 1);
                    const monthlyMaxPnL = Math.max(...monthlyData.map(d => Math.abs(d.pnl)), 1);
                    const monthlyTotalCount = monthlyData.reduce((s, d) => s + d.count, 0);
                    const monthlyTotalPnL = monthlyData.reduce((s, d) => s + Math.abs(d.pnl), 0);

                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
                        <div className="card">
                          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Trade Distribution by Month</div>
                          {renderBarChart(monthlyData, d => d.count, 120)}
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#52525b', marginTop: 4 }}>
                            <span>{monthlyData[0]?.label || ''}</span>
                            <span>{monthlyData[monthlyData.length - 1]?.label || ''}</span>
                          </div>
                        </div>
                        <div className="card">
                          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Performance by Month</div>
                          {renderBarChart(monthlyData, d => d.pnl, 120)}
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#52525b', marginTop: 4 }}>
                            <span>{monthlyData[0]?.label || ''}</span>
                            <span>{monthlyData[monthlyData.length - 1]?.label || ''}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* DURATION BREAKDOWN */}
                  {(() => {
                    // Intraday duration buckets
                    const durationBuckets = [
                      { label: '< 1m', min: 0, max: 60 },
                      { label: '1m - 5m', min: 60, max: 300 },
                      { label: '5m - 10m', min: 300, max: 600 },
                      { label: '10m - 1h', min: 600, max: 3600 },
                      { label: '1h - 4h', min: 3600, max: 14400 },
                      { label: '4h+', min: 14400, max: Infinity },
                    ];

                    const timeToSeconds = (t) => {
                      const [h, m, s] = t.split(':').map(Number);
                      return h * 3600 + m * 60 + (s || 0);
                    };

                    const durationBucketData = durationBuckets.map(b => {
                      const matched = trips.filter(t => {
                        const sec = Math.max(0, timeToSeconds(t.exitTime) - timeToSeconds(t.entryTime));
                        return sec >= b.min && sec < b.max;
                      });
                      return { ...b, count: matched.length, pnl: matched.reduce((s, t) => s + t.pnl, 0) };
                    });

                    const durationTotal = durationBucketData.reduce((s, b) => s + b.count, 0);
                    const durationPnLTotal = durationBucketData.reduce((s, b) => s + Math.abs(b.pnl), 0);

                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
                        <div className="card">
                          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 18 }}>Trade Distribution by Hold Time</div>
                          {durationBucketData.filter(b => b.count > 0).map(b => (
                            <BarRow key={b.label} label={`${b.label} (${b.count})`} value={b.count}
                              percent={durationTotal > 0 ? (b.count / durationTotal) * 100 : 0}
                              color="#3b82f6" />
                          ))}
                        </div>
                        <div className="card">
                          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 18 }}>Performance by Hold Time</div>
                          {durationBucketData.filter(b => b.count > 0).map(b => (
                            <BarRow key={b.label} label={`${b.label} (${b.count})`} value={b.pnl}
                              percent={durationPnLTotal > 0 ? (Math.abs(b.pnl) / durationPnLTotal) * 100 : 0}
                              color={b.pnl >= 0 ? '#10b981' : '#ef4444'} />
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {topMistakes.length > 0 && (
                    <div className="card">
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <AlertTriangle size={16} color="#f97316" /> Most Common Mistakes
                      </div>
                      <div style={{ display: 'grid', gap: 14 }}>
                        {topMistakes.map(([tag, count], i) => (
                          <div key={tag}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                              <div style={{ fontSize: 14, color: '#e4e4e7' }}>
                                <span style={{ color: '#52525b', marginRight: 8 }}>{i + 1}.</span>
                                {tag}
                              </div>
                              <div className="number-font" style={{ fontSize: 13, color: '#a1a1aa', fontWeight: 600 }}>{count}×</div>
                            </div>
                            <div style={{ height: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${(count / maxMistake) * 100}%`, background: 'linear-gradient(90deg, #f97316, #ef4444)', borderRadius: 3 }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })()}

        {/* TRADE LOG VIEW */}
        {view === 'trades' && (() => {
          const dates = Object.keys(allTrades).sort().reverse();
          const totalTrades = Object.values(allTrades).reduce((s, t) => s + t.length, 0);

          return (
            <div className="fade-in" style={{ display: 'grid', gap: 20 }}>
              <div>
                <h2 className="number-font" style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>Trade Log</h2>
                <div style={{ fontSize: 13, color: '#71717a', marginTop: 4 }}>
                  {totalTrades} {totalTrades === 1 ? 'trade' : 'trades'} across {dates.length} {dates.length === 1 ? 'day' : 'days'}
                </div>
              </div>

              {dates.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: 60 }}>
                  <FileText size={32} color="#52525b" style={{ marginBottom: 12 }} />
                  <div style={{ fontSize: 15, color: '#a1a1aa', marginBottom: 4 }}>No trades imported yet</div>
                  <div style={{ fontSize: 13, color: '#52525b', marginBottom: 20 }}>Use the "Import .tlg" button in the sidebar to load Interactive Brokers trade logs.</div>
                </div>
              ) : (
                dates.map(date => {
                  const dayTrades = allTrades[date];
                  const { realized, unrealized, symbolPnl } = computeRealizedPnl(dayTrades);
                  const symbols = Object.keys(symbolPnl);
                  return (
                    <div key={date} className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                        <div>
                          <div className="number-font" style={{ fontSize: 18, fontWeight: 600 }}>{formatShortDate(date)}</div>
                          <div style={{ fontSize: 12, color: '#71717a', marginTop: 2 }}>
                            {dayTrades.length} executions · {symbols.length} {symbols.length === 1 ? 'symbol' : 'symbols'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 2 }}>Realized</div>
                            <div className="number-font" style={{ fontSize: 18, fontWeight: 600, color: realized >= 0 ? '#10b981' : '#ef4444' }}>
                              {realized >= 0 ? '+' : '−'}${Math.abs(realized).toFixed(2)}
                            </div>
                          </div>
                          {Math.abs(unrealized) > 0.01 && (
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 2 }}>Open Cash Flow</div>
                              <div className="number-font" style={{ fontSize: 14, fontWeight: 500, color: '#a1a1aa' }}>
                                {unrealized >= 0 ? '+' : '−'}${Math.abs(unrealized).toFixed(2)}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Symbol summary */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
                        {symbols.sort((a, b) => Math.abs(symbolPnl[b].pnl) - Math.abs(symbolPnl[a].pnl)).map(sym => {
                          const s = symbolPnl[sym];
                          const isClosed = s.status === 'closed';
                          return (
                            <div key={sym} style={{ padding: 10, background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: `1px solid ${isClosed ? (s.pnl >= 0 ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)') : 'rgba(255,255,255,0.06)'}` }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                <span className="number-font" style={{ fontSize: 13, fontWeight: 600 }}>{sym}</span>
                                {!isClosed && <span style={{ fontSize: 9, color: '#a1a1aa', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 999 }}>OPEN</span>}
                              </div>
                              <div className="number-font" style={{ fontSize: 14, fontWeight: 600, color: isClosed ? (s.pnl >= 0 ? '#10b981' : '#ef4444') : '#71717a' }}>
                                {isClosed ? (s.pnl >= 0 ? '+' : '−') + '$' + Math.abs(s.pnl).toFixed(2) : `${s.qty > 0 ? '+' : ''}${s.qty}`}
                              </div>
                              <div style={{ fontSize: 10, color: '#52525b', marginTop: 2 }}>{s.trades} {s.trades === 1 ? 'fill' : 'fills'}</div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Detail table */}
                      <details>
                        <summary style={{ cursor: 'pointer', fontSize: 12, color: '#71717a', userSelect: 'none', padding: '6px 0' }}>
                          Show all {dayTrades.length} executions
                        </summary>
                        <div style={{ marginTop: 8, overflowX: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                              <tr style={{ color: '#52525b', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                                <th style={{ textAlign: 'left', padding: '8px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Time</th>
                                <th style={{ textAlign: 'left', padding: '8px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Symbol</th>
                                <th style={{ textAlign: 'left', padding: '8px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Side</th>
                                <th style={{ textAlign: 'right', padding: '8px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Qty</th>
                                <th style={{ textAlign: 'right', padding: '8px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Price</th>
                                <th style={{ textAlign: 'right', padding: '8px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Proceeds</th>
                                <th style={{ textAlign: 'right', padding: '8px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>Comm</th>
                              </tr>
                            </thead>
                            <tbody className="number-font">
                              {dayTrades.map(t => {
                                const isBuy = t.side.startsWith('BUY');
                                return (
                                  <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                    <td style={{ padding: '8px 8px', color: '#71717a' }}>{t.time}</td>
                                    <td style={{ padding: '8px 8px', fontWeight: 600 }}>{t.symbol}</td>
                                    <td style={{ padding: '8px 8px', color: isBuy ? '#6ee7b7' : '#fca5a5', fontSize: 11 }}>{t.side.replace('TOOPEN', ' OPEN').replace('TOCLOSE', ' CLOSE')}</td>
                                    <td style={{ padding: '8px 8px', textAlign: 'right' }}>{t.qty}</td>
                                    <td style={{ padding: '8px 8px', textAlign: 'right' }}>${t.price.toFixed(4)}</td>
                                    <td style={{ padding: '8px 8px', textAlign: 'right', color: t.proceeds >= 0 ? '#a1a1aa' : '#71717a' }}>${t.proceeds.toFixed(2)}</td>
                                    <td style={{ padding: '8px 8px', textAlign: 'right', color: '#52525b' }}>${t.commission.toFixed(4)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </div>
                  );
                })
              )}
            </div>
          );
        })()}

        {/* EARNINGS VIEW */}
        {view === 'earnings' && (() => {
          const grouped = {
            bmo: earningsData?.bmo || [],
            amc: earningsData?.amc || [],
            other: earningsData?.other || [],
          };
          const totalRows = grouped.bmo.length + grouped.amc.length + grouped.other.length;

          const shiftDate = (delta) => {
            const [y, m, d] = earningsDate.split('-').map(Number);
            const date = new Date(y, m - 1, d);
            date.setDate(date.getDate() + delta);
            const k = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            setEarningsDate(k);
            setEarningsData(null);
            fetchEarnings(k);
          };

          const importedSymbols = new Set(Object.values(allTrades).flat().map(t => t.symbol));

          const Section = ({ title, items, color, icon: Icon }) => {
            if (!items || items.length === 0) return null;

            // Helpers to parse values for sorting
            const parseMktCap = (v) => {
              if (v == null) return -Infinity;
              const s = String(v).replace(/[$,]/g, '');
              const m = s.match(/^([\d.]+)\s*([KMBT])?$/i);
              if (!m) return parseFloat(s) || -Infinity;
              const num = parseFloat(m[1]);
              const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
              return num * (mult[(m[2] || '').toUpperCase()] || 1);
            };
            const parseFloatNull = (v) => {
              if (v == null) return null;
              const n = parseFloat(v);
              return isNaN(n) ? null : n;
            };

            const sorted = [...items];
            if (earningsSort.column) {
              sorted.sort((a, b) => {
                let av, bv;
                switch (earningsSort.column) {
                  case 'symbol': av = (a.symbol || '').toUpperCase(); bv = (b.symbol || '').toUpperCase(); break;
                  case 'name': av = (a.name || '').toUpperCase(); bv = (b.name || '').toUpperCase(); break;
                  case 'mktcap': av = parseMktCap(a.marketCap); bv = parseMktCap(b.marketCap); break;
                  case 'lastPrice': av = parseFloatNull(a.lastPrice); bv = parseFloatNull(b.lastPrice); break;
                  case 'epsEst': av = parseFloatNull(a.epsEstimate); bv = parseFloatNull(b.epsEstimate); break;
                  case 'epsActual': av = parseFloatNull(a.epsActual); bv = parseFloatNull(b.epsActual); break;
                  case 'priceChange': av = parseFloatNull(a.priceChange); bv = parseFloatNull(b.priceChange); break;
                  default: return 0;
                }
                // Push nulls to the bottom
                if (av == null && bv == null) return 0;
                if (av == null) return 1;
                if (bv == null) return -1;
                if (av < bv) return earningsSort.dir === 'asc' ? -1 : 1;
                if (av > bv) return earningsSort.dir === 'asc' ? 1 : -1;
                return 0;
              });
            }

            const handleSort = (col) => {
              setEarningsSort(prev => {
                if (prev.column === col) {
                  return { column: col, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
                }
                return { column: col, dir: 'desc' };
              });
            };

            const SortHeader = ({ col, align = 'left', children }) => {
              const active = earningsSort.column === col;
              const arrow = active ? (earningsSort.dir === 'asc' ? '↑' : '↓') : '';
              return (
                <th
                  onClick={() => handleSort(col)}
                  style={{
                    textAlign: align,
                    padding: '8px 8px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    cursor: 'pointer',
                    userSelect: 'none',
                    color: active ? '#93c5fd' : '#52525b',
                    transition: 'color 0.15s',
                  }}
                >
                  {children} {arrow && <span style={{ fontSize: 10 }}>{arrow}</span>}
                </th>
              );
            };

            return (
              <div className="card">
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Icon size={16} color={color} />
                  {title}
                  <span className="number-font" style={{ marginLeft: 'auto', fontSize: 12, color: '#71717a', fontWeight: 500 }}>{items.length}</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                        <SortHeader col="symbol">Symbol</SortHeader>
                        <SortHeader col="name">Company</SortHeader>
                        <SortHeader col="mktcap" align="right">Mkt Cap</SortHeader>
                        <SortHeader col="lastPrice" align="right">Last Price</SortHeader>
                        <SortHeader col="priceChange" align="right">% Chg</SortHeader>
                        <SortHeader col="epsEst" align="right">EPS Est</SortHeader>
                        <SortHeader col="epsActual" align="right">EPS Actual</SortHeader>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((r, i) => {
                        const traded = importedSymbols.has(r.symbol);
                        const epsBeat = r.epsActual != null && r.epsEstimate != null && parseFloat(r.epsActual) > parseFloat(r.epsEstimate);
                        const epsMiss = r.epsActual != null && r.epsEstimate != null && parseFloat(r.epsActual) < parseFloat(r.epsEstimate);
                        const pcNum = parseFloat(r.priceChange);
                        const hasPc = !isNaN(pcNum);
                        const lpNum = parseFloat(r.lastPrice);
                        const hasLp = !isNaN(lpNum);
                        return (
                          <tr key={(r.symbol || '') + i} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', background: traded ? 'rgba(59, 130, 246, 0.04)' : 'transparent' }}>
                            <td style={{ padding: '10px 8px' }}>
                              <span className="number-font" style={{ fontWeight: 700, color: traded ? '#93c5fd' : '#e4e4e7' }}>{r.symbol}</span>
                              {traded && <span style={{ marginLeft: 6, fontSize: 9, color: '#93c5fd', background: 'rgba(59,130,246,0.15)', padding: '1px 6px', borderRadius: 999 }}>TRADED</span>}
                            </td>
                            <td style={{ padding: '10px 8px', color: '#a1a1aa', fontSize: 12 }}>{r.name || '—'}</td>
                            <td style={{ padding: '10px 8px', textAlign: 'right', color: '#a1a1aa' }} className="number-font">{r.marketCap || '—'}</td>
                            <td style={{ padding: '10px 8px', textAlign: 'right', color: '#e4e4e7' }} className="number-font">
                              {hasLp ? `$${lpNum.toFixed(2)}` : '—'}
                            </td>
                            <td style={{ padding: '10px 8px', textAlign: 'right', color: hasPc ? (pcNum >= 0 ? '#10b981' : '#ef4444') : '#71717a', fontWeight: hasPc ? 600 : 400 }} className="number-font">
                              {hasPc ? `${pcNum >= 0 ? '+' : ''}${pcNum.toFixed(2)}%` : '—'}
                            </td>
                            <td style={{ padding: '10px 8px', textAlign: 'right', color: '#a1a1aa' }} className="number-font">{r.epsEstimate != null ? r.epsEstimate : '—'}</td>
                            <td style={{ padding: '10px 8px', textAlign: 'right', color: epsBeat ? '#10b981' : epsMiss ? '#ef4444' : '#71717a', fontWeight: 600 }} className="number-font">
                              {r.epsActual != null ? r.epsActual : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          };

          const isToday = earningsDate === todayKey();

          return (
            <div className="fade-in" style={{ display: 'grid', gap: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <h2 className="number-font" style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>Earnings Calendar</h2>
                  <div style={{ fontSize: 13, color: '#71717a', marginTop: 4 }}>
                    {formatDate(earningsDate)}{totalRows > 0 ? ` · ${totalRows} ${totalRows === 1 ? 'release' : 'releases'}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="nav-btn" onClick={() => shiftDate(-1)} disabled={earningsLoading}><ChevronLeft size={16} /></button>
                  <button className="nav-btn" onClick={() => { setEarningsDate(todayKey()); setEarningsData(null); fetchEarnings(todayKey()); }} disabled={isToday || earningsLoading} style={{ opacity: (isToday || earningsLoading) ? 0.5 : 1 }}>Today</button>
                  <button className="nav-btn" onClick={() => shiftDate(1)} disabled={earningsLoading}><ChevronRight size={16} /></button>
                  <button className="nav-btn" onClick={() => fetchEarnings(earningsDate)} disabled={earningsLoading} title="Refresh">↻</button>
                </div>
              </div>

              {earningsLoading && (
                <div className="card" style={{ textAlign: 'center', padding: 60 }}>
                  <div style={{ fontSize: 14, color: '#a1a1aa', marginBottom: 6 }}>Searching the web for earnings releases…</div>
                  <div style={{ fontSize: 12, color: '#52525b' }}>This usually takes 5–15 seconds</div>
                </div>
              )}

              {earningsError && (
                <div className="card" style={{ textAlign: 'center', padding: 40, borderColor: 'rgba(239,68,68,0.3)' }}>
                  <AlertTriangle size={24} color="#ef4444" style={{ marginBottom: 8 }} />
                  <div style={{ fontSize: 14, color: '#fca5a5', marginBottom: 12 }}>{earningsError}</div>
                  <button className="nav-btn" onClick={() => fetchEarnings(earningsDate)}>Retry</button>
                </div>
              )}

              {!earningsLoading && !earningsError && totalRows === 0 && earningsData && (
                <div className="card" style={{ textAlign: 'center', padding: 60 }}>
                  <div style={{ fontSize: 14, color: '#a1a1aa', marginBottom: 4 }}>No earnings releases found for this date</div>
                  <div style={{ fontSize: 13, color: '#52525b' }}>Markets may be closed or no companies are reporting.</div>
                </div>
              )}

              {!earningsLoading && !earningsError && totalRows > 0 && (
                <>
                  <Section title="Before Market Open" items={grouped.bmo} color="#eab308" icon={Sparkles} />
                  <Section title="After Market Close" items={grouped.amc} color="#8b5cf6" icon={Moon} />
                  <Section title="Time Not Specified" items={grouped.other} color="#71717a" icon={AlertCircle} />
                  <div style={{ fontSize: 11, color: '#52525b', textAlign: 'center', marginTop: 8 }}>
                    Data sourced via web search · accuracy may vary, verify with primary sources before trading
                  </div>
                </>
              )}
            </div>
          );
        })()}

        {/* ECONOMIC CALENDAR VIEW */}
        {view === 'economic' && (
          <div className="fade-in" style={{ display: 'grid', gap: 20 }}>
            <h2 className="number-font" style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>Economic Calendar</h2>
            
            {/* High Impact Events */}
            <div className="card" style={{ borderLeft: '3px solid #ef4444' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>8:30 AM - Initial Jobless Claims</span>
                <span style={{ fontSize: 10, color: '#ef4444' }}>★★★ High</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: '#52525b', marginBottom: 4 }}>FORECAST</div>
                  <div className="number-font" style={{ fontSize: 14, fontWeight: 600, color: '#a1a1aa' }}>215K</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#52525b', marginBottom: 4 }}>PREVIOUS</div>
                  <div className="number-font" style={{ fontSize: 14, fontWeight: 600, color: '#71717a' }}>208K</div>
                </div>
              </div>
            </div>

            <div className="card" style={{ borderLeft: '3px solid #ef4444' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>1:00 PM - Fed Chair Powell Speaks</span>
                <span style={{ fontSize: 10, color: '#ef4444' }}>★★★ High</span>
              </div>
              <div style={{ fontSize: 13, color: '#a1a1aa' }}>Market-moving speech on monetary policy and economic outlook</div>
            </div>

            {/* Medium Impact Events */}
            <div className="card" style={{ borderLeft: '3px solid #eab308' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>8:30 AM - Trade Balance</span>
                <span style={{ fontSize: 10, color: '#eab308' }}>★★ Medium</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: '#52525b', marginBottom: 4 }}>FORECAST</div>
                  <div className="number-font" style={{ fontSize: 14, fontWeight: 600, color: '#a1a1aa' }}>-$65.0B</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#52525b', marginBottom: 4 }}>PREVIOUS</div>
                  <div className="number-font" style={{ fontSize: 14, fontWeight: 600, color: '#71717a' }}>-$68.9B</div>
                </div>
              </div>
            </div>

            {/* Low Impact Events */}
            <div className="card" style={{ borderLeft: '3px solid #71717a' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>10:30 AM - Natural Gas Storage</span>
                <span style={{ fontSize: 10, color: '#71717a' }}>★ Low</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: '#52525b', marginBottom: 4 }}>PREVIOUS</div>
                  <div className="number-font" style={{ fontSize: 14, fontWeight: 600, color: '#71717a' }}>31B</div>
                </div>
              </div>
            </div>

            <div className="card" style={{ borderLeft: '3px solid #71717a' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>11:30 AM - 4-Week Bill Auction</span>
                <span style={{ fontSize: 10, color: '#71717a' }}>★ Low</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 10, color: '#52525b', marginBottom: 4 }}>PREVIOUS</div>
                  <div className="number-font" style={{ fontSize: 14, fontWeight: 600, color: '#71717a' }}>4.89%</div>
                </div>
              </div>
            </div>

            {/* Mockup Notice */}
            <div className="card" style={{ background: 'rgba(59, 130, 246, 0.05)', borderColor: 'rgba(59, 130, 246, 0.2)', textAlign: 'center', padding: 20 }}>
              <div style={{ fontSize: 12, color: '#60a5fa' }}>
                📋 Design mockup with sample data for May 7, 2026 · Real integration coming later
              </div>
            </div>
          </div>
        )}

        {/* RECAPS VIEW */}
        {view === 'recaps' && (() => {
          const getWeekDates = (startDate) => {
            const start = new Date(startDate);
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            return { start, end };
          };

          const getMonthDates = (monthDate) => {
            const start = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
            const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
            return { start, end };
          };

          const getEntriesInRange = (start, end) => {
            return Object.entries(allEntries).filter(([key]) => {
              const [y, m, d] = key.split('-').map(Number);
              const date = new Date(y, m - 1, d);
              return date >= start && date <= end;
            }).map(([, entry]) => entry);
          };

          const calculateStats = (entries) => {
            if (entries.length === 0) return null;
            const metrics = entries.map(e => e.metrics || {});
            const avgSleep = (metrics.reduce((sum, m) => sum + (m.sleep || 0), 0) / metrics.length).toFixed(1);
            const avgEnergy = (metrics.reduce((sum, m) => sum + (m.energy || 0), 0) / metrics.length).toFixed(1);
            const avgFocus = (metrics.reduce((sum, m) => sum + (m.focus || 0), 0) / metrics.length).toFixed(1);
            const avgMood = (metrics.reduce((sum, m) => sum + (m.mood || 0), 0) / metrics.length).toFixed(1);
            const avgStress = (metrics.reduce((sum, m) => sum + (m.stress || 0), 0) / metrics.length).toFixed(1);
            const meditationCount = metrics.filter(m => m.meditation).length;
            const totalPnL = entries.reduce((sum, e) => {
              const pnl = parseFloat(e.pnl) || 0;
              return sum + pnl;
            }, 0);
            return { avgSleep, avgEnergy, avgFocus, avgMood, avgStress, meditationCount, totalDays: entries.length, totalPnL: totalPnL.toFixed(2) };
          };

          const weekDates = getWeekDates(recapWeekStart);
          const monthDates = getMonthDates(recapMonth);
          const weekEntries = getEntriesInRange(weekDates.start, weekDates.end);
          const monthEntries = getEntriesInRange(monthDates.start, monthDates.end);
          const weekStats = calculateStats(weekEntries);
          const monthStats = calculateStats(monthEntries);

          const weekKey = `recap-week-${recapWeekStart.getFullYear()}-${recapWeekStart.getMonth()}-${recapWeekStart.getDate()}`;
          const monthKey = `recap-month-${recapMonth.getFullYear()}-${recapMonth.getMonth()}`;

          const shiftWeek = (delta) => {
            const newDate = new Date(recapWeekStart);
            newDate.setDate(newDate.getDate() + (delta * 7));
            setRecapWeekStart(newDate);
          };

          const shiftMonth = (delta) => {
            const newDate = new Date(recapMonth);
            newDate.setMonth(newDate.getMonth() + delta);
            setRecapMonth(newDate);
          };

          const formatWeekRange = () => {
            const end = new Date(weekDates.end);
            return `${weekDates.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
          };

          const formatMonth = () => {
            return recapMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
          };

          const StatCard = ({ title, stats, period }) => {
            if (!stats) return <div className="card" style={{ textAlign: 'center', color: '#71717a' }}>No data for this {period}</div>;
            
            const pnlColor = parseFloat(stats.totalPnL) >= 0 ? '#10b981' : '#ef4444';
            const pnlSign = parseFloat(stats.totalPnL) >= 0 ? '+' : '';
            
            return (
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0, color: '#e4e4e7' }}>{title}</h3>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: '#52525b', marginBottom: 4, textTransform: 'uppercase' }}>P&L</div>
                    <div className="number-font" style={{ fontSize: 20, fontWeight: 600, color: pnlColor }}>{pnlSign}${stats.totalPnL}</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16, marginBottom: 20 }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#52525b', marginBottom: 8, textTransform: 'uppercase' }}>Sleep</div>
                    <div className="number-font" style={{ fontSize: 18, fontWeight: 600, color: '#10b981' }}>{stats.avgSleep}/10</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#52525b', marginBottom: 8, textTransform: 'uppercase' }}>Energy</div>
                    <div className="number-font" style={{ fontSize: 18, fontWeight: 600, color: '#3b82f6' }}>{stats.avgEnergy}/10</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#52525b', marginBottom: 8, textTransform: 'uppercase' }}>Focus</div>
                    <div className="number-font" style={{ fontSize: 18, fontWeight: 600, color: '#8b5cf6' }}>{stats.avgFocus}/10</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#52525b', marginBottom: 8, textTransform: 'uppercase' }}>Mood</div>
                    <div className="number-font" style={{ fontSize: 18, fontWeight: 600, color: '#ec4899' }}>{stats.avgMood}/10</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#52525b', marginBottom: 8, textTransform: 'uppercase' }}>Stress</div>
                    <div className="number-font" style={{ fontSize: 18, fontWeight: 600, color: '#ef4444' }}>{stats.avgStress}/10</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#52525b', marginBottom: 8, textTransform: 'uppercase' }}>Meditations</div>
                    <div className="number-font" style={{ fontSize: 20, fontWeight: 600, color: '#a78bfa' }}>{stats.meditationCount} 🧘</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: '#52525b', marginBottom: 8, textTransform: 'uppercase' }}>Days Tracked</div>
                    <div className="number-font" style={{ fontSize: 20, fontWeight: 600, color: '#71717a' }}>{stats.totalDays}</div>
                  </div>
                </div>
              </div>
            );
          };

          return (
            <div className="fade-in" style={{ display: 'grid', gap: 20 }}>
              <h2 className="number-font" style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: '-0.02em' }}>Weekly & Monthly Recaps</h2>

              {/* Week Navigation */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, color: '#71717a', marginBottom: 4 }}>WEEK</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#e4e4e7' }}>{formatWeekRange()}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="nav-btn" onClick={() => shiftWeek(-1)}><ChevronLeft size={16} /></button>
                  <button className="nav-btn" onClick={() => setRecapWeekStart(new Date())}>This Week</button>
                  <button className="nav-btn" onClick={() => shiftWeek(1)}><ChevronRight size={16} /></button>
                </div>
              </div>

              <StatCard title="Weekly Stats" stats={weekStats} period="week" />

              {/* Month Navigation */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 }}>
                <div>
                  <div style={{ fontSize: 12, color: '#71717a', marginBottom: 4 }}>MONTH</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#e4e4e7' }}>{formatMonth()}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="nav-btn" onClick={() => shiftMonth(-1)}><ChevronLeft size={16} /></button>
                  <button className="nav-btn" onClick={() => setRecapMonth(new Date())}>This Month</button>
                  <button className="nav-btn" onClick={() => shiftMonth(1)}><ChevronRight size={16} /></button>
                </div>
              </div>

              <StatCard title="Monthly Stats" stats={monthStats} period="month" />

              {weekStats && (
                <div className="card" style={{ background: 'rgba(139, 92, 246, 0.05)', borderColor: 'rgba(139, 92, 246, 0.2)', textAlign: 'center', padding: 20 }}>
                  <div style={{ fontSize: 13, color: '#c4b5fd' }}>
                    {weekStats.meditationCount === 0 && "🎯 Challenge yourself: try meditating this week!"}
                    {weekStats.meditationCount === weekStats.totalDays && "🏆 Perfect meditation streak this week!"}
                    {weekStats.meditationCount > 0 && weekStats.meditationCount < weekStats.totalDays && `✨ ${weekStats.meditationCount}/${weekStats.totalDays} days meditated — keep it up!`}
                  </div>
                </div>
              )}

              {/* Weekly Journal Entry */}
              <div className="card">
                <div style={{ fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 14 }}>Weekly Journal Entry ({formatWeekRange()})</div>
                <textarea
                  placeholder="What did you learn this week? Wins, challenges, patterns…"
                  value={weeklyRecap}
                  onChange={(e) => setWeeklyRecap(e.target.value)}
                  style={{ minHeight: 120, marginBottom: 12 }}
                />
                <button
                  onClick={() => {
                    window.storage?.set(weekKey, weeklyRecap);
                  }}
                  style={{ padding: '10px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
                >
                  Save Weekly Entry
                </button>
              </div>

              {/* Monthly Journal Entry */}
              <div className="card">
                <div style={{ fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#71717a', marginBottom: 14 }}>Monthly Journal Entry ({formatMonth()})</div>
                <textarea
                  placeholder="Month in review: progress, goals achieved, areas to improve…"
                  value={monthlyRecap}
                  onChange={(e) => setMonthlyRecap(e.target.value)}
                  style={{ minHeight: 120, marginBottom: 12 }}
                />
                <button
                  onClick={() => {
                    window.storage?.set(monthKey, monthlyRecap);
                  }}
                  style={{ padding: '10px 20px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
                >
                  Save Monthly Entry
                </button>
              </div>
            </div>
          );
        })()}

        {/* Save bar */}
        {(view === 'checkin' || view === 'journal') && (
          <div style={{ position: 'sticky', bottom: 20, marginTop: 32, display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center' }}>
            {savedFlash && (
              <div className="fade-in" style={{ fontSize: 13, color: '#6ee7b7', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} /> Saved
              </div>
            )}
            {entry.savedAt && !savedFlash && (
              <div style={{ fontSize: 12, color: '#52525b' }}>Last saved {new Date(entry.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
            )}
            <button className="save-btn" onClick={saveEntry} disabled={saving}>
              <Save size={16} /> {saving ? 'Saving…' : 'Save Entry'}
            </button>
          </div>
        )}
        </main>
      </div>
    </div>
  );
}
