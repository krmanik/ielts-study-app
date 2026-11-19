# IELTS Test Centre — Cambridge IELTS 11–21 (Academic)

A computer-delivered-style IELTS practice environment for the 44 tests in Cambridge IELTS 11–21.
Open it from the Study Suite sidebar (**Test Centre**) or go straight to <http://localhost:8765/cbt/>
after starting `Start IELTS Suite.command`. Results are stored in the browser and saved to
`progress/` in git (see the Study Suite README). To carry on with the same tests and progress on a
phone, also with no connection, see **On a phone** below.

## What it does

- **Listening**: exam mode plays each part once, the screen follows the recording, then 2 minutes to
  check. Practice mode has pause / ±5 s / speed. Review mode shows the transcript with Q-markers.
- **Reading**: passage and questions side by side (draggable divider), real text you can select to
  **highlight** or add **notes** (also from the right-click menu), countdown that auto-submits in
  exam mode and flashes at 10 and 5 minutes. The start screen offers 60 (real exam), 50 or 40
  minutes to train reading speed; single passages get a third of that each.
- **Question types as on the real screen**: gaps you type into; radio lists for multiple choice and
  TRUE/FALSE/NOT GIVEN; tick boxes for "choose TWO"; boxes you fill by dragging an option in (or
  clicking and picking) for matching, headings and summaries with a word list.
- **Writing**: task prompt + chart, editor with word count (spell-check off), sample answers from the
  book afterwards, self-scoring on the 4 criteria, "Copy for AI feedback".
- **Speaking**: the browser's voice reads the examiner's questions, 1-minute Part 2 preparation and
  2-minute long turn, recordings saved locally and to `progress/recordings`, self-scoring.
- Auto-marking against hand-checked answer keys, band conversion, per-part and per-question-type
  breakdown, mistakes list, full mock test (L → R → W).
- **Band guide** on the results page and in review mode (★ Band scores): pick a band to see the
  correct answers it takes, the skill level and its description, and how far your target is.
- **Progress**: study-time calendar (heatmap), sections finished per week (exam vs practice mode),
  band over time with the change since your first result, and a grid of every test × skill.
- **Exam countdown** on the home page once an exam date is set, with the tests and sections left
  to finish 2 days before it and the pace that needs (choose how many tests the plan covers).
- **Full screen** (button top right, or "Start tests in full screen") hides the browser tabs and
  toolbars; Esc closes an open dialog first, then leaves full screen.
- Footer question navigator, review flags, text size and colour schemes under Settings.

## On a phone

`m.html` is the same Test Centre laid out for a phone: the same 44 tests, the same test screen and the
same progress. It can be kept on the phone and used with no connection.

There are two ways to get it onto the phone. Both give the same app; they differ in where the phone
fetches it from and how its progress meets the Mac's.

### From GitHub Pages (the phone needs only the internet)

```sh
python3 tools/mobile_audio.py            # once: the smaller recordings (media/m)
python3 tools/static_site.py --publish   # gather the app into ../../site and push it to the gh-pages branch
```

Then once on github.com: the repository → Settings → Pages → *Deploy from a branch* → `gh-pages`,
`/ (root)`. The phone opens `https://<user>.github.io/<repository>/`; add it to the home screen and
follow **Before you travel** as below. Run the second command again whenever the app or the tests change; after the first time only changed
files are uploaded (the folder keeps its own git store, `site/.git`, about 470 MB, for that).

- **What is published**: only what the phone screen needs — the app, the text of the 44 tests, the
  smaller recordings and the book pictures that questions show (464 files, about 540 MB). `main` cannot
  be published as it is: the recordings and pictures are not in git, and its two links to them
  (`app/audio`, `app/cbt/audio`) stop a Pages build. The branch holds one commit, replaced each time.
- **A Pages site is open to anyone who has the address**, also when the repository is private (which
  needs a paid GitHub plan for Pages). The pages ask search engines not to list them; that is all.
  The tests are Cambridge's copyrighted material: keep the address to yourself.
