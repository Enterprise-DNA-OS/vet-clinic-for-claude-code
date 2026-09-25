---
description: Draft the vaccination recall messages for everyone overdue or due soon with nothing booked - to drafts/, never sent from here.
---

1. Run `node scripts/vet.mjs reminders --json` and keep the rows with nothing booked.
2. For each owner, draft a short plain message to `drafts/reminder-<client>.md`: which animal, which vaccination, when it was due, and one line to book. No scare copy; one sentence of why it matters is plenty.
3. Group by owner (one message per household, all their animals in it), and note the phone number at the top for the ones better rung than written.
4. Say where the drafts landed and how many. A person sends them; nothing sends from here.
