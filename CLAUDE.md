# Vet Clinic for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR CLINIC]
- **Operator:** [YOUR NAME], [your role]
- **Who reconciles the controlled drug register, and how often:** [name, cadence]
- **Who runs the recall list:** [name, cadence]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs my attention, what's wrong, morning check | `/attention` |
| Today's appointments, the day sheet, the week's book | `/book` |
| Everything about an animal, its history, its weight | `/patient` |
| Everything about an owner, their account | `/client` |
| The owners list | `/clients` |
| The staff, whose certificate is due, who billed what | `/team` |
| See a patient, charge a consult, finish the record | `/consult` |
| Who is due a vaccination, the recall run | `/reminders` |
| Who have we quietly lost | `/lapsed` |
| Who owes money | `/debtors` |
| What have we finished but not billed | `/unbilled` |
| What is low, out, or expired on the shelf; receive stock | `/stock` |
| The controlled drugs, the register, a disposal | `/register` |
| The Monday review | `/weekly-review` |
| Are we compliant, check the rules | `/compliance` |
| A new owner and animal | `/new-patient` |
| Note a call, a promise to pay, a decision | `/log` |
| Draft the recall messages | `/draft-reminder-letters` |
| Draft an estimate for a procedure | `/draft-estimate` |
| Draft a referral letter | `/draft-referral` |
| Bring the data across from ezyVet | `/import` |
| Change a field, a rule, a stage, a document | `/customise` |
| A new dashboard page | `/new-view` |

If an ask fits nothing here, run the CLI directly (`npm run vet -- help`) and then propose a new command for it.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off ezyVet.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/ezyvet
