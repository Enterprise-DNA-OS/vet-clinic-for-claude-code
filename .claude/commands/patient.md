---
description: One patient's whole card - signalment, the weight trend, vaccination record, full history and the money - by name, ref or microchip number.
---

1. Run `node scripts/vet.mjs patient "<name-or-PT-ref-or-chip>" --json`.
2. Present the card: species, breed, age, owner and phone; microchip (say loudly if a dog has none on record: Dog Control Act 1996 s 36A); the weight trend (call out a drift up or down across visits, the dashboard never does); vaccinations with the next due date; the consult history with each visit's state.
3. If anything on the card is unfinished (an open consult, unbilled work, an overdue vaccination), name it and the command that fixes it.
4. `patient deceased NAME [--on=]` marks a death; the record stays on file, by design.
