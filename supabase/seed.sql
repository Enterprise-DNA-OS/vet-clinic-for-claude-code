-- Demo data for vet-clinic-for-claude-code.
-- Harbourview Vets, a fictional Tauranga small-animal clinic: eight owners,
-- eleven patients, six staff, thirteen items, a fortnight of appointments,
-- a consult history with weights and notes, a vaccination record, nine
-- invoices, and a controlled drug register.
--
-- Deliberately messy, so the attention list has something to say:
--   the ketamine register shows 46.5 ml, the shelf count is 44 (a 2.5 ml discrepancy)
--   Dr Priya Nair holds three appointments next week with her practising certificate expired 12 days ago
--   two completed procedures (Banjo's dental, Clover's spey) with no consent on record
--   about $461 of completed consults never invoiced, oldest 16 days
--   five patients overdue a vaccination with nothing booked, oldest 400 days
--   $599 outstanding past 30 days across two owners, oldest 68 days
--   an amoxicillin-clavulanate batch expired 20 days ago with 34 tablets on the shelf
--   the meloxicam batch expires in 45 days; Bravecto is at 2 with a reorder point of 6
--   Dr Tuala's practising certificate expires in 25 days
--   one past appointment never completed, cancelled or marked a no-show
--   Juno and Tui, both dogs, with no microchip on record
--   Rusty and Minka not seen in over 18 months with nothing booked
--
-- Dates are relative to current_date. Ids are derived from names with
-- seed_uuid, and every insert is ON CONFLICT DO NOTHING, so running it twice
-- changes nothing.
--
-- Owners, patients, staff, prices and events are DEMO VALUES for a fictional
-- clinic. No real person, animal or practice is depicted.

create or replace function seed_uuid(seed text) returns uuid language sql immutable as $$
  select (substr(m, 1, 8) || '-' || substr(m, 9, 4) || '-4' || substr(m, 13, 3)
          || '-8' || substr(m, 16, 3) || '-' || substr(m, 19, 12))::uuid
  from (select md5(seed) as m) s
$$;

-- Clients ------------------------------------------------------------------------

insert into clients (id, name, phone, email, address, suburb, status) values
  (seed_uuid('client:petrie'),   'Alan Petrie',     '021 555 0101', 'alan.petrie@example.nz',   '14 Harbour View Road', 'Otumoetai',    'active'),
  (seed_uuid('client:lin'),      'Mei Lin',         '021 555 0102', 'mei.lin@example.nz',       '3 Kulim Avenue',       'Bellevue',     'active'),
  (seed_uuid('client:cavanagh'), 'Trish Cavanagh',  '021 555 0103', 't.cavanagh@example.nz',    '88 Oceanbeach Road',   'Mount Maunganui', 'active'),
  (seed_uuid('client:weir'),     'Gordon Weir',     '021 555 0104', 'g.weir@example.nz',        '451 Welcome Bay Road', 'Welcome Bay',  'active'),
  (seed_uuid('client:ashford'),  'Sarah Ashford',   '021 555 0105', 'sarah.ashford@example.nz', '9 Levers Road',        'Matua',        'active'),
  (seed_uuid('client:kereama'),  'Nikau Kereama',   '021 555 0106', 'n.kereama@example.nz',     '27 Ngatai Road',       'Otumoetai',    'active'),
  (seed_uuid('client:donovan'),  'Fiona Donovan',   '021 555 0107', 'f.donovan@example.nz',     '5 Pooles Road',        'Greerton',     'active'),
  (seed_uuid('client:squires'),  'Paul Squires',    '021 555 0108', 'p.squires@example.nz',     '12 Maxwells Road',     'Pillans Point','former')
on conflict do nothing;

-- Staff ---------------------------------------------------------------------------
-- Dr Nair's practising certificate expired 12 days ago and she is still in
-- the book next week: that is the breach the attention list exists to shout
-- about. Dr Tuala's expires in 25 days, which is the polite version.

