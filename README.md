# Tapline — song breakdown

Play a song once. Tap where it turns. Build the breakdown as you listen — no DAW, no timeline to fight.

**Live app → https://crystlbat.github.io/song_decomposer/**

It is one self-contained `index.html`. No build, no server, no account. Everything is stored on the device, and Drive sync is optional.

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
- **Inbox** — what a pull brought in (see below).
- **Sync log** — every network request, kept across reloads, for when sync itself is the question.

## Live notes

Hit **Live notes** and the song plays while you type. Each note lands in the section that's playing. `enter` places it, `tab` switches track, `esc` stops.

---

## Drive sync (optional)

Sync is **manual by design** — nothing transfers on a timer or in the background. You **Pull** when you want the other device's work and **Push** when you want to hand yours over. The toolbar shows `unpushed` when local work hasn't gone up.

Your scenes live in a single file (`tapline-state.json`) in your own Google Drive, reached through a Google Apps Script web app. No sign-in, no API keys.

### Setting it up

1. Open **script.google.com** → *New project*.
2. Delete the placeholder, paste the code from the app (**Scenes → Connect Drive → "Where do I get that URL?" → Copy the code**), and save.
3. **Deploy → New deployment → Web app.** Execute as *Me*, access *Anyone*. Authorise it.
4. Copy the `/exec` URL it gives you.
5. Paste that URL into **Scenes → Connect Drive** on the first device.

### Pairing the rest (don't retype that URL)

Typing a 120-character URL into a phone is miserable, so you only ever do it once. On the linked device open **Scenes → Connect Drive → Pair a device**: it shows a QR code and a one-tap link.

- **Phone / tablet** — point the camera at the QR. Tapline opens already linked.
- **Anything without a camera** — hit **Copy link**, send it to yourself, open it there.

The link carries the script id in its URL hash; the receiving device links itself and then wipes the hash from its address bar so the credential isn't left in history. It only accepts a genuine `script.google.com/macros/s/…/exec` target.

> [!WARNING]
> **Treat your `/exec` URL as a password.** The deployment runs as you with access set to *Anyone*, so anyone who has the URL can read and overwrite everything in your `tapline-state.json` — there is no second check. Don't commit it, paste it in an issue, or share it in a screenshot. If it leaks, open the Apps Script project and **Deploy → Manage deployments → Archive** the old deployment, then create a new one; the old URL stops working immediately.

There are two script variants in the app: a plain **text file** (smallest and fastest) or a **Google Sheet**, whose `notes` tab gives you one row per note to read in Sheets or Excel.

### The inbox

A pull doesn't just change numbers — it delivers. Each arrival shows up as an item you can open:

- **new** — a breakdown this device had never seen.
- **updated** — your copy was behind and has been brought up to date.
- **needs a look** — it changed in *both* places since the last sync. Your version is untouched; the copy that arrived is saved beside it as `<name> (received)` so you can compare and keep whichever is right.

Opening an item shows before → after counts for cuts, tracks and notes. Nothing is ever discarded to make a merge tidy.

---

## Your data

- Saved locally the moment you change anything, and flushed immediately when the tab is hidden or closed.
- **Rolling local backups** — the last 8 snapshots, independent of Drive. Recover with **⋯ → Restore backup**. A wipe can't push good snapshots out of the buffer.
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
