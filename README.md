<h1 align="center">Vet Clinic for Claude Code</h1>

<p align="center">
  <strong>The open-source vet practice management system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, a web front end if you want one, your ezyVet data brought across.<br/><a href="https://calendly.com/sam-mckay/discovery-call?utm_source=github&utm_medium=readme&utm_campaign=ezyvet">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/ezyvet?utm_source=github&utm_medium=readme&utm_campaign=ezyvet">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#compliance-checked-against-the-data">Compliance</a> &bull;
  <a href="#ten-questions-ezyvet-cannot-answer">Ten questions</a> &bull;
  <a href="#instead-of-ezyvet">Instead of ezyVet</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Vet Clinic for Claude Code does the job you pay ezyVet for, as a Postgres database and a set of Claude Code commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) and run the clinic in plain language. It runs the right query, and it can answer questions the incumbent's dashboard cannot.

ezyVet prices per full-time vet per month, before implementation and data conversion, which are scoped and billed separately on an initial term. What a small-animal clinic actually needs to hold is ordinary: the owners, the patients, the vets with their practising certificates, the appointment book, the consults with their notes and charges, the vaccination record that drives the recall list, the invoices, the stock, and the controlled drug register the law requires. That is eleven Postgres tables, and the practice dashboard the incumbent sells is a handful of SQL views over them.

This repo is that record over Postgres, with the asking done by the agent you already have:

```
/attention                  everything that wants a decision this morning, worst first
/book                       today's day sheet, plus every past appointment left unresolved
/patient                    one animal's whole card: weights, vaccines, history, money
/client                     one owner's card before any conversation
/team                       the vets, practising certificate state loud
/consult                    open, charge, complete: the gates live here
/reminders                  the recall list, the call sheet version
/lapsed                     the patients quietly becoming someone else's
/debtors · /unbilled        the money, by age
/stock · /register          the shelf, and the controlled drug register
/weekly-review              the Monday review, written from three commands
/compliance                 nine rules from the Acts and the Code, run against your records
```

The sharp edges are deliberate, because this is a profession where soft edges become Council hearings:

- **A vet without a current practising certificate on the day does not go in the book.** The Veterinarians Act 2005 requires it, the CLI refuses, and there is no force flag.
- **A consult does not complete without clinical notes.** The record is the evidence of care; no notes, no completion.
- **A surgery or dental does not complete without consent on record.**
- **A restricted veterinary medicine is not dispensed outside a vet's consult** (ACVM Act 1997), an expired batch is not dispensed at all, and **a controlled drug movement IS a register entry**: the register is append-only, the balance never goes negative, and disposals are witnessed (Misuse of Drugs Regulations 1977).
- **Nothing is deleted.** Patients become deceased, staff become former, and the record stays.