insert into staff (id, name, role, employment, registration_number, apc_expires_on, phone, email, status) values
  (seed_uuid('staff:cole'),   'Dr Miriam Cole', 'vet',       'permanent', 'V-08841', current_date + 320, '021 555 0201', 'miriam@harbourviewvets.example.nz', 'active'),
  (seed_uuid('staff:tuala'),  'Dr Sione Tuala', 'vet',       'permanent', 'V-09235', current_date + 25,  '021 555 0202', 'sione@harbourviewvets.example.nz',  'active'),
  (seed_uuid('staff:nair'),   'Dr Priya Nair',  'vet',       'locum',     'V-10112', current_date - 12,  '021 555 0203', 'priya.nair@example.nz',             'active'),
  (seed_uuid('staff:harmon'), 'Bex Harmon',     'nurse',     'permanent', null,      null,               '021 555 0204', 'bex@harbourviewvets.example.nz',    'active'),
  (seed_uuid('staff:ngata'),  'Carol Ngata',    'manager',   'permanent', null,      null,               '021 555 0205', 'carol@harbourviewvets.example.nz',  'active'),
  (seed_uuid('staff:reece'),  'Dr Alan Reece',  'vet',       'permanent', 'V-05520', current_date + 90,  '021 555 0206', 'alan.reece@example.nz',             'former')
on conflict do nothing;

-- Patients ---------------------------------------------------------------------------
-- Juno and Tui have no microchip: for dogs that is a Dog Control Act problem,
-- not a style choice. Pippa is deceased and stays on file, because the record
-- is kept.

insert into patients (id, ref, name, client_id, species, breed, sex, dob, microchip, status, deceased_on) values
  (seed_uuid('pt:baxter'),  'PT-101', 'Baxter',  seed_uuid('client:petrie'),   'dog',    'Labrador',        'male neutered',  current_date - 2555, '985113004417201', 'active',   null),
  (seed_uuid('pt:juno'),    'PT-102', 'Juno',    seed_uuid('client:petrie'),   'dog',    'Border Collie',   'female',         current_date - 1642, null,              'active',   null),
  (seed_uuid('pt:mochi'),   'PT-103', 'Mochi',   seed_uuid('client:lin'),      'cat',    'Domestic Short Hair', 'female speyed', current_date - 1825, '985113004417202', 'active', null),
  (seed_uuid('pt:banjo'),   'PT-104', 'Banjo',   seed_uuid('client:cavanagh'), 'dog',    'Cocker Spaniel',  'male',           current_date - 2920, '985113004417203', 'active',   null),
  (seed_uuid('pt:tui'),     'PT-105', 'Tui',     seed_uuid('client:weir'),     'dog',    'Huntaway',        'female',         current_date - 2190, null,              'active',   null),
  (seed_uuid('pt:clover'),  'PT-106', 'Clover',  seed_uuid('client:ashford'),  'cat',    'Ragdoll',         'female speyed',  current_date - 620,  '985113004417204', 'active',   null),
  (seed_uuid('pt:biscuit'), 'PT-107', 'Biscuit', seed_uuid('client:ashford'),  'rabbit', 'Mini Lop',        'male',           current_date - 730,  null,              'active',   null),
  (seed_uuid('pt:rusty'),   'PT-108', 'Rusty',   seed_uuid('client:kereama'),  'dog',    'Fox Terrier',     'male neutered',  current_date - 3285, '985113004417205', 'active',   null),
  (seed_uuid('pt:minka'),   'PT-109', 'Minka',   seed_uuid('client:donovan'),  'cat',    'Burmese',         'female speyed',  current_date - 2555, '985113004417206', 'active',   null),
  (seed_uuid('pt:ziggy'),   'PT-110', 'Ziggy',   seed_uuid('client:donovan'),  'dog',    'Schnauzer cross', 'male neutered',  current_date - 1095, '985113004417207', 'active',   null),
  (seed_uuid('pt:pippa'),   'PT-111', 'Pippa',   seed_uuid('client:squires'),  'dog',    'Beagle',          'female speyed',  current_date - 5475, '985113004417208', 'deceased', current_date - 700)