- **Progress goes through GitHub**, since the app there cannot reach the Mac. Every device reads and
  writes one file, `test-centre.json` on the branch `progress-sync`, and merges the others' work
  (`js/ghsync.js`). It is read when the app opens; it is written only when you press **Exchange now**
  (Settings → GitHub on the Mac, More → Exchange through GitHub now on the phone) — never by itself.
  GitHub refuses a write that was not based on the latest version, so the writer merges and tries again.
  - **The Mac needs nothing set up.** `serve.py` carries the file with git and the login git already
    has (`/api/gitsync`; it builds the commit with git's plumbing and never touches the working tree).
    It happens while the Test Centre is open on the Mac; Settings → GitHub shows the state. The Mac
    still saves to `progress/` as before.
  - **The app on Pages needs a token, once per browser**: github.com → Settings → Developer settings →
    Fine-grained tokens; access to this repository only; permission *Contents: Read and write*. Paste
    it under **More → GitHub**. Without it that browser simply keeps its own results (and *Send
    progress as a file* still works).
- Speaking recordings stay on the phone; the self-scores travel with the rest.
- "View original book pages" is hidden there: whole-page scans are not published.

### From the Mac, over your own Wi-Fi (nothing leaves the house)

**Set-up, once, at home** (phone and Mac on the same Wi-Fi):

1. On the Mac, double-click **`Start IELTS for Phone.command`** (instead of `Start IELTS Suite.command`).
   Its window shows an address like `https://192-168-1-20.local-ip.sh:8766/m` and an 8-character code.
   Both are also under **Settings → On your phone** in the Test Centre on the Mac.
2. On the phone, open the address and type the code (asked once).
3. Add it to the home screen (iPhone: Share → *Add to Home Screen*; Android: menu → *Install app*), then
   **open it from the new icon**. On an iPhone the icon keeps its own storage, apart from the Safari tab.
4. On the *Today* page, follow **Before you travel**: wait for "the app and all Reading and Writing text
   are on this phone", then save the tests whose Listening you want (a test is 11–16 MB; all 44 come to about 540 MB).

**Away from the Mac** everything works from the phone: Reading and Writing for all 44 tests, Listening
and book pictures for the tests you saved, Speaking with recording. Results stay on the phone.

**Back in reach of the Mac** (same Wi-Fi, the phone launcher running), open the app: it sends its results
to the Mac and takes in what was done there. The chip on *Today* says which it is — "In step with your
Mac" or "Saved on this phone". *More → Check with the Mac now* does it on demand.

The layout follows the width of the window. Under 860 px (a phone, a narrow tablet) it is what the
list below describes. Wider — a laptop opening the Pages address — the bar moves to the top, the pages
use columns, and the test screen is the Mac's: text and questions side by side with the divider.

What is different on a narrow screen:

- **One small step at a time.** *Today* offers the next unfinished part in each skill — one Listening
  part, one passage, one writing task — and the skill left alone longest comes first. A section counts
  towards the exam plan once all its parts are done, in one sitting or one by one.
- **Text or questions, not both.** The two panes become one, with a **Text | Questions** switch at the
  bottom left; a question number or an arrow leads to the questions. Matching opens a list from the
  bottom of the screen instead of drag and drop.
- The screen stays awake during a test; the footer steps aside while the keyboard is up.

How it works, and what to know:

- **Two devices, one progress.** `js/merge.js` folds the phone's copy and the Mac's together: attempts
  from both are kept, the same attempt changed on both keeps the later version, a deletion on one
  deletes on the other, study time is counted per device and added up. Exam date, target band, reading
  time and plan size follow you; text size, colours and the pane split stay with each device.
  `serve.py` gives the saved copy a revision number and refuses a save that was not based on the
  latest one (the sender merges and tries again), so neither side can overwrite the other unseen.
- **The address contains the Mac's Wi-Fi address.** If the router gives the Mac a different one, the
  window shows a new address and the icon on the phone can no longer find the Mac (it still works on
  its own). Either reserve the Mac's address in the router, or use the spare route: *More → Send
  progress as a file* on the phone, then **Import** under Settings on the Mac — it merges.
- **Why that odd address.** A phone only keeps a page for offline use if it came over HTTPS with a
  certificate it trusts. [local-ip.sh](https://local-ip.sh) publishes one for names that resolve to
  private addresses; `serve.py --phone` downloads it at start (into `app/.cert`, not in git). Its key
  is public, so it adds no secrecy — the phone code does that: without it nothing but the icon is
  served to other devices on the network. The code is in `app/.phone-key` (delete the file for a new
  one). Without `--phone` the server listens on this Mac only, as before.
- **Smaller recordings.** `python3 tools/mobile_audio.py` makes 48 kbit/s copies of the recordings in
  `media/m` (about a third of the size; needs ffmpeg) and `media/m/manifest.json` with the sizes. The
  phone uses them when they exist and the books' MP3s otherwise. Run it again after `build.py`
  changes the recordings.
- **Updates.** The phone looks for a newer version of the app when it is opened in reach of the Mac
  (at most hourly; *More → Look for an app update* forces it). `sw.js` finds the files to keep by
  following the imports from `js/m/main.js`, so a new module needs no list to be updated.
- Files: `m.html`, `css/m.css`, `js/m/` (pages around the test; `exam.js` there fits the unchanged
  test screen to a phone), `sw.js`, `manifest.webmanifest`, `icons/`.
- Not on the phone: the full mock test, full screen on an iPhone, and the Study Suite (the Official
  Guide), which is page images of a book and stays on the Mac.
- Tested in Chrome at phone size (pairing, storing, a part done with the Mac switched off, merging on
  return; the static build under a Pages-style address, with a stand-in for the GitHub API). Not yet
  tried on a real iPhone or Android phone, The Mac's side of the GitHub exchange and the published site itself were checked against github.com
  (wide and narrow, a recording played from Pages); the token side only against a stand-in API.

## Data pipeline (only needed if the PDFs change)

Needs Python 3 with PyMuPDF, Pillow, numpy, scipy; `tesseract`; `ffmpeg`; macOS (Apple Vision OCR
via `swiftc`). `$OCR` is any scratch folder (about 1.5 GB). The layout model (`vl.py`) has its own
environment, about 1.4 GB plus 2 GB of weights, made once from the repository root:

```sh
uv venv .venv-ocr --python 3.12
uv pip install --python .venv-ocr/bin/python paddlepaddle==3.2.1 "paddleocr[doc-parser]" "mlx-vlm>=0.3.11"
```

```sh
python3 tools/render.py $OCR                     # page JPEGs -> pages/, grayscale PNGs -> $OCR
swiftc -O tools/vocr.swift -o tools/vocr
(cd $OCR && ls */*.png | xargs -P6 -I{} sh -c 'f={}; tesseract "$f" "${f%.png}" tsv')
(cd $OCR && ls */*.png | xargs -n 12 -P 8 /path/to/tools/vocr)        # -> .vjson
(cd $OCR && ls */*.png | xargs -n 12 -P 8 /path/to/tools/vocr --raw)  # -> .vraw
# copy $OCR/<book>/*.vjson, *.vraw and *.tsv into tools/cache/<book>/
python3 tools/pdftext.py 20                      # book 20 is digital text: use its text layer instead
python3 tools/glyphs.py $OCR                     # lone letters, numbers and gaps that OCR dropped
python3 tools/margin.py $OCR                     # paragraph letters printed in the margin
python3 tools/ink.py $OCR                        # bold, bullets, ruled frames, measured on the page image (7 min)
../../.venv-ocr/bin/python tools/vl.py $OCR      # layout model: tables first, then every test page (hours; resumable)
python3 tools/build.py                           # -> data/index.json, data/t/<book>-<test>.json
python3 tools/check.py                           # must report no problems in the questions
python3 tools/audit.py                           # what the screen shows against the layout model's reading
```

How the text gets right:

1. **Three readings per page** — Vision with and without language correction, and tesseract.
   `lines.py` fuses them; where Vision garbles a quotation mark it takes tesseract's words, a
   printed line Vision skipped altogether is taken whole from tesseract, and a line Vision ran
   across both columns of a two-column page is cut at the gutter. Passages are then read column by
   column (a title centred over the columns ends a band; it does not make the page one column).
2. **`glyphs.py`** finds every character-sized blob of ink no reading accounts for (a lone "D",
   a "10", a dotted gap) and reads it separately; unreadable ones are kept as "something is here".
3. **`groups.py`** fits each question group to its known shape — numbers in order, letters
   A, B, C…, one gap per question — so a lost or misread label is restored from its position.
4. **`ink.py`** measures the typography OCR does not return: a line is bold when its strokes are
   heavier than the page's regular text (threshold found per book), a bullet is a round solid mark
   in front of a line, a frame is ruled lines that meet. `groups.py` builds notes from these: bold
   sub-headings, list items with the lines they wrap onto, indent levels, the frame round the notes.
5. **`vl.py`** reads the pages a second time with PaddleOCR-VL-1.6 (0.9B, runs through MLX on Apple
   Silicon, about 20 s a page on an M4). `tables.py` turns its tables into real tables, but only
   when every gap is found in order, its words are confirmed by the line OCR, and the words the
   line OCR read inside the table are all in it; otherwise the group stays a picture. Bullet
   points and separate items inside a cell are put back from the page lines (list marks, space
   above a line). `audit.py` lists words the screen lost or reads differently. The model is
   never taken on its own word: it drops dots of gaps and sometimes writes text that is not there.
6. **`check.py`** verifies every test: each question answerable, option lists complete, gaps in
   order, paragraph letters present, nothing left over. `probs.py` prints the OCR rows of whatever
   it reports; `dbg.py 19-4 L2` shows one part in detail.
7. **Hand corrections**, all in git:
   - `tools/keys/<book>.txt` — answer keys, typed from the key pages. `a&b X,Y` = two answers in
     either order; `/` = alternatives; `(…)` = optional words.
   - `tools/fixes/<book>.json` — lines the scan lost or a label read as something else.
   - `tools/fixes/<book>.spelling.json` — misread words, found with `proof.py` and `audit.py`
     (`["*", "Al", "AI"]` corrects a word wherever it stands on the page).
   - `tools/overrides.json` — passage titles, and question groups to show as the book's picture.

`tools/preview.html?t=21-1&s=R&p=1` opens one part straight in the exam screen;
`tools/audit.html?t=21-1&s=R&p=1` lays it out in full beside the book pages it was read from.

## Known gaps

- Cambridge 13, Test 3: the Part 2 audioscript page is missing from the PDF scan.
- 32 of the "Q12" answer markers in the transcripts were not read (they only help in review).
- Book 20's PDF is a retyped copy, not the printed book: its transcripts have no answer markers,
  the title of Test 1 Passage 2 is cut off in the source, and wording may differ slightly.
- Maps, plans, diagrams, flow-charts and the tables that fail `tables.py`'s checks (35 question
  groups) are shown as pictures from the book with answer boxes below; 17 tables are real tables,
  each compared with its page by eye.
  Every passage/task has a "View original book pages" button.
- `audit.py` covers all 308 listening and reading parts (question and passage pages); transcripts
  and writing/speaking pages are read by `vl.py` but not compared. What it still lists is mostly
  the model's own misreadings and instruction wording the screen leaves out on purpose.
- Italics are not detected. In a table, the row headings of the first column are not set bold.
- Spelling was proofread by comparing OCR engines; a wrong word that is itself a real word
  (e.g. "modem" for "modern") can still slip through.
