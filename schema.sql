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
  quota_percent numeric(5,1) not null default 100, -- Soll-Anteil am WG-Haushalt in % (eine Nachkommastelle, Summe aller Mitglieder sollte zwischen 98 und 100 liegen)
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
  assigned_member_ids uuid[] default '{}', -- leer = für alle / ganzer Rotations-Pool
  rotation_enabled boolean not null default false, -- true = Aufgabe rotiert automatisch statt fest zugewiesen zu sein
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

-- Vorkommnis-Zuteilung für rotierende Aufgaben: wer ist für welches konkrete
-- Vorkommnis-Datum (occurrence_date) einer Aufgabe zuständig. Eine Aufgabe
-- kann mehrmals pro Woche fällig sein (z.B. alle 2 Tage) - deshalb pro
-- konkretem Datum ein eigener Eintrag, nicht nur einer pro Kalenderwoche.
-- week_start (Montag der Woche, in die occurrence_date fällt) ist nur zur
-- einfacheren Gruppierung/Filterung mitgespeichert. completed_at wird
-- gesetzt, sobald genau dieses Vorkommnis erledigt wurde (unabhängig von
-- anderen Vorkommnissen derselben Aufgabe in derselben Woche). Einmal
-- gesetzte Zuteilungen werden nie wieder überschrieben (wird von der App nie
-- überschrieben, außer über "Neu mischen" ab der jeweils kommenden Woche).
create table if not exists task_assignments (
  task_id uuid references tasks(id) on delete cascade not null,
  occurrence_date date not null,
  week_start date not null,
  member_id uuid references members(id) on delete set null,
  completed_at timestamptz,
  assigned_at timestamptz default now(),
  primary key (task_id, occurrence_date)
);

-- Teams: Gruppierung von Mitgliedern mit eigenem Soll-Anteil pro Team.
-- Eine Person kann in mehreren Teams sein, mit unterschiedlichem Soll-Anteil.
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  wg_id uuid references wgs(id) on delete cascade not null,
  name text not null,
  created_at timestamptz default now()
);

-- Mitgliedschaft in einem Team inkl. team-eigenem Soll-Anteil und
-- team-eigenem (rücksetzbarem) Punktestand.
create table if not exists team_members (
  team_id uuid references teams(id) on delete cascade not null,
  member_id uuid references members(id) on delete cascade not null,
  quota_percent numeric(5,1) not null default 0,
  points int not null default 0,
  primary key (team_id, member_id)
);

-- Aufgaben können jetzt optional einem oder mehreren Teams zugeordnet werden
-- (nur relevant bei "Rotierend" - leer = rotiert über alle Mitglieder/Teams).
alter table tasks add column if not exists team_ids uuid[] default '{}';

-- Row Level Security aktivieren
alter table wgs enable row level security;
alter table members enable row level security;
alter table tasks enable row level security;
alter table completions enable row level security;
alter table task_assignments enable row level security;
alter table teams enable row level security;
alter table team_members enable row level security;

-- Diese App hat bewusst kein Login ("Vertrauens-App"). Jeder, der
-- den anon-key + die WG-Code kennt, darf lesen/schreiben. Das ist für eine
-- private WG-Tool-Nutzung ausreichend und gewollt.
create policy "public_all_wgs" on wgs for all using (true) with check (true);
create policy "public_all_members" on members for all using (true) with check (true);
create policy "public_all_tasks" on tasks for all using (true) with check (true);
create policy "public_all_completions" on completions for all using (true) with check (true);
create policy "public_all_task_assignments" on task_assignments for all using (true) with check (true);
create policy "public_all_teams" on teams for all using (true) with check (true);
create policy "public_all_team_members" on team_members for all using (true) with check (true);

-- Realtime aktivieren, damit alle Geräte sofort Änderungen sehen
alter publication supabase_realtime add table members;
alter publication supabase_realtime add table tasks;
alter publication supabase_realtime add table completions;
alter publication supabase_realtime add table task_assignments;
alter publication supabase_realtime add table teams;
alter publication supabase_realtime add table team_members;

