---
description: The recall list - every vaccination due or overdue, who is booked and who nobody has rung. This list is where a clinic's next year of revenue quietly leaks.
---

1. Run `node scripts/vet.mjs reminders --json` (due within 30 days plus everything overdue; `--days=` widens it, `--all` shows the lot).
2. Present overdue-with-nothing-booked first, oldest first, with the owner's phone number on the line: this is a call sheet, not a report.
3. Offer the next step: book the ones who answer (`appt add`), and `/draft-reminder-letters` for the rest.
4. When a vaccination is given outside a consult record, `vacc add PATIENT --vaccine= --vet= [--due=]` keeps the recall engine honest.
