# 🕹️ AddGames

A community game platform where anyone can publish HTML/JS/CSS games and play them at a permanent URL.  
Games are stored in Supabase Storage and indexed in a Supabase Postgres table. Routing is handled by Netlify.

---

## Stack

| Layer     | Tech                          |
|-----------|-------------------------------|
| Frontend  | Vanilla HTML/CSS/JS           |
| Database  | Supabase Postgres             |
| Storage   | Supabase Storage (public CDN) |
| Hosting   | Netlify                       |
| Routing   | Netlify `_redirects`          |
| Realtime  | Supabase Realtime             |

---

## Deploy in 5 steps

### 1. Create a Supabase project
1. Go to [supabase.com](https://supabase.com) → New Project
2. Copy your **Project URL** and **anon public key** from `Settings → API`

### 2. Run the database migration
Open `supabase-setup.sql` and paste it into `Dashboard → SQL Editor → New Query` → Run.

This creates:
- `games` table with RLS (public read + insert)
- Realtime enabled on `games`
- `game-files` storage bucket (public)
- Storage policies for public read/upload

### 3. Configure credentials
Open `src/config.js` and replace:
```js
window.SUPABASE_URL  = 'https://YOUR_PROJECT_ID.supabase.co';
window.SUPABASE_ANON = 'YOUR_ANON_PUBLIC_KEY';
```

### 4. Deploy to Netlify
Option A — Netlify CLI:
```bash
npm i -g netlify-cli
netlify login
netlify deploy --dir . --prod
```

Option B — Drag & drop the folder at [app.netlify.com](https://app.netlify.com).

Option C — Connect your GitHub repo via the Netlify dashboard.

### 5. Done 🎉
Visit your site. Click **Add Game**, upload an HTML game or paste a GitHub repo URL.

---

## How routing works

```
addgames.netlify.app/           → index.html (game library)
addgames.netlify.app/minesweeper → public/game-player.html (iframe runner)
addgames.netlify.app/snake       → public/game-player.html
```

`_redirects` catches every slug and serves the player page.  
The player reads `location.pathname`, queries Supabase for the game record, and loads the `game_url` (Supabase Storage CDN URL) in a sandboxed iframe.

---

## Game requirements

**Upload:** Include an `index.html` at the root of your file selection. All assets (CSS, JS, images, sounds) must be uploaded together. CDN libraries loaded via `<script src="https://...">` work perfectly inside the sandbox.

**GitHub:** Repository must be public. The default branch is auto-detected. Point to a subdirectory if your game isn't at the repo root.

---

## Supabase Storage CORS

If you get CORS errors during GitHub import, go to:  
`Supabase Dashboard → Storage → game-files → Policies` and ensure the bucket is set to **Public**.

---

## File structure

```
addgames/
├── index.html           # Game library homepage
├── public/
│   └── game-player.html # Game runner (iframe)
├── src/
│   ├── config.js        # Supabase credentials ← edit this
│   └── app.js           # All platform logic
├── _redirects           # Netlify slug routing
├── netlify.toml         # Headers & build config
└── supabase-setup.sql   # DB + storage migration
```
