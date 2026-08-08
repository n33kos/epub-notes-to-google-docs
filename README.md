# KOReader beta-reading notes → Google Docs

Tools for turning KOReader annotations into comments on a Google Doc you have
**comment access** to. The book's text is only ever parsed locally and sent to
*your* Google Doc — never to any AI or third-party service.

There are two tools, for two situations:

| | `koreader-checklist.html` (desktop) | `mobile/` PWA (phone, away from computer) |
|---|---|---|
| Comment type | **Anchored** (you paste by hand) | **Unanchored**, quotes the passage |
| Effort | A few clicks per note | One tap per note |
| Needs | Just a browser | Google Cloud OAuth ID + hosting, one time |
| Best for | Final pass at home | Leaving reviews while traveling |

Why unanchored on mobile: Google has no API to anchor a comment to a text range
(the internal "kix" anchor format is undocumented and the doc renders to a
canvas), so from a phone the only automatic option is an unanchored comment. We
attach the highlighted passage as the comment's **quoted text** plus the chapter,
so each one is unmistakable.

---

## Tool 1 — Desktop checklist (anchored, manual)

Open `koreader-checklist.html`, drop in your `metadata.epub.lua`, and work the
cards: copy passage → Find in the doc → select → Insert comment → copy comment →
paste. Progress is saved per book. See comments in that file for details.

---

## Tool 2 — Mobile PWA (phone + Kindle, no computer)

End-to-end flow while traveling:

1. **Phone hotspot on**, Kindle joins it (the Kindle needs no real internet —
   just the local link to your phone).
2. In KOReader, **start Kodashboard** and open its address in Safari.
3. **Download the highlights JSON** from the dashboard (Files app).
4. Turn the hotspot off, reconnect the phone to the internet.
5. Open the **Beta Notes** PWA, **import** that JSON, **Connect Google**, and
   **Send** each note. Sent notes gray out; you can edit wording before sending.

The phased hotspot-then-internet order matters because an HTTPS page can't read
the Kindle's plain-HTTP server directly (browsers block "mixed content") — so we
hand the data across as a downloaded file instead of a live fetch.

### One-time setup

**A. Kindle — install Kodashboard**
1. Download `kodashboard.koplugin` from https://github.com/Yuchen971/Kodashboard
2. Copy the whole `kodashboard.koplugin` folder into `koreader/plugins/` on the
   Kindle (over USB, or via KOReader's SSH plugin over Wi-Fi — no cable needed).
3. Restart KOReader. A **KoDashboard** entry appears in the menu; "Start
   dashboard server" shows a `http://192.168.x.x:8686` address (and a QR code).

**B. Google — create an OAuth Client ID** (so the phone can post comments)
1. https://console.cloud.google.com → create a project.
2. **APIs & Services → Enable APIs** → enable **Google Drive API**.
3. **OAuth consent screen** → External → add your own Google account under **Test
   users**. (Leave it in *Testing*.)
4. **Credentials → Create credentials → OAuth client ID → Web application.**
   Under **Authorized JavaScript origins** add your PWA's origin, e.g.
   `https://YOURNAME.github.io`. Save and copy the **Client ID**.

**C. Host the PWA** (nothing personal is in the code — client ID and doc URL are
entered at runtime and stored only on your phone)
1. Put the contents of `mobile/` in a GitHub repo and enable **GitHub Pages**.
2. On your phone, open `https://YOURNAME.github.io/REPO/`, then **Share → Add to
   Home Screen**. After that it launches offline from the phone.
3. First launch: tap ⚙︎, paste your **Client ID** and the **Google Doc URL**,
   Save.

### Notes & gotchas
- First "Connect Google" shows an *"unverified app"* screen (it's your own
  project) — tap **Advanced → Go to (app)** and allow. Later connects are quick.
- In *Testing* mode the login can lapse after inactivity; just tap Connect again.
- iOS may evict an installed PWA's cache after ~1 week idle — if that happens,
  reopen the URL once while online to refresh it.
- The KOReader "file it under the previous chapter" habit isn't auto-corrected
  here (that needed a custom plugin); just tweak those few in the editable box
  before sending.
- Kodashboard's JSON field names are mapped tolerantly; the importer also still
  accepts a raw `metadata.epub.lua` if you get one onto the phone another way.
