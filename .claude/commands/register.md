---
description: The controlled drug register - entries, the reconciliation against the shelf, and witnessed disposals. Append-only by design; a mistake gets a correcting entry, never an edit.
---

1. Run `node scripts/vet.mjs register check --json` first. Any discrepancy is the day's first job: count the shelf, find the movement, record the correcting entry, and note who checked. An inspector asks about this line first (Misuse of Drugs Regulations 1977).
2. `register [ITEM] --json` shows the entries, newest first, with the running balance and who moved it.
3. Disposal is witnessed, always: `register dispose ITEM --qty= --staff= --witness= [--note=]`.
4. Dispensing never happens here directly: it happens inside a consult (`consult add`), which writes the register in the same breath. If someone asks to "adjust the register", the answer is a correcting received/disposed entry with a note, on the record.
5. The register prints for an audit with `npm run docs -- drug-register`.
