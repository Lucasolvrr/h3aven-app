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

-- Migração: adiciona o tipo "instagram" (roteador de views + filtro por tipo no Home)
alter table links drop constraint if exists links_content_type_check;
alter table links add constraint links_content_type_check
  check (content_type in ('link','youtube','tweet','movie','tv','music','social','instagram'));

-- Migração: notas pessoais por item (usadas no modal de quickview)
alter table links add column if not exists notes text;

-- Migração: Coleções — agrupamento manual, ortogonal a tags (não remove o
-- item de onde ele já está, só cria mais um jeito de organizá-lo)
create table if not exists collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists collection_links (
  collection_id uuid not null references collections(id) on delete cascade,
  link_id uuid not null references links(id) on delete cascade,
  primary key (collection_id, link_id)
);

alter table collections enable row level security;
alter table collection_links enable row level security;

create policy "collections: only owner" on collections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "collection_links: only owner" on collection_links
  for all using (
    exists (select 1 from collections where collections.id = collection_links.collection_id and collections.user_id = auth.uid())
  ) with check (
    exists (select 1 from collections where collections.id = collection_links.collection_id and collections.user_id = auth.uid())
  );

create index if not exists collections_user_id_idx on collections(user_id);

-- Migração: Tags e Coleções viram o mesmo conceito — "marcar" um item
-- agora é adicioná-lo a uma coleção. Tags existentes são migradas (cada
-- tag vira uma coleção com o mesmo nome, preservando os vínculos); as
-- tabelas tags/link_tags NÃO são apagadas (não-destrutivo — ficam sem uso
-- depois desta migração, dá pra dropar depois se quiser).
alter table collection_links add column if not exists created_at timestamptz not null default now();

insert into collections (user_id, name)
select distinct t.user_id, t.name
from tags t
on conflict (user_id, name) do nothing;

insert into collection_links (collection_id, link_id)
select c.id, lt.link_id
from link_tags lt
join tags t on t.id = lt.tag_id
join collections c on c.user_id = t.user_id and c.name = t.name
on conflict (collection_id, link_id) do nothing;

-- ============================================================================
-- Migration: Bookmark Manager (categories > subcategories > bookmarks)
-- 2026-11-15 — additive and idempotent: safe to run on a database that already
-- has data, and safe to run twice. Nothing is dropped.
--
-- Model
--   categories            user-managed, ordered by `position`
--   subcategories         belong to a category, ordered by `position`
--   links                 gains category_id / subcategory_id (both nullable)
--                         a bookmark with category_id IS NULL lives in the Inbox
--   tags / link_tags      back in use (many tags per bookmark)
--   collections           left untouched; their contents are copied into tags
-- ============================================================================

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  name text not null,
  icon text not null default 'folder',
  description text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists subcategories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  category_id uuid not null references categories(id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (category_id, name)
);

alter table links
  add column if not exists category_id uuid references categories(id) on delete set null,
  add column if not exists subcategory_id uuid references subcategories(id) on delete set null,
  add column if not exists normalized_url text,
  add column if not exists domain text,
  add column if not exists thumbnail_url text,
  add column if not exists selected_text text,
  add column if not exists is_favorite boolean not null default false,
  -- No default here on purpose: existing rows are backfilled from created_at
  -- below, and only then does the column get its default and NOT NULL.
  add column if not exists updated_at timestamptz,
  add column if not exists last_accessed_at timestamptz;

alter table categories enable row level security;
alter table subcategories enable row level security;

drop policy if exists "categories: only owner" on categories;
create policy "categories: only owner" on categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "subcategories: only owner" on subcategories;
create policy "subcategories: only owner" on subcategories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists categories_user_position_idx on categories(user_id, position);
create index if not exists subcategories_category_position_idx on subcategories(category_id, position);
create index if not exists links_category_idx on links(category_id);
create index if not exists links_subcategory_idx on links(subcategory_id);
create index if not exists links_user_normalized_url_idx on links(user_id, normalized_url);
create index if not exists links_user_favorite_idx on links(user_id) where is_favorite;

-- Backfill columns the new UI reads, from data that already exists. The
-- updated_at trigger is removed first and recreated afterwards, so the backfill
-- doesn't make every bookmark look freshly edited.
drop trigger if exists links_set_updated_at on links;

update links set updated_at = created_at where updated_at is null;
alter table links alter column updated_at set default now();
alter table links alter column updated_at set not null;

update links
set domain = regexp_replace(substring(url from '^[a-zA-Z]+://([^/?#]+)'), '^www\.', '')
where domain is null;

update links
set thumbnail_url = metadata->>'image'
where thumbnail_url is null and metadata ? 'image' and metadata->>'image' <> '';

update links
set description = metadata->>'description'
where description is null and metadata ? 'description' and metadata->>'description' <> '';

-- Keep updated_at honest without relying on every client to send it.
create or replace function set_links_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger links_set_updated_at
  before update on links
  for each row execute function set_links_updated_at();

-- Collections were the previous way of grouping. The new model uses tags for
-- free-form grouping, so every collection becomes a tag with the same name and
-- keeps its bookmarks. Collections themselves are not modified.
insert into tags (user_id, name)
select distinct c.user_id, c.name
from collections c
on conflict (user_id, name) do nothing;

insert into link_tags (link_id, tag_id)
select cl.link_id, t.id
from collection_links cl
join collections c on c.id = cl.collection_id
join tags t on t.user_id = c.user_id and t.name = c.name
on conflict (link_id, tag_id) do nothing;
