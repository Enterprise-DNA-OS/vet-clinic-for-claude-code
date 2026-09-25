-- vet-clinic-for-claude-code: core schema.
-- A New Zealand small-animal clinic's operating record the way ezyVet sells
-- it: the clients (owners), the patients with their microchips and weights,
-- the vets with their practising certificates, the appointment book, the
-- consults with their clinical notes and charges, the vaccination record that
-- drives the recall list, the invoices, the stock, and the controlled drug
-- register the Misuse of Drugs Regulations require.
--
-- Runs unchanged on PGlite (embedded) and on Postgres / Supabase.
-- Money is in cents, NZD. Drug quantities are numeric in the item's unit.
--
-- Deliberately NOT here: lab machine integrations, imaging, insurance claim
-- lodgement. Those are connections, not records; the record of what was done
-- and charged lives here either way.
--
-- The sharp edges are deliberate:
--   * a vet without a current practising certificate on the day does not go
--     in the appointment book, and there is no force flag
--     (Veterinarians Act 2005 s 18)
--   * a consult does not complete without clinical notes: the record is the
--     evidence of care (VCNZ Code of Professional Conduct)
--   * a surgery or dental does not complete without consent on record
--   * a restricted veterinary medicine is not dispensed outside a vet's
--     consult (ACVM Act 1997)
--   * a controlled drug movement IS a register entry: the register is
--     append-only and the balance never goes negative
--     (Misuse of Drugs Regulations 1977)
--   * an expired batch is not dispensed
--   * nothing is deleted: patients become deceased, staff become former

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Clients ------------------------------------------------------------------------
-- The owners. Every patient, consult and dollar owed traces to one of these.

create table if not exists clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  phone         text,
  email         text,
  address       text,
  suburb        text,
  status        text not null default 'active',   -- active | former
  note          text,
  external_ref  text unique,                      -- the ezyVet client code, for import
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists clients_name_lower_idx on clients (lower(name));

-- Staff ---------------------------------------------------------------------------
-- The vets, nurses and the front desk. The practising certificate dates live
-- here because a vet consulting without a current one is the breach that ends
-- a career: the booking gate reads these dates.

