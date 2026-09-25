---
description: Draft a referral letter with the clinical history attached - to drafts/, for the vet to check and send.
---

1. Run `node scripts/vet.mjs patient "NAME" --json` and read the history before writing a word.
2. Render the history document: `npm run docs -- clinical-history` (one HTML file per patient in `docs-out/clinical-history/`; print to PDF from the browser).
3. Draft the covering letter to `drafts/referral-<patient>.md`: signalment, the presenting problem and its course with dates, treatments so far with responses, the specific question for the specialist, and the owner's expectations if recorded.
4. Facts come from the record only. If the record is thin, say so in the draft where the vet will see it, never pad it.
5. The vet reads, signs, sends. Nothing sends from here.