**Nothing here connects to a lab machine, an insurer or a bank, and nothing sends.** Reminder letters, estimates and referrals draft to files in your brand; a person sends them. Nothing here is legal advice.

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your clinical and financial record sits in plain Postgres tables you own. Any tool can read them. No export request, no access ending when a subscription does.
- No per-vet pricing, no tiers, no add-on ladder. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/vet-clinic-for-claude-code.git
cd vet-clinic-for-claude-code
npm install
npm run demo
```

`npm run demo` creates the database, loads Harbourview Vets (a demo Tauranga clinic with a fortnight going quietly wrong: a 2.5 ml ketamine register discrepancy, a locum holding three appointments on a practising certificate that expired twelve days ago, two procedures with no consent on record, about $461 of finished work never invoiced, four patients overdue vaccinations with nothing booked, $599 of accounts past 30 days, an expired antibiotic batch still on the shelf, and two dogs with no microchip on record), then prints the attention list, the unbilled work and the compliance check.

Then open the folder in Claude Code and type:

```
/attention
```

Try `/book`, `/reminders`, `patient baxter`, `/register`, `/weekly-review`. When you are ready for real data, delete `.data/` and start with `/import`.

Fill in the "Who this is for" block in [CLAUDE.md](CLAUDE.md), especially who reconciles the controlled drug register and who runs the recall list, and put your clinic's name, logo and colours in [brand.json](brand.json) so every certificate, statement and register printout carries them.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee. A clinic shares one database: the vets, the front desk and the bookkeeper each clone the repo, point at the same `DATABASE_URL`, and work in their own Claude Code.

## The commands

| Command | What it does |
|---|---|
| `/attention` | Everything that wants a decision, worst first: a register discrepancy outranks all. |
| `/book` | The day sheet (or the week), plus anything unresolved; book, cancel and no-show through the gates. |
| `/patient` | One animal's whole card: signalment, weight trend, vaccinations, history, money. |
| `/client` | One owner's card: animals, account, appointments, file notes. |
| `/clients` | Every active owner: patients, owing, last visit. |
| `/team` | The staff with practising certificate state loud, and what each vet billed. |
| `/consult` | The consult ritual: open, charge, complete with notes (and consent for procedures). |
| `/reminders` | The recall list as a call sheet: overdue and nothing booked first. |
| `/lapsed` | Active patients not seen in 18 months, ranked by lifetime value. |
| `/debtors` | Who owes money and how old it is, phone numbers on the line. |
| `/unbilled` | Finished consults with no invoice: the write-off queue if nobody acts. |
| `/stock` | The shelf: out, low, expired batches; receiving writes the register for controlled drugs. |
| `/register` | The controlled drug register: entries, reconciliation, witnessed disposals. |
| `/weekly-review` | The Monday review, written from three commands. |
| `/compliance` | Nine rules from the Acts and the Code, run against your records, sources cited. |
| `/new-patient` | Owner, animal, first appointment, vaccination history, in the order the gates expect. |
| `/log` | A file note: calls, promises to pay, decisions. In a complaint, the record. |
| `/draft-reminder-letters` | The recall messages, drafted to `drafts/`. Never sends. |
| `/draft-estimate` | A written estimate for a procedure, priced from the real list. Drafts only. |
| `/draft-referral` | A referral letter with the clinical history attached. Drafts only. |
| `/import` | Bring the clinic across from ezyVet CSVs. The import is the first audit. |
| `/customise` | Add a field, change a rule, rename things, in plain language. Writes and applies the migration. |
| `/new-view` | Add a read-only HTML dashboard from a description. |

Everything the commands do, the CLI does: `npm run vet -- help`. Any read command takes `--json`.

### Documents and views, in your brand

```bash
npm run docs    # vaccination certificates, statements, clinical histories, the drug register
npm run view    # the week and the money, as read-only HTML dashboards
```

Both read [brand.json](brand.json), so your clinic's name, logo and colours are one file away. Documents land in `docs-out/`, views in `views/`. Print either to PDF from the browser; the drug register printout is the audit question answered in advance. `/new-view` adds a view, `documents.json` adds a document.

## Compliance, checked against the data

`/compliance` runs the rules in [docs/compliance.md](docs/compliance.md) against your records and reports what is breached, each rule citing its source. The CLI enforces the sharpest ones at the gate: uncertified vets do not book, unfinished notes do not complete, unconsented procedures do not close, RVMs do not leave without a vet, expired batches do not dispense, and the controlled drug register only ever gains entries.

1. Every practising vet holds a current annual practising certificate (Veterinarians Act 2005 s 18).
2. The controlled drug register reconciles with the shelf, drug by drug (Misuse of Drugs Regulations 1977).
3. Every consult carries clinical notes, completed the day it happened (VCNZ Code of Professional Conduct).
4. Every surgery and dental carries informed consent, on record (Code of Professional Conduct).
5. Restricted veterinary medicines only under a vet's authorisation (ACVM Act 1997).
6. No expired batch stays on the shelf (ACVM Act 1997, label conditions).
7. Every dog on the books has a microchip on record (Dog Control Act 1996 s 36A).
8. No core vaccination drifts more than 90 days overdue without a booking or a recorded decline (WSAVA guidelines, and your own standard).
9. Records are never deleted: deceased patients and old consults stay, and the register is append-only (Code of Professional Conduct).

Nothing there is legal advice. It is the rule book you point the system at, and you change it to match your practice.

## Ten questions ezyVet cannot answer

Every one of these is answered by the demo data today. Yours will be different, and that is the point.

1. Which controlled drugs' register balances do not reconcile with the shelf, right now, before the inspector asks?
2. Which vets in next week's book will not hold a current practising certificate on the day?
3. How much finished work has no invoice, per vet, and how old is the oldest dollar?
4. Which patients overdue a vaccination have no booking, with the owner's phone number, as one call sheet?
5. Which completed procedures have no consent on record?
6. Which active patients have not been seen in 18 months, ranked by what they historically spent?
7. Whose weight has drifted more than 5% across their last three visits without a note about it?
8. Which drug batches expire inside 60 days, and what is that stock worth at retail?
9. What is the no-show pattern by owner, and what did it cost in booked minutes this quarter?
10. If the Council asked for one patient's complete record on Monday, is anything missing: notes, consent, or the register line behind the premed?

## Your first hour: ten things to ask for

Open the folder in Claude Code and say these in your own words. Each one changes the system to fit your clinic.

1. "Put our real owners, patients and staff in, with everyone's registration numbers and certificate dates."
2. "Load our price list, and flag which items are RVMs and which are controlled drugs."
3. "Put our logo and colours on the certificates, statements and the register printout."
4. "Import our ezyVet exports, then show me what the old system never told us."
5. "Add our second branch as a location on appointments and stock."
6. "Track lab results as a table with a reference-range flag, and put them on the patient card."
7. "Add a boarding calendar: kennels, runs, who is in over the holidays."
8. "Set our vaccination protocols so the due date writes itself when the vaccine is charged."
9. "When I finish a dental, render the go-home instructions from the consult notes in the same breath."
10. "Write a command that drafts the month-end revenue summary by vet for our accountant."

`/customise` writes the migration, applies it, updates every command that touches the change, and runs the tests.

## Instead of ezyVet

Export your client and animal lists from ezyVet (its list screens export to CSV), run one command, and the record comes with you. Step by step, with what maps and what deliberately does not carry over: [docs/replace-ezyvet.md](docs/replace-ezyvet.md).

```bash
node scripts/vet.mjs import ezyvet --clients=clients.csv --patients=animals.csv --dry-run
node scripts/vet.mjs import ezyvet --clients=clients.csv --patients=animals.csv
```

The import is the first audit: an animal whose owner is missing from the export, or a dog whose microchip nobody recorded, is loud the moment the import finishes.

## Architecture

```
vet-clinic-for-claude-code/
  CLAUDE.md                 how the clinic wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  brand.json                your clinic's name, logo and colours on every document
  views.json                the HTML dashboards npm run view renders
  documents.json            the paperwork npm run docs renders
  .claude/commands/         the slash commands
  scripts/vet.mjs           the CLI the commands drive
  scripts/view.mjs          read-only HTML dashboards from the SQL views
  scripts/docs.mjs          the documents, one HTML file per record
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema, tables and views
  supabase/seed.sql         demo data
  docs/compliance.md        the rules /compliance checks, each with its source
  docs/replace-ezyvet.md    moving off the incumbent
  docs/why-no-front-end.md  the honest trade-offs
  exports/                  whole database dumps
  drafts/                   anything written for a person to send
```

## Built with Claude Code

This repository was built with Claude Code as the primary development tool, from the schema to the commands, and it is meant to be extended the same way. Ask for a new command and it writes one.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end, nothing that sends, and the certificate, notes, consent, RVM, batch and register gates stay.

## Want it installed and run for you?

Enterprise DNA installs Vet Clinic for Claude Code for your practice, migrates your ezyVet data, writes your protocols in as commands, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: https://calendly.com/sam-mckay/discovery-call?utm_source=github&utm_medium=readme&utm_campaign=ezyvet
- Read more: https://enterprisedna.co/omni/instead-of/ezyvet?utm_source=github&utm_medium=readme&utm_campaign=ezyvet

## License

MIT. Copyright (c) 2026 Enterprise DNA.
