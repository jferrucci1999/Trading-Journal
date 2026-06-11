# Trading Journal App (v2.0)

Personal trading journal with morning check-ins, analytics, weekly/monthly recaps, earnings calendar, and trade tracking.

## Latest Features

✅ Morning Check-in (sleep, energy, focus, mood, stress, caffeine, meditation)
✅ Journal Entry (P&L, reflection, tags)
✅ Weekly & Monthly Recaps (with P&L, stats, journal entries, navigation)
✅ Calendar View (navigate dates)
✅ Analytics Dashboard
✅ Trade Log (IB .tlg import)
✅ Earnings Calendar
✅ Economic Calendar (mockup)
✅ Local data persistence (browser storage)

## Quick Start

```bash
npm install
npm run dev
# Visit http://localhost:3000
```

## Deploy to Vercel

1. Push to GitHub: `git push origin main`
2. Go to https://vercel.com/new
3. Import your GitHub repo
4. Click "Deploy"
5. Your app is live!

## Data Storage

All entries save locally in your browser (IndexedDB via window.storage).

## Features

### Morning Check-in
- 6 metric sliders (sleep, energy, focus, mood, stress, caffeine)
- Meditation checkbox
- Today's Intention & Focus textarea

### Journal Entry
- P&L tracking
- Reflection notes
- Mood tags
- Screenshots

### Weekly & Monthly Recaps
- Navigate to any week/month
- View average metrics (sleep, energy, focus, mood, stress)
- See meditation count
- Total P&L for the period
- Write weekly/monthly journal entries
- Each week/month has separate entries

### Analytics
- Comprehensive trading stats
- P&L tracking
- Performance metrics

## Mobile

Add to home screen:
- **iOS:** Share → "Add to Home Screen"
- **Android:** Menu → "Install app"

## Commands

```bash
npm run dev       # Local development
npm run build     # Production build
npm start         # Start production server
```

---

Built with React, Next.js, Lucide Icons
