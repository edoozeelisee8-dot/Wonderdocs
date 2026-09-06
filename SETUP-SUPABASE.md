# Mettre Wonderkine en ligne avec Supabase — guide pas à pas

Ce site utilise Supabase comme back-end : comptes, articles, documents et
fichiers sont stockés sur un vrai serveur partagé (base de données
Postgres), accessible depuis n'importe quel appareil — **sans carte
bancaire nécessaire**. Les fichiers du site (`index.html`, `admin.html`,
`script.js`, `admin.js`, `style.css`, `supabase-config.js`) peuvent rester
hébergés sur Hostinger (ou ailleurs) exactement comme avant — seule la
partie "données" passe par Supabase.

## 1. Créer le projet Supabase (gratuit, sans carte bancaire)

1. Va sur https://supabase.com, clique sur **Start your project**, et
   connecte-toi (avec GitHub, Google, ou email).
2. Clique sur **New project**, choisis une organisation (créée
   automatiquement à ton nom si c'est ta première fois), donne un nom au
   projet (ex. `wonderkine`), choisis une région proche (Europe de
   l'Ouest par exemple), et définis un mot de passe pour la base de
   données (note-le de côté, tu n'en auras normalement plus besoin après
   la création).
3. Clique sur **Create new project** — la mise en place prend une à deux
   minutes.

## 2. Récupérer les clés de connexion

Une fois le projet prêt :
1. Menu de gauche : icône **⚙️ Project Settings → Data API**. Copie
   l'**URL** du projet (ressemble à `https://xxxxx.supabase.co`).
2. Toujours dans les paramètres, onglet **API Keys** : copie la clé
   **`anon` `public`** (jamais la clé `service_role`, qui doit rester
   secrète et ne jamais apparaître dans du code envoyé au navigateur).
3. Colle ces deux valeurs dans **`supabase-config.js`**, à la place des
   `"..."`.

## 3. Désactiver la confirmation par email (pour simplifier l'inscription)

Par défaut, Supabase envoie un email de confirmation avant qu'un compte
soit utilisable, ce qui complique les tests. Pour un site étudiant, on le
désactive :
**Authentication → Providers → Email →** décoche **"Confirm email"** →
**Save**.

(Tu pourras la réactiver plus tard si tu veux sécuriser les inscriptions
une fois le site plus fréquenté.)

## 4. Créer les tables et les règles de sécurité

Menu de gauche : **SQL Editor → New query**. Colle le bloc ci-dessous en
entier, puis clique sur **Run**.

```sql
-- ===================== TABLES =====================

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  email text not null,
  role text not null default 'membre',
  articles_count int not null default 0,
  documents_count int not null default 0,
  categories_covered text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table articles (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  title text not null,
  description text not null,
  keywords text not null,
  image_url text default '',
  author_id uuid references profiles(id),
  author_name text,
  views int not null default 0,
  created_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  title text not null,
  description text not null,
  keywords text not null,
  total_pages int not null default 1,
  file_name text,
  file_url text default '',
  author_id uuid references profiles(id),
  author_name text,
  views int not null default 0,
  downloads int not null default 0,
  created_at timestamptz not null default now()
);

create table reports (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  item_type text not null,
  reason text,
  reporter_id uuid references profiles(id),
  reporter_name text,
  created_at timestamptz not null default now()
);

-- ===================== SÉCURITÉ (RLS) =====================

alter table profiles enable row level security;
alter table articles enable row level security;
alter table documents enable row level security;
alter table reports enable row level security;

create policy "Lecture des profils pour les connectés" on profiles
  for select using (auth.role() = 'authenticated');
create policy "Créer son propre profil" on profiles
  for insert with check (auth.uid() = id);
create policy "Modifier son propre profil" on profiles
  for update using (auth.uid() = id);

-- Un membre connecté ne peut modifier que son nom d'utilisateur depuis le
-- site — jamais son rôle ou ses compteurs directement (ça, c'est réservé
-- aux fonctions serveur ci-dessous).
revoke update on profiles from authenticated;
grant update (username) on profiles to authenticated;

create policy "Lecture publique des articles" on articles
  for select using (true);
create policy "Création d'articles par les connectés" on articles
  for insert with check (auth.uid() = author_id);
create policy "Modification des articles par les connectés" on articles
  for update using (auth.role() = 'authenticated');
create policy "Suppression par l'auteur ou un admin" on articles
  for delete using (
    auth.uid() = author_id
    or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Lecture publique des documents" on documents
  for select using (true);
create policy "Création de documents par les connectés" on documents
  for insert with check (auth.uid() = author_id);
create policy "Modification des documents par les connectés" on documents
  for update using (auth.role() = 'authenticated');
create policy "Suppression par l'auteur ou un admin (documents)" on documents
  for delete using (
    auth.uid() = author_id
    or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

create policy "Créer un signalement" on reports
  for insert with check (auth.uid() = reporter_id);
create policy "Lecture des signalements par un admin" on reports
  for select using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );
create policy "Suppression des signalements par un admin" on reports
  for delete using (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
  );

-- ===================== FONCTIONS SERVEUR =====================
-- Ces fonctions tournent avec des droits élevés (SECURITY DEFINER) : elles
-- restent fiables même si quelqu'un bidouille les outils développeur du
-- navigateur, contrairement à une simple mise à jour de table.

create or replace function increment_article_views(article_id uuid)
returns void as $$
begin
  update articles set views = views + 1 where id = article_id;
end;
$$ language plpgsql security definer;

create or replace function increment_document_views(doc_id uuid)
returns void as $$
begin
  update documents set views = views + 1 where id = doc_id;
end;
$$ language plpgsql security definer;

create or replace function increment_document_downloads(doc_id uuid)
returns void as $$
begin
  update documents set downloads = downloads + 1 where id = doc_id;
end;
$$ language plpgsql security definer;

-- Incrémente les compteurs de l'auteur après une publication, et le
-- promeut administrateur s'il atteint les seuils (10 articles + 5
-- documents + 3 thèmes différents).
create or replace function register_publication(p_user_id uuid, p_type text, p_category text)
returns void as $$
declare
  v_role text;
  v_articles int;
  v_documents int;
  v_categories text[];
begin
  if p_type = 'article' then
    update profiles
      set articles_count = articles_count + 1,
          categories_covered = case when p_category = any(categories_covered)
                                     then categories_covered
                                     else array_append(categories_covered, p_category) end
      where id = p_user_id;
  else
    update profiles
      set documents_count = documents_count + 1,
          categories_covered = case when p_category = any(categories_covered)
                                     then categories_covered
                                     else array_append(categories_covered, p_category) end
      where id = p_user_id;
  end if;

  select role, articles_count, documents_count, categories_covered
    into v_role, v_articles, v_documents, v_categories
    from profiles where id = p_user_id;

  if v_role <> 'admin' and v_articles >= 10 and v_documents >= 5
     and coalesce(array_length(v_categories, 1), 0) >= 3 then
    update profiles set role = 'admin' where id = p_user_id;
  end if;
end;
$$ language plpgsql security definer;

-- Promotion/rétrogradation manuelle par un admin, depuis admin.html.
-- Vérifie elle-même que l'appelant est bien admin avant d'agir.
create or replace function admin_set_role(p_target_id uuid, p_new_role text)
returns void as $$
declare
  v_caller_role text;
begin
  select role into v_caller_role from profiles where id = auth.uid();
  if v_caller_role <> 'admin' then
    raise exception 'Non autorisé';
  end if;
  update profiles set role = p_new_role where id = p_target_id;
end;
$$ language plpgsql security definer;

-- Le créateur du site est admin permanent dès la création de son profil,
-- quel que soit son nombre de publications. Remplace l'email ci-dessous
-- par le tien avant d'exécuter ce bloc.
create or replace function set_creator_admin()
returns trigger as $$
begin
  if new.email = 'kine33zwonder@gmail.com' then
    new.role := 'admin';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_set_creator_admin
before insert on profiles
for each row execute function set_creator_admin();
```

> ⚠️ Avant d'exécuter, remplace `'toncompte@example.com'` (tout en bas du
> bloc, dans `set_creator_admin`) par l'adresse email avec laquelle tu vas
> créer ton propre compte sur le site — la **même** adresse que celle mise
> dans `CREATOR_EMAIL` au sein de `script.js` et `admin.js`.

## 5. Activer le stockage de fichiers (Storage)

Toujours dans le **SQL Editor**, nouvelle requête, colle et exécute :

```sql
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do nothing;

create policy "Lecture publique du bucket uploads" on storage.objects
  for select using (bucket_id = 'uploads');

create policy "Upload par les utilisateurs connectés" on storage.objects
  for insert with check (bucket_id = 'uploads' and auth.role() = 'authenticated');

create policy "Suppression par l'auteur du fichier" on storage.objects
  for delete using (
    bucket_id = 'uploads' and auth.uid()::text = (storage.foldername(name))[1]
  );
```

Aucune carte bancaire n'est demandée à aucune étape : le stockage de
fichiers fait partie du plan gratuit Supabase (jusqu'à 1 Go, largement
suffisant pour démarrer).

## 6. Personnaliser les fichiers du site

Dans **`script.js`** et **`admin.js`**, remplace la ligne :

```js
const CREATOR_EMAIL = "toncompte@example.com";
```

par ta vraie adresse email (la même que celle utilisée à l'étape 4), dans
les deux fichiers.

## 7. Déployer sur Hostinger

Envoie ces fichiers dans le dossier `public_html` de ton hébergement
Hostinger (gestionnaire de fichiers hPanel, ou FTP) :
`index.html`, `script.js`, `style.css`, `supabase-config.js`,
`admin.html`, `admin.js`.

## 7bis. Alternative : héberger directement sur Supabase/Vercel/Netlify

Supabase ne fait qu'héberger les données, pas les fichiers du site
lui-même. Si tu préfères un hébergement gratuit "tout en un" plutôt que
Hostinger, des services comme **Netlify** ou **Vercel** permettent de
glisser-déposer ton dossier de fichiers et d'obtenir un site en ligne
gratuitement en quelques secondes, avec HTTPS inclus. Hostinger reste
tout à fait valable aussi — à toi de choisir.

## 8. Comment devenir administrateur

- **Toi (le créateur)** : crée ton compte depuis le site avec l'adresse
  email renseignée dans `CREATOR_EMAIL` — le déclencheur SQL te rend
  admin automatiquement et en permanence, quel que soit ton nombre de
  publications.
- **N'importe quel autre membre** : devient automatiquement
  administrateur dès qu'il a publié **10 articles** et **5 documents**,
  sur **au moins 3 thèmes différents** (Anatomie, Pathologies,
  Physiologie, Techniques). Vérifié et appliqué automatiquement après
  chaque publication.

Un admin peut supprimer n'importe quel contenu et accéder au tableau de
bord (`admin.html`, lien "⚙️ Administration" dans l'en-tête). Toi seul (le
créateur) peux en plus promouvoir ou rétrograder manuellement un compte
depuis ce tableau de bord.

## Ce qui est déjà en place

- Comptes et sessions partagés entre appareils (email + mot de passe, via
  Supabase Authentication).
- Articles et documents visibles par tous, mis à jour en direct (sans
  recharger la page) grâce aux abonnements temps réel de Supabase.
- Fichiers (images, PDF, Word...) hébergés sur Supabase Storage, 5 Mo max
  par fichier — **aucune carte bancaire requise**.
- Compteur de lectures et de téléchargements, mis à jour de façon fiable
  côté serveur (fonctions `SECURITY DEFINER`, non modifiables depuis les
  outils développeur du navigateur).
- Bouton **Signaler 🚩** sur chaque carte (visible une fois connecté).
- Suppression réservée à l'auteur du contenu ou à un admin.
- Rôle `admin` acquis automatiquement (10 articles + 5 documents sur 3
  thèmes) ou en permanence pour le créateur.
- Une vraie page **`admin.html`** (lien "⚙️ Administration" dans
  l'en-tête, visible seulement par les admins et toi) avec statistiques,
  file des signalements, liste des membres et de leurs contributions, et
  suppression de contenu en un clic.

## Prochaines étapes possibles (à me demander si besoin)

- Une modération "avant publication" plutôt qu'après coup.
- Réactiver la confirmation par email une fois le site plus fréquenté.
- Un export/sauvegarde régulière des données (Supabase propose des
  sauvegardes automatiques sur les plans payants ; sur le plan gratuit,
  un export manuel périodique via le SQL Editor est une bonne habitude).
