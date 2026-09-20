# 钱 Qiǎn — expense ledger + finance dashboard

Two static pages backed by one Google Sheet, served from GitHub Pages.

| File | What it is |
|---|---|
| `index.html` | The expense tracker (New Entry / Monthly Summary / Budget) |
| `dashboard.html` | Finance Overview + Update Position |
| `assets/app.css` | All styling for both pages |
| `assets/util.js` | Date, month and money helpers |
| `assets/api.js` | **The one file you configure** — API URL + passphrase gate |
| `assets/chart.js` | The SVG line chart (no external chart library) |
| `assets/ledger.js` | Logic for `index.html` |
| `assets/dashboard.js` | Logic for `dashboard.html` |
| `Code.gs` | The Google Apps Script backend |

Plain `<script src>` tags, no build step, no npm, no bundler. Drop the folder
into a repo and GitHub Pages serves it as-is.

---

## 1. Set up the backend

1. Open your existing Qiǎn Google Sheet → **Extensions → Apps Script**.
2. Replace the contents of `Code.gs` with the `Code.gs` in this folder and save.
3. **Project Settings → Script Properties → Add script property**
   - Property: `AUTH_TOKEN`
   - Value: a long random string. Generate one in a terminal with
     `openssl rand -base64 24`. This is the passphrase the pages will ask for.
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Copy the `/exec` URL.
5. Open `assets/api.js` and paste it in:
   ```js
   const API_URL = "https://script.google.com/macros/s/AKfy.../exec";
   ```

The `Positions` tab is created automatically the first time the script runs.

> **Rotate your old URL.** The deployment URL currently baked into your existing
> `index.html` has been shared in plain text and is unauthenticated. After step 4,
> use **Deploy → Manage deployments → Archive** on the old one so it stops
> answering.

### Why "Anyone" is still safe here

Apps Script has no per-user auth for a web app you call from a browser, so the
endpoint has to accept anonymous requests. `AUTH_TOKEN` is what actually gates
it: every request carries the passphrase, and without it the script returns
`{"status":"unauthorized"}` and no data.

While `AUTH_TOKEN` is unset the API stays open, so you cannot lock yourself out
mid-setup. **Set it before you push anything public.**

---

## 2. Publish to GitHub Pages

```bash
git init
git add .
git commit -m "Qian ledger + finance dashboard"
git branch -M main
git remote add origin git@github.com:<you>/<repo>.git
git push -u origin main
```

Then **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
A minute later the site is at `https://<you>.github.io/<repo>/`.

Note that a GitHub Pages site is **public to the internet regardless of whether
the repo is private** — restricting who can view a Pages site is an Enterprise
Cloud feature. That's exactly why the passphrase gate exists. What a stranger
finds at your URL is an empty shell and a prompt.

### On your phone

Open the URL in Safari or Chrome → Share → **Add to Home Screen**. It launches
without browser chrome and remembers the passphrase, so it behaves like an app.
You'll be asked for the passphrase once per device.

---

## 3. How the dashboard numbers are worked out

**Current net savings** — the sum of every account typed `Savings` in your most
recent snapshot.

**The savings line chart** — one point per month, each the *average* of the
savings totals across the snapshots you took that month. Months with no snapshot
are left out rather than drawn as zero: a missing reading means you didn't check,
not that the money vanished.

**Monthly spending** — the sum of expenses per calendar month. Here a gap month
*is* drawn as zero, because the tracker is used continuously, so no entries
genuinely means nothing was rung up. (The two charts differ deliberately.)

**The current month's spending point is partial** — it only covers the days
elapsed so far, which is why the card also shows how much of the month has gone.

**Net worth** — savings + investments at the latest snapshot.

A snapshot is the whole picture on one date. Saving the same date twice replaces
it rather than appending duplicates, so correcting a figure leaves no mess in
the Sheet.

---

## 4. Running it locally

Because the pages use plain `<script src>` rather than ES modules, you can open
`index.html` straight off disk. For a closer match to production:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

Leaving `API_URL` as `PASTE_YOUR_URL_HERE` puts both pages in **demo mode**,
where everything is stored in `localStorage` and nothing touches the Sheet.
Useful for trying layout changes against throwaway data.

---

## 5. Security, honestly

The passphrase is a **bearer token over HTTPS**. It is a real improvement over
an open endpoint, and it is not bank-grade:

- Anyone who learns the passphrase has full read/write access. Treat it like a
  password and don't reuse one.
- It is stored in `localStorage` on each device you unlock. "Forget passphrase
  on this device" at the foot of the dashboard clears it.
- There is no rate limiting, so pick a passphrase long enough that guessing is
  hopeless — the `openssl rand` one above is.
- Your data still lives in Google Sheets. This protects the *endpoint*, not the
  Sheet itself.

If you later want the data off Google entirely, the split in `assets/api.js` is
the seam: swap that one file for something talking to a local server and neither
page needs to change.

---

## 6. Deliberate non-features

- **No dark mode.** The ledger-paper look is light by design. Adding one means
  a second set of validated chart colours, not just inverting.
- **No offline cache.** With the phone out of signal the pages show nothing.
  A service worker holding the last response would fix this.
- **No currency handling.** Everything is formatted as `$`; amounts are assumed
  to be in one currency.
- **Savings vs Investments only.** If you want CPF, property or liabilities as
  their own buckets, add them to `normalizeType_` in `Code.gs` and to the
  `<select>` options in `rowHTML()` in `assets/dashboard.js`.