on conflict do nothing;

-- Items ---------------------------------------------------------------------------
-- DEMO prices. The two flags matter more than the numbers: rvm means only a
-- vet's consult dispenses it (ACVM Act 1997), controlled means every movement
-- is a register entry (Misuse of Drugs Regulations 1977).

insert into items (id, code, name, kind, unit, price_cents, rvm, controlled, track_stock, stock_qty, reorder_at, batch_no, batch_expires_on, note) values
  (seed_uuid('item:cons-std'),  'CONS-STD',  'Standard consult',                        'service',  'each',   8900,  false, false, false, 0,    null, null,      null,               null),
  (seed_uuid('item:cons-ext'),  'CONS-EXT',  'Extended consult',                        'service',  'each',   13500, false, false, false, 0,    null, null,      null,               null),
  (seed_uuid('item:vacc-dhp'),  'VACC-DHP',  'Canine DHP vaccination',                  'service',  'each',   9500,  false, false, false, 0,    null, null,      null,               null),
  (seed_uuid('item:vacc-lep'),  'VACC-LEPTO','Canine leptospirosis vaccination',        'service',  'each',   7800,  false, false, false, 0,    null, null,      null,               null),
  (seed_uuid('item:vacc-f3'),   'VACC-F3',   'Feline F3 vaccination',                   'service',  'each',   9200,  false, false, false, 0,    null, null,      null,               null),
  (seed_uuid('item:spey'),      'SURG-SPEY', 'Cat spey',                                'service',  'each',   28500, false, false, false, 0,    null, null,      null,               null),
  (seed_uuid('item:dental'),    'DENT-SP',   'Dental scale and polish',                 'service',  'each',   42000, false, false, false, 0,    null, null,      null,               null),
  (seed_uuid('item:chip'),      'MICROCHIP', 'Microchip and NZCAR registration',        'service',  'each',   5500,  false, false, false, 0,    null, null,      null,               null),
  (seed_uuid('item:ket'),       'KET-100',   'Ketamine 100 mg/ml',                      'medicine', 'ml',     950,   true,  true,  true,  44.0, 20,   'KT-2419', current_date + 200, 'Class C controlled drug. Register required.'),
  (seed_uuid('item:meth'),      'METH-10',   'Methadone 10 mg/ml',                      'medicine', 'ml',     1200,  true,  true,  true,  18.0, 10,   'MD-1108', current_date + 150, 'Class B controlled drug. Register required.'),
  (seed_uuid('item:amox'),      'AMOX-250',  'Amoxicillin-clavulanate 250 mg',          'medicine', 'tablet', 210,   true,  false, true,  34,   20,   'AC-0332', current_date - 20,  null),
  (seed_uuid('item:melox'),     'MELOX-32',  'Meloxicam oral suspension 32 ml',         'medicine', 'each',   4600,  true,  false, true,  6,    4,    'MX-7719', current_date + 45,  null),
  (seed_uuid('item:brav'),      'BRAV-L',    'Bravecto chew, large dog',                'medicine', 'each',   7800,  false, false, true,  2,    6,    'BV-5561', current_date + 400, null)
on conflict do nothing;

-- Appointments ---------------------------------------------------------------------------
-- Today's book, the week ahead (three of them Dr Nair's, which the gate would
-- never have allowed today), one past appointment nobody resolved, Trish
-- Cavanagh's two no-shows, and the two completed ones behind past consults.