create table if not exists staff (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  role                 text not null default 'vet',   -- vet | nurse | reception | manager
  employment           text not null default 'permanent',  -- permanent | part_time | locum
  registration_number  text,                          -- VCNZ registration
  apc_expires_on       date,                          -- annual practising certificate; the booking gate reads this
  phone                text,
  email                text,
  status               text not null default 'active',  -- active | former
  note                 text,
  external_ref         text unique,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index if not exists staff_name_lower_idx on staff (lower(name));

-- Patients ---------------------------------------------------------------------------
-- The animals. A deceased patient stays on file: the record outlives the
-- patient, because the Code says the record is kept, not because it is nice.

create table if not exists patients (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,                      -- PT-101
  name          text not null,
  client_id     uuid not null references clients(id) on delete cascade,
  species       text not null default 'dog',      -- dog | cat | rabbit | bird | other
  breed         text,
  sex           text,                             -- male | female | male neutered | female speyed
  dob           date,
  microchip     text unique,                      -- blank is loud for dogs: Dog Control Act 1996 s 36A
  status        text not null default 'active',   -- active | deceased | moved
  deceased_on   date,
  note          text,
  external_ref  text unique,                      -- the ezyVet animal code, for import
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists patients_client_idx on patients (client_id);

-- Items ---------------------------------------------------------------------------
-- Everything the clinic charges for: services, medicines, consumables.
-- Medicines carry the two flags the gates read: rvm (restricted veterinary
-- medicine: only dispensed under a vet's consult, ACVM Act 1997) and
-- controlled (a Misuse of Drugs controlled drug: every movement is a register
-- entry). Stock-tracked items carry the current batch and its expiry.

create table if not exists items (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,          -- CONS-STD
  name              text not null,
  kind              text not null default 'service',  -- service | medicine | consumable
  unit              text not null default 'each',  -- each | ml | tablet
  price_cents       bigint not null,
  rvm               boolean not null default false,
  controlled        boolean not null default false,
  track_stock       boolean not null default false,
  stock_qty         numeric not null default 0,
  reorder_at        numeric,
  batch_no          text,
  batch_expires_on  date,                          -- the dispensing gate reads this
  note              text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Appointments ---------------------------------------------------------------------------
-- The book. An appointment is scheduled, then completed (through its
-- consult), a no-show, or cancelled. The gate refuses a vet whose practising
-- certificate is missing or expired on the day, and a vet in two rooms at
-- once.

create table if not exists appointments (
  id             uuid primary key default gen_random_uuid(),
  ref            text unique,                     -- AP-1001
  patient_id     uuid not null references patients(id) on delete cascade,
  staff_id       uuid not null references staff(id),
  on_date        date not null,
  starts_at      time not null,
  minutes        int not null default 30,
  type           text not null default 'consult', -- consult | vaccination | surgery | dental | recheck
  reason         text,
  status         text not null default 'scheduled',  -- scheduled | completed | no_show | cancelled
  cancel_reason  text,
  external_ref   text unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists appointments_patient_idx on appointments (patient_id);
create index if not exists appointments_staff_idx on appointments (staff_id);
create index if not exists appointments_on_idx on appointments (on_date);

-- Consults ---------------------------------------------------------------------------
-- The clinical record. A consult opens, gathers its charge lines, and
-- completes with notes (required) and, for procedures, consent on record.
-- The notes are the record of care the Code requires; there is no completing
-- without them.

create table if not exists consults (
  id              uuid primary key default gen_random_uuid(),
  ref             text unique,                    -- CN-2001
  appointment_id  uuid unique references appointments(id) on delete set null,
  patient_id      uuid not null references patients(id) on delete cascade,
  staff_id        uuid not null references staff(id),
  on_date         date not null default current_date,
  type            text not null default 'consult',  -- consult | vaccination | surgery | dental | recheck
  reason          text,
  weight_kg       numeric,                        -- every consult weighs the patient; the trend is free
  notes           text,                           -- required to complete; the clinical record
  recheck_on      date,                           -- the recheck the vet recommended
  consent_on      date,                           -- procedures do not complete without it
  status          text not null default 'open',   -- open | completed
  external_ref    text unique,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists consults_patient_idx on consults (patient_id);
create index if not exists consults_on_idx on consults (on_date);

-- Consult lines ---------------------------------------------------------------------------
-- What was done and dispensed, priced. The dispensing gates live on this
-- table's writes: RVMs only under a vet's consult, controlled drugs write the
-- register, stock decrements, expired batches refuse.

create table if not exists consult_lines (
  id                uuid primary key default gen_random_uuid(),
  consult_id        uuid not null references consults(id) on delete cascade,
  item_id           uuid not null references items(id),
  qty               numeric not null default 1,
  unit_price_cents  bigint not null,
  note              text,
  created_at        timestamptz not null default now()
);
create index if not exists consult_lines_consult_idx on consult_lines (consult_id);

-- Vaccinations ---------------------------------------------------------------------------
-- The vaccination record, which is also the recall engine: the latest due
-- date per patient and vaccine drives the reminder list, and the reminder
-- list is where a clinic's next year of revenue quietly leaks.

create table if not exists vaccinations (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references patients(id) on delete cascade,
  consult_id  uuid references consults(id) on delete set null,
  staff_id    uuid not null references staff(id),   -- the vet who gave it
  vaccine     text not null,                        -- Canine DHP, Canine Lepto, Feline F3
  given_on    date not null,
  due_on      date,                                 -- the next one; blank means course complete
  created_at  timestamptz not null default now()
);
create index if not exists vaccinations_patient_idx on vaccinations (patient_id);

-- Invoices ---------------------------------------------------------------------------
-- One invoice per completed consult, issued to the owner. Nothing here
-- connects to a bank: `invoice paid` records what the bank statement shows.

create table if not exists invoices (
  id           uuid primary key default gen_random_uuid(),
  ref          text unique,                       -- INV-3001
  client_id    uuid not null references clients(id) on delete cascade,
  consult_id   uuid unique references consults(id) on delete set null,
  issued_on    date not null default current_date,
  due_on       date not null,
  total_cents  bigint not null,
  status       text not null default 'issued',    -- issued | paid | written_off
  paid_on      date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists invoices_client_idx on invoices (client_id);

-- Controlled drug register ---------------------------------------------------------------------------
-- The register the Misuse of Drugs Regulations 1977 require: every receipt,
-- dispensing and witnessed disposal of a controlled drug, with the running
-- balance. Append-only by design: there is no update or delete path, a
-- mistake gets a correcting entry, and the balance is checked against the
-- shelf with `register check`.

create table if not exists drug_register (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references items(id),
  entry_on       date not null default current_date,
  movement       text not null,                   -- received | dispensed | disposed
  qty            numeric not null,                -- always positive; the movement carries the sign
  balance_after  numeric not null,
  patient_id     uuid references patients(id) on delete set null,
  consult_id     uuid references consults(id) on delete set null,
  staff_id       uuid not null references staff(id),
  witness        text,                            -- disposals are witnessed, always
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists drug_register_item_idx on drug_register (item_id);

-- File notes ---------------------------------------------------------------------------
-- Calls, conversations, decisions. In a complaint to the Council, the record.

create table if not exists file_notes (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid references patients(id) on delete cascade,
  client_id   uuid references clients(id) on delete cascade,
  staff_id    uuid references staff(id) on delete set null,
  noted_on    date not null default current_date,
  note        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists file_notes_patient_idx on file_notes (patient_id);

-- updated_at triggers ------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['clients','staff','patients','items','appointments','consults','invoices']
  loop
    execute format('drop trigger if exists %I on %I', t || '_updated_at', t);
    execute format('create trigger %I before update on %I for each row execute function set_updated_at()', t || '_updated_at', t);
  end loop;
end
$$;

-- =====================================================================================
-- Views: the questions a practice owner asks every Monday, as SQL anyone can read.
-- =====================================================================================

-- Staff with the practising certificate state loud and the load visible.
create or replace view v_staff as
select
  s.id as staff_id,
  s.name,
  s.role,
  s.employment,
  s.registration_number,
  s.apc_expires_on,
  (s.apc_expires_on - current_date) as apc_days_left,
  case
    when s.role <> 'vet' then ''
    when s.apc_expires_on is null then 'NONE'
    when s.apc_expires_on < current_date then 'EXPIRED'
    when s.apc_expires_on <= current_date + 30 then 'expiring'
    else 'current'
  end as apc,
  s.status,
  (select count(*) from appointments a where a.staff_id = s.id and a.status = 'scheduled' and a.on_date between current_date and current_date + 7) as appts_next_7d,
  (select count(*) from consults cn where cn.staff_id = s.id and cn.status = 'completed' and cn.on_date >= current_date - 28) as consults_last_28d,
  (select coalesce(sum(l.qty * l.unit_price_cents), 0)::bigint from consults cn join consult_lines l on l.consult_id = cn.id
     where cn.staff_id = s.id and cn.on_date >= current_date - 28) as billed_last_28d_cents
from staff s;

-- Consults with the money state loud: what each one is worth, whether it has
-- been invoiced, and whether the record is actually finished.
create or replace view v_consults as
select
  cn.id as consult_id,
  cn.ref,
  p.name as patient,
  p.id as patient_id,
  p.species,
  c.name as client,
  c.id as client_id,
  s.name as vet,
  s.id as staff_id,
  cn.on_date,
  cn.type,
  cn.reason,
  cn.weight_kg,
  cn.notes,
  cn.recheck_on,
  cn.consent_on,
  cn.status,
  (select coalesce(sum(l.qty * l.unit_price_cents), 0)::bigint from consult_lines l where l.consult_id = cn.id) as value_cents,
  (select count(*) from consult_lines l where l.consult_id = cn.id) as line_count,
  exists (select 1 from invoices i where i.consult_id = cn.id) as invoiced,
  case
    when cn.status = 'open' and cn.on_date < current_date then 'OPEN STALE'
    when cn.status = 'open' then 'open'
    when cn.status = 'completed' and (cn.notes is null or cn.notes = '') then 'NO NOTES'
    when cn.type in ('surgery', 'dental') and cn.consent_on is null then 'NO CONSENT'
    when exists (select 1 from invoices i where i.consult_id = cn.id) then 'billed'
    when (select count(*) from consult_lines l where l.consult_id = cn.id) > 0 then 'unbilled'
    else 'completed'
  end as state
from consults cn
join patients p on p.id = cn.patient_id
join clients c on c.id = p.client_id
join staff s on s.id = cn.staff_id;

-- Patients with the whole pulse: last seen, next booked, vaccine state,
-- lifetime value. A good patient with no next appointment is the quiet leak.
create or replace view v_patients as
select
  p.id as patient_id,
  p.ref,
  p.name,
  p.species,
  p.breed,
  p.sex,
  p.dob,
  date_part('year', age(current_date, p.dob))::int as age_years,
  p.microchip,
  c.name as client,
  c.id as client_id,
  c.phone,
  p.status,
  (select max(cn.on_date) from consults cn where cn.patient_id = p.id and cn.status = 'completed') as last_seen_on,
  (select min(a.on_date) from appointments a where a.patient_id = p.id and a.status = 'scheduled' and a.on_date >= current_date) as next_appt_on,
  (select max(cn.weight_kg) from consults cn where cn.patient_id = p.id and cn.on_date = (select max(cn2.on_date) from consults cn2 where cn2.patient_id = p.id and cn2.weight_kg is not null) and cn.weight_kg is not null) as last_weight_kg,
  (select min(vd.due_on) from (
     select v.vaccine, max(v.due_on) as due_on from vaccinations v where v.patient_id = p.id group by v.vaccine
   ) vd where vd.due_on is not null) as next_vacc_due_on,
  (select coalesce(sum(l.qty * l.unit_price_cents), 0)::bigint from consults cn join consult_lines l on l.consult_id = cn.id where cn.patient_id = p.id) as lifetime_cents
from patients p
join clients c on c.id = p.client_id;

-- The appointment book with the story on one line. A past appointment nobody
-- completed or cancelled is UNCONFIRMED: it is not billable as it stands.
create or replace view v_appointments as
select
  a.id as appointment_id,
  a.ref,
  p.name as patient,
  p.id as patient_id,
  p.species,
  c.name as client,
  c.phone,
  s.name as vet,
  s.id as staff_id,
  a.on_date,
  a.starts_at,
  a.minutes,
  a.type,
  a.reason,
  a.status,
  a.cancel_reason,
  (select cn.ref from consults cn where cn.appointment_id = a.id) as consult_ref,
  case
    when a.status = 'scheduled' and a.on_date < current_date then 'UNCONFIRMED'
    when a.status = 'scheduled' and a.on_date = current_date then 'today'
    when a.status = 'no_show' then 'NO SHOW'
    else a.status
  end as state
from appointments a
join patients p on p.id = a.patient_id
join clients c on c.id = p.client_id
join staff s on s.id = a.staff_id;

-- The recall list: the latest due date per patient and vaccine, with whether
-- anything is actually booked. This list is the difference between a full
-- vaccination book and a quiet one, and ezyVet charges for the comms add-on
-- that works it.
create or replace view v_reminders as
select
  p.id as patient_id,
  p.ref,
  p.name as patient,
  p.species,
  c.name as client,
  c.phone,
  c.email,
  vd.vaccine,
  vd.due_on,
  (current_date - vd.due_on) as days_overdue,
  (select min(a.on_date) from appointments a where a.patient_id = p.id and a.status = 'scheduled' and a.on_date >= current_date) as next_appt_on,
  case
    when vd.due_on < current_date - 90 then 'LONG OVERDUE'
    when vd.due_on < current_date then 'OVERDUE'
    when vd.due_on <= current_date + 30 then 'due soon'
    else 'current'
  end as state
from patients p
join clients c on c.id = p.client_id
join lateral (
  select v.vaccine, max(v.due_on) as due_on
  from vaccinations v
  where v.patient_id = p.id
  group by v.vaccine
) vd on vd.due_on is not null
where p.status = 'active' and c.status = 'active';

-- Invoices with the age of the money.
create or replace view v_invoices as
select
  i.id as invoice_id,
  i.ref,
  c.name as client,
  c.id as client_id,
  c.phone,
  cn.ref as consult_ref,
  (select p.name from patients p where p.id = cn.patient_id) as patient,
  i.issued_on,
  i.due_on,
  (current_date - i.due_on) as days_overdue,
  i.total_cents,
  i.status,
  i.paid_on,
  case
    when i.status = 'paid' then 'paid'
    when i.status = 'written_off' then 'written off'
    when i.due_on < current_date - 60 then 'OVERDUE 60+'
    when i.due_on < current_date - 30 then 'OVERDUE 30+'
    when i.due_on < current_date then 'overdue'
    else 'issued'
  end as state
from invoices i
join clients c on c.id = i.client_id
left join consults cn on cn.id = i.consult_id;

-- Stock with the shelf state loud: out, low, expired batch on the shelf.
create or replace view v_stock as
select
  it.id as item_id,
  it.code,
  it.name,
  it.kind,
  it.unit,
  it.price_cents,
  it.rvm,
  it.controlled,
  it.stock_qty,
  it.reorder_at,
  it.batch_no,
  it.batch_expires_on,
  (it.batch_expires_on - current_date) as batch_days_left,
  case
    when it.batch_expires_on is not null and it.batch_expires_on < current_date and it.stock_qty > 0 then 'EXPIRED BATCH'
    when it.stock_qty <= 0 then 'OUT'
    when it.reorder_at is not null and it.stock_qty <= it.reorder_at then 'low'
    when it.batch_expires_on is not null and it.batch_expires_on <= current_date + 60 then 'batch expiring'
    else 'ok'
  end as state
from items it
where it.track_stock;

-- The controlled drug register balances against the shelf. A discrepancy here
-- is the first thing an inspector asks about, so it is the first thing the
-- attention list says.
create or replace view v_register_balances as
select
  it.id as item_id,
  it.code,
  it.name,
  it.unit,
  it.stock_qty as shelf_qty,
  coalesce((select sum(case when r.movement = 'received' then r.qty else -r.qty end) from drug_register r where r.item_id = it.id), 0) as register_qty,
  it.stock_qty - coalesce((select sum(case when r.movement = 'received' then r.qty else -r.qty end) from drug_register r where r.item_id = it.id), 0) as discrepancy,
  (select max(r.entry_on) from drug_register r where r.item_id = it.id) as last_entry_on
from items it
where it.controlled;

-- Active patients the clinic has quietly lost: not seen in 18 months, nothing
-- booked, with what they historically spent. ezyVet cannot print this list
-- without the reporting add-on; here it is a view.
create or replace view v_lapsed as
select
  p.patient_id,
  p.ref,
  p.name as patient,
  p.species,
  p.client,
  p.phone,
  p.last_seen_on,
  (current_date - p.last_seen_on) as days_since,
  p.lifetime_cents
from v_patients p
where p.status = 'active'
  and p.next_appt_on is null
  and p.last_seen_on is not null
  and p.last_seen_on < current_date - 540;

-- Everything that wants a decision, one union, worst first. A controlled drug
-- discrepancy outranks everything: that conversation is with the Ministry,
-- not with a client.
create or replace view v_attention as
-- The register does not match the shelf.
select 1 as rank, 'register_discrepancy' as reason, b.code as label, b.name as who, b.unit as place,
       null::int as days,
       'controlled drug register shows ' || b.register_qty || ' ' || b.unit || ', shelf count is ' || b.shelf_qty ||
       ': a discrepancy of ' || b.discrepancy || ' ' || b.unit || '. Count it, find it, and record the correcting entry today (Misuse of Drugs Regulations 1977)' as detail
from v_register_balances b
where b.discrepancy <> 0
union all
-- A vet with no current practising certificate holding appointments.
select 2, 'apc_expired', s.name, '', 'holds ' || s.appts_next_7d || ' appointment(s) next 7 days',
       abs(coalesce(s.apc_days_left, 0)),
       'practising certificate ' || case when s.apc_expires_on is null then 'NOT ON RECORD'
         else 'expired ' || to_char(s.apc_expires_on, 'YYYY-MM-DD') end ||
       ' and still in the book: reassign every appointment today, practising without a current certificate breaches the Veterinarians Act 2005'
from v_staff s
where s.role = 'vet' and s.status = 'active' and s.apc in ('EXPIRED', 'NONE') and s.appts_next_7d > 0
union all
-- An open consult from a past day: the clinical record is not finished.
select 3, 'consult_unfinished', cn.ref, cn.patient, cn.vet,
       (current_date - cn.on_date),
       'opened ' || to_char(cn.on_date, 'YYYY-MM-DD') || ' and never completed: the notes are the clinical record, finish it while ' || cn.vet || ' still remembers the consult'
from v_consults cn
where cn.state = 'OPEN STALE'
union all
-- A completed procedure with no consent on record.
select 4, 'consent_missing', cn.ref, cn.patient, cn.vet,
       (current_date - cn.on_date),
       cn.type || ' completed ' || to_char(cn.on_date, 'YYYY-MM-DD') || ' with no consent on record: get the signed form scanned and dated today, informed consent is what the Council asks for first'
from v_consults cn
where cn.status = 'completed' and cn.type in ('surgery', 'dental') and cn.consent_on is null
union all
-- Finished work nobody has invoiced.
select 5, 'unbilled', cn.ref, cn.patient, cn.vet,
       (current_date - cn.on_date),
       '$' || to_char(cn.value_cents / 100.0, 'FM999,999,990') || ' of completed work with no invoice, ' ||
       (current_date - cn.on_date) || ' days old: build it before it becomes a write-off'
from v_consults cn
where cn.state = 'unbilled' and cn.status = 'completed'
union all
-- Vaccinations overdue with nothing booked.
select 6, 'recall_overdue', r.patient, r.client, r.vaccine,
       r.days_overdue,
       r.vaccine || ' was due ' || to_char(r.due_on, 'YYYY-MM-DD') || ' (' || r.days_overdue ||
       ' days ago) and nothing is booked: every lapsed recall is a patient quietly becoming someone else''s'
from v_reminders r
where r.state in ('OVERDUE', 'LONG OVERDUE') and r.next_appt_on is null
union all
-- Money past 30 days.
select 7, 'debtor', i.client, '', count(*) || ' invoice(s)',
       max(i.days_overdue),
       '$' || to_char(sum(i.total_cents) / 100.0, 'FM999,999,990') || ' outstanding, oldest ' || max(i.days_overdue) ||
       ' days past due: ring before it ages another bucket'
from v_invoices i
where i.state in ('OVERDUE 30+', 'OVERDUE 60+')
group by i.client
union all
-- An expired batch still on the shelf.
select 8, 'batch_expired', st.code, st.name, st.batch_no,
       abs(coalesce(st.batch_days_left, 0)),
       'batch ' || coalesce(st.batch_no, '?') || ' expired ' || to_char(st.batch_expires_on, 'YYYY-MM-DD') ||
       ' with ' || st.stock_qty || ' ' || st.unit || ' on the shelf: quarantine it now, the dispensing gate already refuses it'
from v_stock st
where st.state = 'EXPIRED BATCH'
union all
-- A batch inside 60 days.
select 9, 'batch_expiring', st.code, st.name, st.batch_no,
       st.batch_days_left,
       'batch ' || coalesce(st.batch_no, '?') || ' expires ' || to_char(st.batch_expires_on, 'YYYY-MM-DD') ||
       ' (' || st.batch_days_left || ' days) with ' || st.stock_qty || ' ' || st.unit || ' on hand: use it or return it'
from v_stock st
where st.state = 'batch expiring'
union all
-- Stock at or under its reorder point.
select 10, 'stock_low', st.code, st.name, '',
       null,
       st.stock_qty || ' ' || st.unit || ' on hand, reorder point ' || st.reorder_at || ': order it'
from v_stock st
where st.state in ('low', 'OUT')
union all
-- A practising certificate inside 30 days.
select 11, 'apc_expiring', s.name, '', s.role,
       s.apc_days_left,
       'practising certificate expires ' || to_char(s.apc_expires_on, 'YYYY-MM-DD') ||
       ' (' || s.apc_days_left || ' days): renew with the Council now, the booking gate will refuse the day it lapses'
from v_staff s
where s.role = 'vet' and s.status = 'active' and s.apc = 'expiring'
union all
-- A past appointment nobody resolved.
select 12, 'appt_unconfirmed', a.ref, a.patient, a.vet,
       (current_date - a.on_date),
       'booked ' || to_char(a.on_date, 'YYYY-MM-DD') || ' ' || to_char(a.starts_at, 'HH24:MI') ||
       ' and never completed, cancelled or marked a no-show: what happened?'
from v_appointments a
where a.state = 'UNCONFIRMED'
union all
-- A dog with no microchip on record.
select 13, 'microchip_missing', p.name, p.client, coalesce(p.breed, 'dog'),
       null,
       'no microchip on record: dogs must be microchipped within two months of first registration (Dog Control Act 1996 s 36A). Chip at the next visit and register it on the NZCAR'
from v_patients p
where p.status = 'active' and p.species = 'dog' and (p.microchip is null or p.microchip = '')
union all
-- A patient the clinic is quietly losing.
select 14, 'patient_lapsed', l.patient, l.client, l.species,
       l.days_since,
       'not seen for ' || l.days_since || ' days, nothing booked, ' ||
       '$' || to_char(l.lifetime_cents / 100.0, 'FM999,999,990') || ' of lifetime care: one reminder call brings most of these back'
from v_lapsed l;
