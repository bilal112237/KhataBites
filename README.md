# KhataBites — Modular Project Structure

## Directory Layout
```text
khatabites-project/
├── index.html                  # Main HTML layout & 5-page views
├── vercel.json                 # Vercel hosting configuration
├── README.md                   # Developer guide & deployment instructions
├── css/
│   ├── tailwind-config.js      # Colors, fonts, and Tailwind theme settings
│   └── styles.css              # Custom CSS rules and scrollbars
├── js/
│   ├── config.js               # Supabase URL, Anon Key, and global constants
│   ├── defaultData.js          # Default hostel friends, meals, and daily dining groups
│   ├── mathEngine.js           # Shared Pool + Solo Extras split formula & debt simplifier
│   └── app.js                  # UI rendering, 5-page router, modals, and event listeners
└── database/
    ├── supabase-quick-sync.sql # 7-line SQL script for instant multi-phone cloud sync
    └── supabase-relational.sql # Full relational PostgreSQL schema for future expansion
```

## Which File to Edit When Making Future Changes
- **Change Colors or Fonts**: Edit `css/tailwind-config.js` and `css/styles.css`.
- **Change Default Friends or Groups**: Edit `js/defaultData.js`.
- **Change Bill-Splitting Math**: Edit `js/mathEngine.js`.
- **Add Your Supabase Database Keys**: Paste your URL & Anon Key into `js/config.js` (or `HARDCODED_SUPABASE_URL` / `HARDCODED_SUPABASE_ANON_KEY` in `js/app.js`).
- **Edit Page HTML or Add a 6th Page**: Edit `index.html` and register the page in `switchToPage()` inside `js/app.js`.