insert into appointments (id, ref, patient_id, staff_id, on_date, starts_at, minutes, type, reason, status, cancel_reason) values
  -- today
  (seed_uuid('ap:mochi-today'),   'AP-1001', seed_uuid('pt:mochi'),   seed_uuid('staff:cole'),  current_date,      '09:00', 30, 'recheck',     'Overgrooming review',            'scheduled', null),
  (seed_uuid('ap:biscuit-today'), 'AP-1002', seed_uuid('pt:biscuit'), seed_uuid('staff:tuala'), current_date,      '10:00', 30, 'consult',     'Reduced appetite',               'scheduled', null),
  (seed_uuid('ap:baxter-today'),  'AP-1003', seed_uuid('pt:baxter'),  seed_uuid('staff:cole'),  current_date,      '14:30', 15, 'consult',     'Blood sample, PU/PD workup',     'scheduled', null),
  -- the week ahead
  (seed_uuid('ap:banjo-recheck'), 'AP-1004', seed_uuid('pt:banjo'),   seed_uuid('staff:tuala'), current_date + 3,  '10:00', 15, 'recheck',     'Gum check post dental',          'scheduled', null),
  (seed_uuid('ap:clover-nair'),   'AP-1005', seed_uuid('pt:clover'),  seed_uuid('staff:nair'),  current_date + 2,  '09:00', 15, 'recheck',     'Suture check',                   'scheduled', null),
  (seed_uuid('ap:ziggy-nair'),    'AP-1006', seed_uuid('pt:ziggy'),   seed_uuid('staff:nair'),  current_date + 2,  '09:30', 30, 'consult',     'Itch review',                    'scheduled', null),
  (seed_uuid('ap:juno2-nair'),    'AP-1007', seed_uuid('pt:baxter'),  seed_uuid('staff:nair'),  current_date + 4,  '11:00', 30, 'consult',     'Bloods review',                  'scheduled', null),
  -- past, never resolved
  (seed_uuid('ap:tui-unconf'),    'AP-1008', seed_uuid('pt:tui'),     seed_uuid('staff:tuala'), current_date - 5,  '15:00', 30, 'recheck',     'Lameness recheck',               'scheduled', null),
  -- Trish Cavanagh's no-shows
  (seed_uuid('ap:banjo-ns1'),     'AP-1009', seed_uuid('pt:banjo'),   seed_uuid('staff:tuala'), current_date - 70, '11:00', 30, 'consult',     'Dental estimate discussion',     'no_show',   null),
  (seed_uuid('ap:banjo-ns2'),     'AP-1010', seed_uuid('pt:banjo'),   seed_uuid('staff:tuala'), current_date - 40, '09:30', 15, 'recheck',     'Gum check post dental',          'no_show',   null),
  -- cancelled
  (seed_uuid('ap:mochi-cxl'),     'AP-1011', seed_uuid('pt:mochi'),   seed_uuid('staff:cole'),  current_date - 12, '09:00', 30, 'consult',     'Overgrooming',                   'cancelled', 'Mei away for work, rebooked'),
  -- completed (their consults reference these)
  (seed_uuid('ap:banjo-dental'),  'AP-1012', seed_uuid('pt:banjo'),   seed_uuid('staff:tuala'), current_date - 82, '08:30', 120, 'dental',     'Grade 3 dental disease',         'completed', null),
  (seed_uuid('ap:mochi-past'),    'AP-1013', seed_uuid('pt:mochi'),   seed_uuid('staff:cole'),  current_date - 9,  '09:00', 30, 'consult',     'Overgrooming, flank',            'completed', null)
on conflict do nothing;

-- Consults ---------------------------------------------------------------------------
-- The clinical history. Baxter's weight is drifting up across three visits;
-- CN-2004 and CN-2005 are the procedures with no consent on record; CN-2011
-- is the open consult going stale; CN-2006, CN-2007 and CN-2008 are finished
-- work nobody invoiced.

