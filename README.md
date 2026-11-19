# IELTS study app

A private, offline-first study app for the IELTS Academic test, in one place:

| Part | Where | What |
|---|---|---|
| **Test Centre** | `app/cbt/` | Computer-delivered-style practice for Cambridge IELTS 11–21: Listening, Reading, Writing, Speaking; marking, band scores, progress, mistakes |
| **Learn** | Test Centre → *Learn* | Band 9 model essays, Task 1 reports, topic bank, Speaking Part 1–3 answers, writing rules and phrases — read, practise (hidden key phrases), flash cards, *learnt* marks that sync |
| **Phone app** | `app/cbt/m.html` | The Test Centre and Learn laid out for a phone; works with no connection (PWA) |
| **Study Suite** | `app/` | Section-by-section path through *The Official Cambridge Guide to IELTS*, with its audio |
| **Anki decks** | `writing/` → `app/cbt/decks/` | The Learn material as spaced-repetition decks (Band 9: 717 cards, phrases: 192) |

> **Personal, non-commercial, educational use only. Third-party content belongs to its owners —
> read [Content, copyright and disclaimer](#content-copyright-and-disclaimer) before sharing anything.**

## Start

- Mac: double-click **`Start IELTS Suite.command`** → <http://localhost:8765> (Study Suite) and
  <http://localhost:8765/cbt/> (Test Centre). Progress is saved to `progress/`; nothing is committed or pushed by itself.
- Phone on the same Wi-Fi: **`Start IELTS for Phone.command`** (see `app/cbt/README.md`, "On a phone").

The source books and recordings are **not** in this repository (see `.gitignore`); put your own copies
next to the app as described in `app/README.md` and `app/cbt/README.md`.

## Layout

```
app/                 Study Suite (vanilla JS, no build step) + serve.py
app/cbt/             Test Centre + phone app; js/icons.js = Lucide icons (tools/icons.py)
app/cbt/data/        tests as JSON, learn.json (built from writing/)
app/tests/           browser smoke test, unit tests
writing/             Learn / Anki source: band9/*.md, cards.txt; build.py; content.py (format)
progress/            your progress (written by serve.py)
.github/workflows/   publish.yml (see Publish)
```

## Edit the Learn material / rebuild the decks

Edit `writing/band9/*.md` (`{chunk}` = key phrase, `[X]` = fill in, `Q:` = prompt, `Tip:` = note) or
`writing/cards.txt` (`front | back`, ` // ` = new line, `✗`/`✓` = wrong/right example), then:

```sh
pip install genanki           # once
python3 writing/build.py      # -> app/cbt/decks/*.apkg + app/cbt/data/learn.json
```

Re-importing a rebuilt deck updates the cards and keeps your review history (note IDs are stable).

## Tests

```sh
node --test app/tests/*.test.mjs                              # unit: merge (sync), icons, learn.json
python3 -m unittest discover -s writing -p 'test_*.py'          # content parser
IELTS_PROGRESS=/tmp/p python3 app/serve.py 8790 --no-browser &  # throw-away progress
node app/tests/smoke.mjs http://localhost:8790 [shots/]          # every screen, desktop + phone, in Chrome
```

The smoke test fails on a script error, a failed request, an emoji left in a page, a page that
scrolls sideways or stays empty, and checks the Learn interactions.

## Publish

`app/cbt/tools/static_site.py --publish` (on the Mac) builds the phone app with its recordings and page
pictures and pushes it to the `gh-pages` branch. GitHub Actions cannot do that part: the recordings
and pictures are not in git.

`.github/workflows/publish.yml` does the rest, only when you start it (Actions → Publish → Run
workflow, or `gh workflow run Publish`): runs the unit tests, builds the Anki decks and `learn.json`,
then copies the changed app code and the decks onto `gh-pages`, keeping the media already there.
A push to `main` publishes nothing by itself. Nothing is published if `gh-pages` does not exist yet — run the
Mac script once first.

## Content, copyright and disclaimer

**This repository is a personal study tool. It is not affiliated with, endorsed by or sponsored by
Cambridge University Press & Assessment, the British Council, IDP: IELTS Australia, or any author or
publisher named here.** *IELTS* is a registered trademark of its owners and is used only to describe
what the material is for.

- **Third-party content is not mine and is not licensed by this repository.** Test papers, recordings,
  transcripts, answer keys, page images and book text (*Cambridge IELTS 11–21*, *The Official Cambridge
  Guide to IELTS*, and any other book) remain the copyright of their original owners. All rights in
  them are theirs. Nothing here grants anyone a licence to them.
- **Use:** private, personal, educational, non-commercial study by someone who owns or has lawful
  access to the original material. Do not sell, redistribute, re-host or publish that material, or
  any part of this app that contains it.
- **Not included:** the source books, PDFs and recordings are kept out of git (`.gitignore`). Get them
  from the publisher or another lawful source.
- **Learn material** (`writing/`): written for this project as study notes and sample answers; the
  sample answers contain placeholder personal details. Short phrases common to IELTS teaching may
  appear in many books.
- **Rights holders:** if you believe something here infringes your rights, open an issue or contact the
  repository owner on GitHub and it will be removed promptly — no formal notice needed.
- **No warranty:** provided as is, without warranty of any kind; band scores shown are estimates, not
  official results. See [LICENSE.md](LICENSE.md).
