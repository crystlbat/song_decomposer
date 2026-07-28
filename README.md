# Tapline — song breakdown

Play a song once. Tap where it turns. Build the breakdown as you listen — no DAW, no timeline to fight.

**Live app → https://crystlbat.github.io/song_decomposer/**

It is one self-contained `index.html`. No build, no account. Everything is stored on the device, and sync is optional.

---

## The idea

Most tools make you scrub a waveform to find section boundaries. Tapline inverts that: you listen in real time and **tap** every time the song changes — a section break, a drop, a fill. Those taps become *cuts*, and the cuts become a timeline you hang notes on.

## The workflow it's built around

| Device | What you do |
|---|---|
| **Phone / small device** | Tap the cuts while the song plays, hit **Send** |
| **Laptop / tablet** | **Pull**, open the breakdown, type notes against each section |
| **Back to the phone** | **Pull**, listen again, add more cuts |

The same scene travels between them. Audio does not — load the same track on each device and the timeline lines up.

---

## Screens

- **Capture** — tap anywhere to start, every tap after that drops a cut. `⌫` undoes the last one, `esc` finishes.
- **Editor** — the timeline. Add tracks, drag cuts, write notes into sections. Type any letter to start a note on the armed track.
- **Send** — appears instead of the editor on small screens: cut count, name, one Send button. Toggle it manually with **Compact capture** in the ⋯ menu.
- **Scenes** — every breakdown, with rename / duplicate / export / history.
- **Sync** — its own screen: connect a database, pair a device, the endpoint code. Reached from **Sync** on the home screen or in the projects header.
- **Inbox** — what a pull brought in (see below).
- **Sync log** — every network request, kept across reloads, for when sync itself is the question.

## Live notes

Hit **Live notes** and the song plays while you type. Each note lands in the section that's playing. `enter` places it, `tab` switches track, `esc` stops.

---

## Sync (optional)

Sync is **manual by design** — nothing transfers on a timer or in the background. You **Pull** when you want the other device's work and **Push** when you want to hand yours over. The toolbar shows `unpushed` when local work hasn't gone up.

Your projects live in **your own MongoDB**, one document per project, keyed by the project id the app already generates — so a project stays the same document forever and two devices can never fork it into two rows.

The browser never touches the database. A connection string carries the database user and password in clear and cannot live in a page anyone can view, so the app only ever knows an **https address** and the key in it. Behind that address sits a small endpoint you deploy, and it is the only thing holding `MONGODB_URI`.

### Setting it up

1. Make a free cluster at **mongodb.com/atlas** → **Connect → Drivers** → copy the connection string. Under **Network Access**, allow `0.0.0.0/0` — a serverless function gets a different address on every call, so the key in step 3 is what actually guards this.
2. Copy the endpoint code from the app: **Sync → "Show me how to get that address" → Copy the code**.
3. Put it online with `MONGODB_URI` set to that connection string and `TAPLINE_KEY` set to a long random string you invent.
4. Paste the address it answers on, with `?key=` *that same key* on the end, into **Sync** on the first device.

Two host shapes ship in the app, same storage and same merge rule in both:

| | Where the code goes | Trade |
|---|---|---|
| **a netlify function** | `netlify/functions/tapline.js` in your site's repo, with `mongodb` in `package.json`. Env vars under *Site configuration → Environment variables*. Answers on `https://<site>.netlify.app/.netlify/functions/tapline` | Nothing to keep alive, free while idle; the first call after a quiet spell takes a second or two to wake |
| **a node server** | one `server.js`, `npm i mongodb`, on Render / Railway / Fly / your own box | Always warm, and it runs anywhere Node runs — including localhost while you try it out |

Both speak the same two calls: `GET` returns every project, `POST` merges what you send and returns the result. Newest edit of each project wins, server-side and locally.

### Pairing the rest (don't retype that address)

Typing an endpoint URL and its key into a phone is miserable, so you only ever do it once. On the connected device open **Sync → Pair a device**: it shows a QR code and a one-tap link.

- **Phone / tablet** — point the camera at the QR. Tapline opens already connected.
- **Anything without a camera** — hit **Copy link**, send it to yourself, open it there.

The link carries the whole address in its URL hash; the receiving device connects itself and then wipes the hash from its address bar so the credential isn't left in history.

> [!WARNING]
> **Treat your endpoint address as a password.** The key is in it, and that key is the only check the endpoint makes — anyone who has the address can read and overwrite every project in your database. Don't commit it, paste it in an issue, or share it in a screenshot. If it leaks, change `TAPLINE_KEY` on the host and reconnect your devices with the new address; the old one stops working immediately.
>
> Never paste the MongoDB connection string into the app. It belongs in `MONGODB_URI` on the server and nowhere else — the app refuses it by name if you try.

### The inbox

A pull doesn't just change numbers — it delivers. Each arrival shows up as an item you can open:

- **new** — a breakdown this device had never seen.
- **updated** — your copy was behind and has been brought up to date.
- **needs a look** — it changed in *both* places since the last sync. Your version is untouched; the copy that arrived is saved beside it as `<name> (received)` so you can compare and keep whichever is right.

Opening an item shows before → after counts for cuts, tracks and notes. Nothing is ever discarded to make a merge tidy.

---

## Your data

- Saved locally the moment you change anything, and flushed immediately when the tab is hidden or closed.
- **Rolling local backups** — the last 8 snapshots, independent of sync. Recover with **⋯ → Restore backup**. A wipe can't push good snapshots out of the buffer.
- **Export / import** — any scene to a `.tapline.json` file, or copy-paste it as text.
- **Export .csv** — one row per note, for a spreadsheet.
- Audio is never uploaded or stored; only cuts, layers, tracks and notes travel.

## Keyboard

| Key | Action |
|---|---|
| `space` | play / pause |
| `← →` | jump cut to cut |
| `↑ ↓` | change the armed track |
| *type* | start a note on the armed track |
| `enter` / `tab` / `esc` | place note / switch track / stop |
| `⇧M` | cut at the playhead |
| `⇧T` `⇧L` `⇧O` | add track / new layer / overlay |
| `del` | delete what's selected |
| `⌘Z` | undo the last delete |
| `+` `−` | zoom (or pinch on a tablet) |
| `?` | show all shortcuts |

## Running it yourself

Open `index.html` in a browser. That's the whole thing — no dependencies, no build step. To host it, serve that one file from anywhere static (this copy runs on GitHub Pages).