insert into consults (id, ref, appointment_id, patient_id, staff_id, on_date, type, reason, weight_kg, notes, recheck_on, consent_on, status) values
  (seed_uuid('cn:2001'), 'CN-2001', null, seed_uuid('pt:baxter'), seed_uuid('staff:cole'),  current_date - 300, 'vaccination', 'Annual health check and DHP booster', 32.1, 'Bright and well. Heart and lungs clear, teeth grade 1 tartar. DHP given, due again in 12 months. Discussed weight: lean, keep current feeding.', null, null, 'completed'),
  (seed_uuid('cn:2009'), 'CN-2009', null, seed_uuid('pt:baxter'), seed_uuid('staff:tuala'), current_date - 150, 'consult',     'Left ear irritation',                  33.4, 'Mild otitis externa left ear, cleaned in clinic. Ear cleaner dispensed from shelf stock. Recheck if head shaking persists. Weight up 1.3 kg since annual: mentioned to Alan.', null, null, 'completed'),
  (seed_uuid('cn:2002'), 'CN-2002', null, seed_uuid('pt:rusty'),  seed_uuid('staff:cole'),  current_date - 610, 'consult',     'Annual health check',                  9.8,  'Senior check, all parameters good for age. Bloods declined this year. DHP given.', null, null, 'completed'),
  (seed_uuid('cn:2003'), 'CN-2003', null, seed_uuid('pt:minka'),  seed_uuid('staff:tuala'), current_date - 580, 'vaccination', 'F3 booster',                           4.1,  'Well cat, F3 given. Slight gingivitis, advised dental review next visit.', null, null, 'completed'),
  (seed_uuid('cn:2004'), 'CN-2004', seed_uuid('ap:banjo-dental'), seed_uuid('pt:banjo'), seed_uuid('staff:tuala'), current_date - 82, 'dental', 'Grade 3 dental disease', 14.2, 'GA, full mouth scale and polish, two extractions (108, 208). Recovered well. Ketamine in premed per anaesthesia record. Amoxicillin-clavulanate 14 tablets to go home. Recheck gums in 10 days.', null, null, 'completed'),
  (seed_uuid('cn:2005'), 'CN-2005', null, seed_uuid('pt:clover'), seed_uuid('staff:cole'),  current_date - 30,  'surgery',     'Routine spey',                         3.6,  'Routine ovariohysterectomy, uneventful. Ketamine in premed per anaesthesia record. Meloxicam to go home, 3 days. Sutures out in 10 days.', null, null, 'completed'),
  (seed_uuid('cn:2006'), 'CN-2006', null, seed_uuid('pt:tui'),    seed_uuid('staff:tuala'), current_date - 16,  'consult',     'Lame right hind after a fall on the farm', 28.5, 'Grade 2/5 lame right hind, pain on stifle flexion. No instability. Methadone given in clinic for examination. Bravecto while she was in. Strict rest 2 weeks, recheck if not improving.', null, null, 'completed'),
  (seed_uuid('cn:2010'), 'CN-2010', null, seed_uuid('pt:tui'),    seed_uuid('staff:cole'),  current_date - 55,  'consult',     'Cut pad, left front',                  28.1, 'Superficial pad laceration, cleaned and dressed. Amoxicillin-clavulanate 20 tablets. Keep dry one week.', null, null, 'completed'),
  (seed_uuid('cn:2007'), 'CN-2007', seed_uuid('ap:mochi-past'), seed_uuid('pt:mochi'), seed_uuid('staff:cole'), current_date - 9, 'consult', 'Overgrooming, flank',       4.9,  'Barbered flank, skin intact. Likely stress-related; new dog next door. Meloxicam trialled 5 days at cat dose. Review in a fortnight, consider referral if no better.', current_date + 5, null, 'completed'),
  (seed_uuid('cn:2008'), 'CN-2008', null, seed_uuid('pt:baxter'), seed_uuid('staff:cole'),  current_date - 6,   'consult',     'Drinking more than usual',             34.8, 'PU/PD reported, 2 weeks. Exam unremarkable, weight up again. Urine sample collected, dipstick unremarkable, SG 1.018. Recommended bloods: Alan to confirm. Weight discussed again: 2.7 kg up on last year.', null, null, 'completed'),
  (seed_uuid('cn:2011'), 'CN-2011', null, seed_uuid('pt:ziggy'),  seed_uuid('staff:cole'),  current_date - 4,   'consult',     'Itchy, chewing paws',                  16.2, null, null, null, 'open'),
  (seed_uuid('cn:2012'), 'CN-2012', null, seed_uuid('pt:pippa'),  seed_uuid('staff:cole'),  current_date - 700, 'consult',     'Euthanasia',                           11.0, 'End-stage renal disease, decision made with the family. Peaceful, Paul present. Private cremation arranged.', null, null, 'completed'),
  (seed_uuid('cn:2013'), 'CN-2013', null, seed_uuid('pt:ziggy'),  seed_uuid('staff:tuala'), current_date - 26,  'consult',     'Vomiting, self-resolved',              16.0, 'Two vomits over the weekend, bright since, eating. Exam unremarkable. Bland diet 3 days, return if it recurs.', null, null, 'completed')
