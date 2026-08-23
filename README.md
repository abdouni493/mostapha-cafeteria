# Altech Cafétéria

Gestion complète de **plusieurs cafétérias** depuis une seule application : stock,
achats, point de vente, ventes, clients, fournisseurs, employés, caisse et
comptabilité — chaque comptoir avec ses propres chiffres.

---

## Le principe

Une **cafétéria** est une activité complète et **indépendante**. Elle a son
catalogue, ses achats, ses ventes, ses clients, ses fournisseurs, ses employés,
son tiroir-caisse et ses rapports. Rien n'est partagé entre deux cafétérias,
sauf deux choses :

- **l'enseigne** — le nom, le logo et les mentions légales des tickets ;
- **la caisse générale** — le coffre au-dessus des comptoirs, où remontent les
  recettes et d'où sortent les charges communes.

Ajouter une cafétéria se fait dans **Réglages → Cafétérias**. Elle apparaît
immédiatement dans le menu avec ses treize écrans, dans les filtres, dans les
rapports et dans les affectations d'employés — sans aucun autre réglage.

---

## Qui voit quoi

| | Administrateur | Employé |
|---|---|---|
| Cafétérias | toutes | **la sienne uniquement** |
| Écrans | tous | ceux qu'on lui a cochés |
| Tableau de bord consolidé | oui | non |
| Caisse générale, rapports généraux, réglages | oui | non |

Le cloisonnement d'un employé n'est pas cosmétique : les écrans des autres
cafétérias ne sont pas grisés, ils n'existent pas dans son rendu. Côté base,
les règles RLS refusent la lecture des produits et des sessions d'une autre
cafétéria, quoi que fasse l'application.

---

## Mise en route

### 1. La base de données

Ouvrez **Supabase → SQL Editor**, collez le contenu de
[`supabase/schema.sql`](supabase/schema.sql) et exécutez-le en une fois.

Le script installe les tables, les buckets d'images, les fonctions
d'authentification et les règles d'accès. Il est **idempotent** : le rejouer ne
détruit aucune donnée.

### 2. La connexion

Créez un fichier `.env` à la racine (voir `.env.example`) :

```
VITE_SUPABASE_URL=https://votre-projet.supabase.co
VITE_SUPABASE_ANON_KEY=votre-cle-anon
```

La clé « anon » est publique par nature : ce sont les règles RLS de la base qui
protègent les données, jamais le secret de cette clé.

### 3. Le premier compte

```bash
npm install
npm run dev          # http://localhost:3000
```

La page de connexion affiche **« Créer un compte administrateur »**. Ce bouton
n'apparaît que tant qu'aucun administrateur n'existe et **disparaît
définitivement** dès que le compte est créé — sinon, quiconque connaîtrait
l'adresse de l'application pourrait s'octroyer un accès complet. La base refuse
elle aussi une seconde création, même si l'écran se trompait.

Le compte est utilisable **immédiatement** : pas d'e-mail de confirmation à
attendre.

### 4. Vos comptoirs

1. **Réglages → Enseigne** : nom, logo, mentions légales des tickets.
2. **Réglages → Cafétérias** : ajoutez vos comptoirs.
3. Dans chaque cafétéria, **Employés** : créez les accès. Chaque employé se
   connecte avec son identifiant (pas besoin d'adresse e-mail) et ne voit que
   sa cafétéria.

---

## Les écrans d'une cafétéria

| Écran | À quoi il sert |
|---|---|
| **Gestion de stock** | Catalogue, quantités, alertes de rupture et de péremption |
| **Inventaire** | Comptage physique, écarts, correction réversible du stock |
| **Achats** | Réceptions fournisseurs, factures, coût moyen pondéré |
| **Production** | Fiches techniques et fabrications |
| **Comptoir** | Produits finis prêts à la vente |
| **Point de vente** | Encaissement, code-barres, sessions de caisse |
| **Ventes** | Historique des tickets, retours et échanges |
| **Clients** | Fiches, crédits, avances, relevés de compte |
| **Fournisseurs** | Fiches et dettes |
| **Employés** | Personnel, paie, comptes de connexion, permissions |
| **Dépenses** | Charges, payées du tiroir ou de la caisse générale |
| **Caisse** | Tiroir du comptoir, mouvements, transferts avec le coffre |
| **Rapports** | Bilan, bénéfices par produit, analyses |

Écrans transversaux (administrateur) : **Tableau de bord**, **Caisse générale**,
**Rapports généraux**, **Réglages**.

---

## Raccourcis

| Touches | Action |
|---|---|
| `Ctrl` + `K` | Recherche rapide : écran, produit, client, fournisseur |
| `Alt` + `V` | Point de vente |
| `Alt` + `S` | Gestion de stock |
| `Alt` + `A` | Achats |
| `Alt` + `C` | Caisse |
| `Alt` + `R` | Rapports |
| `Alt` + `B` | Masquer / afficher le menu |
| `Alt` + `1…9` | Même écran, autre cafétéria |

Les raccourcis `Alt` sont ignorés pendant une saisie : taper « a » dans un champ
de recherche ne quitte jamais la page en cours.

---

## Comment les données sont rangées

L'exploitation d'une cafétéria (stock, ventes, achats, clients, caisse…) vit
dans **une ligne JSON partagée** (`biz_store`). Ce choix rend une écriture
**atomique** sur des collections liées entre elles — une vente touche le stock,
la caisse, le client et la session dans la même opération — et permet la fusion
ligne par ligne quand deux postes travaillent en même temps.

Deux ensembles en sortent, parce qu'ils sont écrits trop souvent ou trop gros
pour voyager avec le reste :

- **`biz_products`** — une ligne par produit. Créer un produit envoie 800 octets
  au lieu du document entier.
- **`biz_sessions`** — une ligne par session de caisse, pour que deux caissiers
  ne s'écrasent jamais l'un l'autre.

Toute écriture annonce la **révision** sur laquelle elle a été construite. Le
serveur la refuse si la ligne a bougé entre-temps et renvoie la version
courante ; l'application fusionne puis rejoue. **Rien de ce qui a été créé ne
peut être perdu** par une course entre deux postes.

---

## Sauvegarde

**Réglages → Base de données** produit un fichier `.json` (ou `.sql`) contenant
tout : l'enseigne, chaque cafétéria, son stock, ses ventes, ses employés et la
caisse générale.

La restauration **n'efface jamais rien** : chaque ligne du fichier est réécrite
sur son identifiant, et ce qui a été créé depuis reste en place.

---

## Scripts

```bash
npm run dev     # développement (http://localhost:3000)
npm run build   # build de production
npm run start   # sert le build
npm run lint    # vérification TypeScript
```

## Pile technique

React 19 · TypeScript · Vite · Tailwind CSS v4 · Supabase (PostgreSQL, Auth,
Storage, Realtime) · Recharts · Framer Motion