-- ====================================================================
-- MIGRATION für bereits bestehende Datenbanken (nur EINMAL ausführen,
-- falls du schema.sql schon vorher komplett ausgeführt hattest):
-- Ändert quota_percent von int auf eine Nachkommastelle, damit z. B.
-- 33.3% bei "Gleichmäßig verteilen" gespeichert werden kann.
-- ====================================================================
-- alter table members alter column quota_percent type numeric(5,1);

-- Neu für die Rotations-Funktion (einmalig ausführen, falls die Tabelle
-- "tasks" schon vorher existierte):
-- alter table tasks add column if not exists rotation_enabled boolean not null default false;

-- Neu: eigene Tabelle für die Wochen-Zuteilung (ersetzt die ursprünglich
-- geplanten Spalten rotation_assignee_id/rotation_week_start direkt an der
-- Aufgabe - falls du die testweise schon angelegt hattest, werden sie von
-- der App nicht mehr benutzt und können bleiben oder gelöscht werden):
-- create table if not exists task_assignments (
--   task_id uuid references tasks(id) on delete cascade not null,
--   week_start date not null,
--   member_id uuid references members(id) on delete set null,
--   assigned_at timestamptz default now(),
--   primary key (task_id, week_start)
-- );
-- alter table task_assignments enable row level security;
-- create policy "public_all_task_assignments" on task_assignments for all using (true) with check (true);
-- alter publication supabase_realtime add table task_assignments;

-- Neu: Teams-Feature (einmalig ausführen, falls "tasks"/"members" schon
-- vorher existierten). Der Soll-Anteil lebt ab jetzt komplett auf Team-Ebene -
-- members.quota_percent wird von der App nicht mehr benutzt, kann aber bleiben.
-- create table if not exists teams (
--   id uuid primary key default gen_random_uuid(),
--   wg_id uuid references wgs(id) on delete cascade not null,
--   name text not null,
--   created_at timestamptz default now()
-- );
-- create table if not exists team_members (
--   team_id uuid references teams(id) on delete cascade not null,
--   member_id uuid references members(id) on delete cascade not null,
--   quota_percent numeric(5,1) not null default 0,
--   points int not null default 0,
--   primary key (team_id, member_id)
-- );
-- alter table tasks add column if not exists team_ids uuid[] default '{}';
-- alter table teams enable row level security;
-- alter table team_members enable row level security;
-- create policy "public_all_teams" on teams for all using (true) with check (true);
-- create policy "public_all_team_members" on team_members for all using (true) with check (true);
-- alter publication supabase_realtime add table teams;
-- alter publication supabase_realtime add table team_members;

-- ====================================================================
-- WICHTIG - BREAKING CHANGE: "task_assignments" wurde umgebaut (ein Eintrag
-- pro konkretem Vorkommnis-Datum statt nur einer pro Kalenderwoche, damit
-- mehrmals pro Woche fällige Aufgaben als mehrere To-Do-Einträge auftauchen).
-- Falls die Tabelle schon in der ALTEN Form (PK auf task_id+week_start)
-- existiert, MUSS sie neu angelegt werden - die alten Zeilen lassen sich
-- nicht sinnvoll übernehmen. Einmalig ausführen:
-- drop table if exists task_assignments cascade;
-- create table if not exists task_assignments (
--   task_id uuid references tasks(id) on delete cascade not null,
--   occurrence_date date not null,
--   week_start date not null,
--   member_id uuid references members(id) on delete set null,
--   completed_at timestamptz,
--   assigned_at timestamptz default now(),
--   primary key (task_id, occurrence_date)
-- );
-- alter table task_assignments enable row level security;
-- create policy "public_all_task_assignments" on task_assignments for all using (true) with check (true);
-- alter publication supabase_realtime add table task_assignments;