on conflict do nothing;

-- Consult lines ---------------------------------------------------------------------------

insert into consult_lines (id, consult_id, item_id, qty, unit_price_cents, note) values
  (seed_uuid('cl:2001a'), seed_uuid('cn:2001'), seed_uuid('item:cons-std'), 1,   8900,  null),
  (seed_uuid('cl:2001b'), seed_uuid('cn:2001'), seed_uuid('item:vacc-dhp'), 1,   9500,  null),
  (seed_uuid('cl:2009a'), seed_uuid('cn:2009'), seed_uuid('item:cons-std'), 1,   8900,  null),
  (seed_uuid('cl:2002a'), seed_uuid('cn:2002'), seed_uuid('item:cons-std'), 1,   8900,  null),
  (seed_uuid('cl:2002b'), seed_uuid('cn:2002'), seed_uuid('item:vacc-dhp'), 1,   9500,  null),
  (seed_uuid('cl:2003a'), seed_uuid('cn:2003'), seed_uuid('item:cons-std'), 1,   8900,  null),
  (seed_uuid('cl:2003b'), seed_uuid('cn:2003'), seed_uuid('item:vacc-f3'),  1,   9200,  null),
  (seed_uuid('cl:2004a'), seed_uuid('cn:2004'), seed_uuid('item:dental'),   1,   42000, 'Includes two extractions'),
  (seed_uuid('cl:2004b'), seed_uuid('cn:2004'), seed_uuid('item:ket'),      2.0, 950,   'Premed'),
  (seed_uuid('cl:2004c'), seed_uuid('cn:2004'), seed_uuid('item:amox'),     14,  210,   'To go home'),
  (seed_uuid('cl:2005a'), seed_uuid('cn:2005'), seed_uuid('item:spey'),     1,   28500, null),
  (seed_uuid('cl:2005b'), seed_uuid('cn:2005'), seed_uuid('item:ket'),      1.5, 950,   'Premed'),
  (seed_uuid('cl:2005c'), seed_uuid('cn:2005'), seed_uuid('item:melox'),    1,   4600,  'To go home, 3 days'),
  (seed_uuid('cl:2006a'), seed_uuid('cn:2006'), seed_uuid('item:cons-std'), 1,   8900,  null),
  (seed_uuid('cl:2006b'), seed_uuid('cn:2006'), seed_uuid('item:meth'),     2.0, 1200,  'In clinic, examination'),
  (seed_uuid('cl:2006c'), seed_uuid('cn:2006'), seed_uuid('item:brav'),     1,   7800,  null),
  (seed_uuid('cl:2010a'), seed_uuid('cn:2010'), seed_uuid('item:cons-std'), 1,   8900,  null),
  (seed_uuid('cl:2010b'), seed_uuid('cn:2010'), seed_uuid('item:amox'),     20,  210,   'To go home'),
  (seed_uuid('cl:2007a'), seed_uuid('cn:2007'), seed_uuid('item:cons-std'), 1,   8900,  null),
  (seed_uuid('cl:2007b'), seed_uuid('cn:2007'), seed_uuid('item:melox'),    1,   4600,  'Cat dose, 5 days'),
  (seed_uuid('cl:2008a'), seed_uuid('cn:2008'), seed_uuid('item:cons-ext'), 1,   13500, null),
  (seed_uuid('cl:2011a'), seed_uuid('cn:2011'), seed_uuid('item:cons-std'), 1,   8900,  null),
  (seed_uuid('cl:2012a'), seed_uuid('cn:2012'), seed_uuid('item:cons-ext'), 1,   13500, 'Euthanasia and aftercare'),
  (seed_uuid('cl:2013a'), seed_uuid('cn:2013'), seed_uuid('item:cons-std'), 1,   8900,  null)
