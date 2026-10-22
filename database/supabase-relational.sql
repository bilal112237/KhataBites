-- KhataBites Free Cloud Database Schema (Run in Supabase SQL Editor)
-- 1. Individual Student Accounts (Profiles)
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  hostel_room text default 'Hostel Room',
  wallet_app text default 'SadaPay',
  wallet_number text not null,
  avatar_color text default '#C2410C',
  created_at timestamptz default now()
);

-- 2. Dining Groups (Multiple Groups Can Eat in a Single Day)
create table if not exists public.dining_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  schedule_tag text default 'Daily Squad Meal',
  invite_code text unique not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

-- 3. Group Memberships (Many-to-Many: 1 Student Can Join Multiple Groups)
create table if not exists public.group_members (
  group_id uuid references public.dining_groups(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  joined_at timestamptz default now(),
  primary key (group_id, profile_id)
);

-- 4. Meal Bills (Shared Pool + Solo Extras)
create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.dining_groups(id) on delete cascade,
  title text not null,
  meal_tag text not null,
  payer_id uuid references public.profiles(id),
  total_bill numeric not null check (total_bill > 0),
  eater_ids uuid[] not null,
  solo_items jsonb default '[]'::jsonb,
  created_at timestamptz default now()
);

-- 5. Settlements (Online Payment Screenshots + "Just Told Them" Verbal Logs)
create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.dining_groups(id) on delete cascade,
  from_profile_id uuid references public.profiles(id),
  to_profile_id uuid references public.profiles(id),
  amount numeric not null check (amount > 0),
  method text not null,
  mode text default 'screenshot',
  note text,
  screenshot_url text,
  verified boolean default true,
  created_at timestamptz default now()
);
