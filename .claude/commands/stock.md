---
description: The shelf - what is out, low, or sitting in an expired batch - and receiving stock in, with the controlled drug register written automatically.
---

1. Run `node scripts/vet.mjs stock --json` (alerts only; `--all` for the whole shelf).
2. Present EXPIRED BATCH first (quarantine it today, the dispensing gate already refuses it), then OUT and low with reorder points.
3. Receive: `stock receive ITEM --qty= [--batch=] [--expires=]`. A controlled drug also needs `--staff=`: the register entry writes itself, both sides move together.
4. Price list and flags: `items --json`. RVM means vet-consult-only; CD means every movement is a register entry.