on conflict do nothing;

-- Vaccinations ---------------------------------------------------------------------------
-- The recall story. Juno, Mochi, Tui, Rusty and Minka are overdue with
-- nothing booked; Banjo is overdue but has a recheck booked; Baxter and
-- Ziggy are due inside the month.

insert into vaccinations (id, patient_id, consult_id, staff_id, vaccine, given_on, due_on) values
  (seed_uuid('vx:baxter'), seed_uuid('pt:baxter'), seed_uuid('cn:2001'), seed_uuid('staff:cole'),  'Canine DHP', current_date - 300, current_date + 15),
  (seed_uuid('vx:juno'),   seed_uuid('pt:juno'),   null,                 seed_uuid('staff:cole'),  'Canine DHP', current_date - 579, current_date - 214),
  (seed_uuid('vx:mochi'),  seed_uuid('pt:mochi'),  null,                 seed_uuid('staff:tuala'), 'Feline F3',  current_date - 425, current_date - 60),
  (seed_uuid('vx:tui'),    seed_uuid('pt:tui'),    null,                 seed_uuid('staff:cole'),  'Canine DHP', current_date - 485, current_date - 120),
  (seed_uuid('vx:banjo'),  seed_uuid('pt:banjo'),  null,                 seed_uuid('staff:tuala'), 'Canine DHP', current_date - 395, current_date - 30),
  (seed_uuid('vx:clover'), seed_uuid('pt:clover'), null,                 seed_uuid('staff:cole'),  'Feline F3',  current_date - 165, current_date + 200),
  (seed_uuid('vx:ziggy'),  seed_uuid('pt:ziggy'),  null,                 seed_uuid('staff:tuala'), 'Canine DHP', current_date - 355, current_date + 10),
  (seed_uuid('vx:rusty'),  seed_uuid('pt:rusty'),  seed_uuid('cn:2002'), seed_uuid('staff:cole'),  'Canine DHP', current_date - 610, current_date - 245),
  (seed_uuid('vx:minka'),  seed_uuid('pt:minka'),  seed_uuid('cn:2003'), seed_uuid('staff:tuala'), 'Feline F3',  current_date - 580, current_date - 215)
on conflict do nothing;

-- Invoices ---------------------------------------------------------------------------
-- Six paid, three outstanding: Trish Cavanagh's dental at 68 days past due,
-- Gordon Weir's at 41, Fiona Donovan's at 12.

