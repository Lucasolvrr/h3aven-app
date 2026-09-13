-- Link Saver MVP — schema para Supabase
-- Rode isso inteiro no SQL Editor do seu projeto Supabase (Database > SQL Editor > New query)

create extension if not exists "pgcrypto";

-- Links salvos
create table if not exists links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  url text not null,
  title text,
  description text,
  favicon_url text,
  source text, -- youtube | twitter | reddit | site
  created_at timestamptz not null default now()
);

-- Tags
create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- Relação N:N entre links e tags
create table if not exists link_tags (
  link_id uuid not null references links(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  primary key (link_id, tag_id)
);

-- Segurança: cada usuário só enxerga e edita os próprios dados
alter table links enable row level security;
alter table tags enable row level security;
alter table link_tags enable row level security;

create policy "links: only owner" on links
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "tags: only owner" on tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "link_tags: only owner" on link_tags
  for all using (
    exists (select 1 from links where links.id = link_tags.link_id and links.user_id = auth.uid())
  ) with check (
    exists (select 1 from links where links.id = link_tags.link_id and links.user_id = auth.uid())
  );

-- Índices
create index if not exists links_user_id_idx on links(user_id);
create index if not exists links_created_at_idx on links(created_at desc);
create index if not exists tags_user_id_idx on tags(user_id);

-- Migração: biblioteca multi-tipo (filmes/séries, música, vídeos, tweets, links)
alter table links
  add column if not exists content_type text not null default 'link'
    check (content_type in ('link','youtube','tweet','movie','tv','music','social')),
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists fetch_status text not null default 'ready'
    check (fetch_status in ('pending','ready','failed','manual')),
  add column if not exists external_id text;

create index if not exists links_content_type_idx on links(content_type);
