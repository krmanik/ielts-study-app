# Band 9 deck — how to use

Import `app/cbt/decks/IELTS_Band9.apkg` into Anki (or download it from the app: Test Centre → **Learn** → *Review with Anki*). 6 sub-decks, ~717 cards. The same material is readable in the app's **Learn** tab, with a *Practise* mode that hides the key phrases. Two card kinds:

- **Say it** — front shows a question. Answer *out loud* (speaking) or plan in 1 min (writing), then flip and compare.
- **Cloze** — the full model answer with one phrase hidden; hint = first letters (`a d… s…`). You learn the phrase *inside its sentence*.

## Order (don't open everything at once)

| Week | Deck | Why |
|---|---|---|
| 1 | 1 Task 2 Essays — skeletons only | Finish 250+ words every time |
| 1–2 | 3 Task 1 — templates | Overview sentence = band 7+ |
| 2–4 | 2 Topic Bank (2 topics a day) | Ideas + vocabulary for Task 2 and Speaking 3 |
| 2–4 | 4 Speaking P1 · 5 P2 · 6 P3 | One topic a day, speak aloud |

Anki → deck options: **New cards/day 15**, **Max reviews 150**. Suspend sub-decks you're not on yet.

## Daily 30 min
1. Anki reviews (15 min).
2. Write one paragraph or speak one Part 2 answer using today's chunks — *your* facts, not the sample's (10 min).
3. Record yourself once a week and compare with the sample.

## Rules for band 8–9
- Never recite a whole answer. Examiners mark memorised speech down. Memorise **chunks + structure**, swap in your own story.
- Personal details in samples ([Pune], Diwali, grandfather…) are placeholders — rewrite them with true ones before learning.

## Edit / rebuild
Edit `band9/*.md` (`{chunk}` = gap, `[X]` = placeholder, `Q:` = prompt, `Tip:` = back note), then:

    python3 writing/build.py      # both decks + the app's learn.json (needs: pip install genanki)

Re-import updates existing cards (stable IDs); review history kept.