insert into invoices (id, ref, client_id, consult_id, issued_on, due_on, total_cents, status, paid_on) values
  (seed_uuid('inv:3001'), 'INV-3001', seed_uuid('client:petrie'),   seed_uuid('cn:2001'), current_date - 300, current_date - 286, 18400, 'paid',   current_date - 290),
  (seed_uuid('inv:3002'), 'INV-3002', seed_uuid('client:kereama'),  seed_uuid('cn:2002'), current_date - 610, current_date - 596, 18400, 'paid',   current_date - 601),
  (seed_uuid('inv:3003'), 'INV-3003', seed_uuid('client:donovan'),  seed_uuid('cn:2003'), current_date - 580, current_date - 566, 18100, 'paid',   current_date - 570),
  (seed_uuid('inv:3004'), 'INV-3004', seed_uuid('client:cavanagh'), seed_uuid('cn:2004'), current_date - 82,  current_date - 68,  46840, 'issued', null),
  (seed_uuid('inv:3005'), 'INV-3005', seed_uuid('client:ashford'),  seed_uuid('cn:2005'), current_date - 30,  current_date - 16,  34525, 'paid',   current_date - 18),
  (seed_uuid('inv:3006'), 'INV-3006', seed_uuid('client:weir'),     seed_uuid('cn:2010'), current_date - 55,  current_date - 41,  13100, 'issued', null),
  (seed_uuid('inv:3007'), 'INV-3007', seed_uuid('client:donovan'),  seed_uuid('cn:2013'), current_date - 26,  current_date - 12,  8900,  'issued', null),
  (seed_uuid('inv:3008'), 'INV-3008', seed_uuid('client:petrie'),   seed_uuid('cn:2009'), current_date - 150, current_date - 136, 8900,  'paid',   current_date - 140),
  (seed_uuid('inv:3009'), 'INV-3009', seed_uuid('client:squires'),  seed_uuid('cn:2012'), current_date - 700, current_date - 686, 13500, 'paid',   current_date - 692)
on conflict do nothing;

-- Controlled drug register ---------------------------------------------------------------------------
-- The ketamine register totals 46.5 ml; the items row (the shelf count) says
-- 44.0. That 2.5 ml discrepancy is the loudest row in the attention list, by
-- design. Methadone reconciles exactly.

insert into drug_register (id, item_id, entry_on, movement, qty, balance_after, patient_id, consult_id, staff_id, witness, note) values
  (seed_uuid('dr:ket1'),  seed_uuid('item:ket'),  current_date - 90, 'received',  50.0, 50.0, null,                  null,                 seed_uuid('staff:cole'),  null, 'Invoice 88412, ProVet wholesale'),
  (seed_uuid('dr:ket2'),  seed_uuid('item:ket'),  current_date - 82, 'dispensed', 2.0,  48.0, seed_uuid('pt:banjo'), seed_uuid('cn:2004'), seed_uuid('staff:tuala'), null, 'Dental premed'),
  (seed_uuid('dr:ket3'),  seed_uuid('item:ket'),  current_date - 30, 'dispensed', 1.5,  46.5, seed_uuid('pt:clover'),seed_uuid('cn:2005'), seed_uuid('staff:cole'),  null, 'Spey premed'),
  (seed_uuid('dr:meth1'), seed_uuid('item:meth'), current_date - 60, 'received',  20.0, 20.0, null,                  null,                 seed_uuid('staff:cole'),  null, 'Invoice 89102, ProVet wholesale'),
  (seed_uuid('dr:meth2'), seed_uuid('item:meth'), current_date - 16, 'dispensed', 2.0,  18.0, seed_uuid('pt:tui'),   seed_uuid('cn:2006'), seed_uuid('staff:tuala'), null, 'Analgesia, lameness exam')
on conflict do nothing;

-- File notes ---------------------------------------------------------------------------

insert into file_notes (id, patient_id, client_id, staff_id, noted_on, note) values
  (seed_uuid('fn:1'), seed_uuid('pt:banjo'), seed_uuid('client:cavanagh'), seed_uuid('staff:ngata'), current_date - 35, 'Called Trish re the dental account, now a month past due. She will "sort it this week". Second call, same answer as the first.'),
  (seed_uuid('fn:2'), seed_uuid('pt:rusty'), seed_uuid('client:kereama'),  seed_uuid('staff:ngata'), current_date - 90, 'Reminder card returned to sender. Nikau may have moved; mobile unchanged. Try a call at the next recall run.')
on conflict do nothing;
