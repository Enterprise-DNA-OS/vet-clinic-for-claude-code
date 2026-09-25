---
description: Who owes money and how old it is, grouped by owner, oldest first - the ring-list.
---

1. Run `node scripts/vet.mjs debtors --json` and `node scripts/vet.mjs invoices --unpaid --json`.
2. Present by owner, oldest first, phone number on the line. Past 60 days is a call today; past 30 is a call this week.
3. Before ringing, read `/client` for the story and any promises already on file. Log every conversation with `/log`.
4. Statements render with `npm run docs -- client-statement` in the clinic's brand; a person sends them.
