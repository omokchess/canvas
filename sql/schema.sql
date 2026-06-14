-- Supabase SQL Schema for P2P Collaborative Drawing Board

-- 1. Create rooms table
create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text unique not null,
  title text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index for room_code lookups
create index if not exists idx_rooms_room_code on rooms(room_code);

-- 2. Create strokes table for collaborative lines
create table if not exists strokes (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references rooms(room_code) on delete cascade,
  user_id text not null,
  tool text not null,
  color text not null,
  size integer not null,
  points jsonb not null,
  is_deleted boolean default false,
  created_at timestamptz default now()
);

-- Index for looking up strokes and ordering them by creation time
create index if not exists idx_strokes_room_code_created on strokes(room_code, created_at);

-- 3. Create room_peers table to track active peering nodes
create table if not exists room_peers (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references rooms(room_code) on delete cascade,
  peer_id text not null,
  nickname text,
  last_seen timestamptz default now(),
  created_at timestamptz default now(),
  unique(room_code, peer_id)
);

-- Index for counting active peers and cleanup
create index if not exists idx_room_peers_room_code_seen on room_peers(room_code, last_seen);

-- 4. Enable Row Level Security (RLS)
alter table rooms enable row level security;
alter table strokes enable row level security;
alter table room_peers enable row level security;

-- 5. Row Level Security Policies
-- Note: Since API keys are secure on the server side (Express API),
-- and our APIs access Supabase, we can either use Service Role Key (bypassing RLS)
-- or configure standard Anon Public read/write rules. 
-- Here are both patterns for development and production:

-- Drop existing policies if they already exist, to ensure idempotent setup.
drop policy if exists "Allow public read rooms" on rooms;
drop policy if exists "Allow public insert rooms" on rooms;
drop policy if exists "Allow public update rooms" on rooms;

drop policy if exists "Allow public read strokes" on strokes;
drop policy if exists "Allow public insert strokes" on strokes;
drop policy if exists "Allow public update strokes" on strokes;

drop policy if exists "Allow public read peers" on room_peers;
drop policy if exists "Allow public insert peers" on room_peers;
drop policy if exists "Allow public update peers" on room_peers;
drop policy if exists "Allow public delete peers" on room_peers;

-- [DEVELOPMENT / PUBLIC ANNON CONTROLS]
-- These policies allow read & write access to anyone using the anon key.
-- It enables easy development and debugging.

create policy "Allow public read rooms" on rooms for select using (true);
create policy "Allow public insert rooms" on rooms for insert with check (true);
create policy "Allow public update rooms" on rooms for update using (true);

create policy "Allow public read strokes" on strokes for select using (true);
create policy "Allow public insert strokes" on strokes for insert with check (true);
create policy "Allow public update strokes" on strokes for update using (true);

create policy "Allow public read peers" on room_peers for select using (true);
create policy "Allow public insert peers" on room_peers for insert with check (true);
create policy "Allow public update peers" on room_peers for update using (true);
create policy "Allow public delete peers" on room_peers for delete using (true);
