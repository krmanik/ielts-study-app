# IELTS Study Suite

A local web app built from *The Official Cambridge Guide to IELTS* (scanned PDF + 70 MP3s).

## Start

Double-click **`Start IELTS Suite.command`** (one folder up). It runs `python3 serve.py` and opens
<http://localhost:8765>. Keep the Terminal window open while studying.

To use the Test Centre on your phone as well — the same tests and progress, also with no connection —
start with **`Start IELTS for Phone.command`** instead; see `cbt/README.md`, "On a phone".

## Where your progress is kept

Progress is stored in the browser for `localhost:8765` **and** saved to disk by `serve.py`:

```
progress/study-suite.json     Study Suite: sections done, notes, vocabulary, attempts
progress/test-centre.json     Test Centre: every attempt with answers, essays, highlights
progress/RESULTS.md           readable list of finished Test Centre attempts
progress/recordings/          speaking recordings
```

Every finished test is committed to git straight away (`Result: Cambridge 15 Test 2 Reading — 31/40,
band 7.0`); other changes are committed after five quiet minutes and when the server stops. So
`git log progress` is the history of your results, and clearing the browser or moving to another
browser loses nothing — the app loads the copy on disk when it is newer. The Test Centre's copy is
shared with the phone: what each side did is merged, never replaced (`cbt/js/merge.js`).

## What's inside

- **Study path**: the book split into modules → units → sections (84 short sections). Each section
  shows only its own pages, with its audio tracks, answer key and recording script beside it.
- **Audio aligned to the book**: every ▶ number printed on a page is clickable. The player has
  ±5s, speed, A–B loop, and jump-to-page and script buttons.
- **Practice tests**: timed Listening (real-exam audio that plays once), Reading, Writing (word
  counter) and Speaking (recorder with Part 2 prep timer). Listening and Reading are auto-marked
  against the book's key with a band score; Writing and Speaking use self-assessment against the
  four official criteria.
- **Tracking**: sections done, study time per day, streak, activity heatmap, exam countdown with a
  daily target, latest band per skill and an estimated overall band.
- **Mistake log**, **vocabulary flashcards** (spaced repetition), **notes and bookmarks**,
  **full-text search** of the scanned pages, dark mode.

## Known gaps in the source files

- Book pages 255–258 (Test 6, Reading Passage 2) are missing from the PDF scan.
- Speaking units refer to DVD videos, which aren't included in the audio folder.

## Rebuilding the data (only if the source files change)

Needs Python 3 with PyMuPDF, numpy and Pillow, plus `tesseract`.

```sh
python3 tools/render_pages.py /tmp/ocrimg                         # page JPEGs -> pages/, OCR PNGs -> /tmp/ocrimg
(cd /tmp/ocrimg && ls *.png | xargs -P8 -I{} sh -c 'tesseract {} ../ocr/$(basename {} .png) tsv')
python3 tools/ocr_lines.py /tmp/ocr tools/cache/lines.json
cp /tmp/ocr/p38[2-9].tsv /tmp/ocr/p39[0-2].tsv tools/cache/tsv/   # answer-key pages (word boxes)
python3 tools/find_badges.py tools/cache/badges.json              # blue/purple ▶ badges + track numbers
python3 tools/build_data.py                                       # -> data/book.json, data/search.json
```

`tools/key_overrides.json` holds hand-checked corrections to the OCR'd answer key.
