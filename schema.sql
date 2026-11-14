-- ====================================================================
-- WG-App Datenbankschema für Supabase
-- Diesen gesamten Code im Supabase SQL Editor ausführen (siehe README.md)
-- ====================================================================

create extension if not exists "pgcrypto";

-- WGs (jede WG hat einen eindeutigen Beitrittscode)
create table if not exists wgs (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  created_at timestamptz default now()
);

-- Mitglieder einer WG
create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  wg_id uuid references wgs(id) on delete cascade not null,
  name text not null,
  quota_percent int not null default 100, -- Soll-Anteil am WG-Haushalt in %
  points int not null default 0,
  created_at timestamptz default now()
);

-- Aufgaben / Aktivitäten
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  wg_id uuid references wgs(id) on delete cascade not null,
  title text not null,
  details text default '',
  points int not null default 10,
  cycle_days int not null default 7, -- Wiederholungszyklus in Tagen
  assigned_member_ids uuid[] default '{}', -- leer = für alle
  last_done_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Historie erledigter Aufgaben (optional, für spätere Auswertungen)
create table if not exists completions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete cascade not null,
  member_id uuid references members(id) on delete set null,
  points int not null,
  completed_at timestamptz default now()
);

-- Row Level Security aktivieren
alter table wgs enable row level security;
alter table members enable row level security;
alter table tasks enable row level security;
alter table completions enable row level security;

-- Diese App hat bewusst kein Login ("Vertrauens-App"). Jeder, der
-- den anon-key + die WG-Code kennt, darf lesen/schreiben. Das ist für eine
-- private WG-Tool-Nutzung ausreichend und gewollt.
create policy "public_all_wgs" on wgs for all using (true) with check (true);
create policy "public_all_members" on members for all using (true) with check (true);
create policy "public_all_tasks" on tasks for all using (true) with check (true);
create policy "public_all_completions" on completions for all using (true) with check (true);

-- Realtime aktivieren, damit alle Geräte sofort Änderungen sehen
alter publication supabase_realtime add table members;
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table completions;
