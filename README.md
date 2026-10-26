# Household Budget — app Home Assistant

Budget de foyer partagé pour deux personnes, empaqueté comme **app Home Assistant** (anciennement « add-on ») avec Ingress.
Mobile-first, en français, léger (conçu pour un Home Assistant Green).

- **Budget mensuel** par groupe › catégorie › sous-ligne, avec report (rollover), provisions et virements d'enveloppes.
- **Dépenses « à la Tricount »** : qui a payé, répartition selon les revenus (ratio figé par mois), 50/50, 100 % une personne ou personnalisée.
- **Solde** entre vous deux, remboursements et historique ; dépenses fixes créées automatiquement et « à confirmer ».
- **Épargne** : comptes, versements, soldes de fin de mois, objectifs, taux d'épargne, graphiques.
- **Récap mensuel par IA** (API Anthropic, données agrégées uniquement).
- Sauvegarde/restauration JSON, export/import CSV, capteurs Home Assistant, endpoint pour Raccourcis iOS.

Le code et les commits sont en anglais, l'interface en français (EUR, fuseau Europe/Paris).

## Données personnelles : règle importante

Ce dépôt est **public** pour que Home Assistant puisse le télécharger. **Ne commitez jamais de montants ni de revenus réels.**

- Le dépôt ne contient que `budget/seed.example.json` (montants fictifs).
- Votre vrai budget vit dans un fichier local ignoré par Git (`seed.local.json`, voir `.gitignore`) que vous **importez depuis l'app**
  (assistant du premier lancement).
- La clé API Anthropic se saisit uniquement dans la configuration de l'app Home Assistant, jamais dans le dépôt.
- Les données elles-mêmes sont dans la base SQLite de l'app (`/data/budget.db`), incluse dans les sauvegardes Home Assistant.

## Installer sur Home Assistant (depuis le téléphone)

Prérequis : Home Assistant OS ou Supervised (les apps ne sont pas disponibles sur Core/Container), et ce dépôt publié sur GitHub.

1. **Avant de publier**, remplacez `CHANGE-ME` par votre nom d'utilisateur GitHub dans [`repository.yaml`](repository.yaml) et dans
   [`budget/config.yaml`](budget/config.yaml) (champ `url`), puis poussez sur GitHub.
2. Dans l'app Home Assistant : **Paramètres → Apps → Boutique (Store)**.
3. Menu **⋮** en haut à droite → **Dépôts (Repositories)** → collez l'URL du dépôt, par exemple
   `https://github.com/<votre-compte>/HA-Budget-App` → **Ajouter**.
4. Fermez la fenêtre, tirez pour rafraîchir la boutique, ouvrez **Household Budget** (section du dépôt) → **Installer**.
   La première installation **construit l'image sur le Green** (compilation du front et du serveur) : comptez plusieurs minutes.
5. Onglet **Configuration** : saisissez `anthropic_api_key` (récap IA, optionnel) et éventuellement `shortcut_token`. **Enregistrer.**
6. **Démarrer**, activez **Afficher dans la barre latérale**, puis ouvrez **Budget**. La seconde personne du foyer, même non administratrice, y a accès
   (`panel_admin: false`).
7. Au premier lancement, importez `seed.local.json` (ou partez de zéro) depuis l'assistant.

À distance, ouvrez Home Assistant via Tailscale comme d'habitude : l'app est accessible par la barre latérale.

## Mettre à jour

1. Modifiez le code, puis **incrémentez `version`** dans [`budget/config.yaml`](budget/config.yaml) et ajoutez une entrée dans
   [`budget/CHANGELOG.md`](budget/CHANGELOG.md). Home Assistant ne propose la mise à jour que si ce numéro change.
2. Commit et push sur GitHub.
3. Dans Home Assistant : **Paramètres → Apps → Boutique → ⋮ → Rechercher les mises à jour** (ou « Recharger »), ouvrez l'app →
   **Mettre à jour** (l'image est reconstruite sur place). Vos données dans `/data` sont conservées ; les migrations de base
   s'appliquent au démarrage.

> Optionnel : pour éviter la compilation sur le Green, construisez des images avec GitHub Actions, publiez-les sur `ghcr.io` et ajoutez
> `image: ghcr.io/<compte>/household-budget` dans `config.yaml` (Home Assistant téléchargera alors `image:<version>` au lieu de construire).
> Ce n'est pas nécessaire pour démarrer.

## Développer en local

Prérequis : Node 22+ (testé avec Node 24).

```bash
cd budget
npm ci --ignore-scripts   # better-sqlite3 embarque ses binaires : aucun compilateur nécessaire
```

| Commande | Effet |
|---|---|
| `npm run dev` | API sur `:3000` + Vite sur `http://localhost:5173` (proxy `/api`) |
| `npm run dev:ingress` | **Teste les chemins relatifs** : sert l'app derrière un faux Ingress sur `http://localhost:8123/api/hassio_ingress/dev-token-7Zq1/` (le préfixe est retiré avant de joindre l'API, comme le Supervisor) |
| `npm test` | tests Vitest (logique pure + API) |
| `npm run typecheck` | TypeScript strict sur `shared`, `server`, `web` |
| `npm run build` | build du front (`web/dist`) et bundle du serveur (`server/dist/server.mjs`) |
| `npm start` | lance le serveur construit (données dans `budget/.data`, ignoré par Git) |

`dev:ingress` reconstruit le front en continu (`vite build --watch`) : rechargez la page après une modification. Variables utiles :
`FAKE_HA_USER` (nom de l'utilisateur HA simulé, ex. `Sam`), `FAKE_HA_PORT`, `FAKE_INGRESS_TOKEN`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`,
`SHORTCUT_TOKEN`. Pour tester le récap sans dépenser de crédits, pointez `ANTHROPIC_BASE_URL` vers un faux serveur local.

### Tester l'image Docker

Construction locale (nécessite Docker avec buildx ; non vérifiée sur cette machine de développement, qui n'a pas Docker) :

```bash
docker buildx build --platform linux/arm64 -t household-budget:test budget
docker run --rm -p 3000:3000 -e INGRESS_ONLY=false -v budget-data:/data household-budget:test
```

`INGRESS_ONLY=false` désactive le filtre sur l'IP du Supervisor (`172.30.32.2`) pour essayer l'image hors Home Assistant.

## Architecture

```
repository.yaml            dépôt d'apps Home Assistant
budget/
  config.yaml              manifeste de l'app (ingress, options, version)
  Dockerfile               build multi-étapes → image sur la base Home Assistant
  shared/                  logique pure + schémas Zod, partagés front/back, testés
  server/                  Fastify + SQLite (better-sqlite3), API JSON relative /api
  web/                     React + Vite (base './', routage par hash)
  scripts/                 bundle du serveur, faux Ingress de développement
```

- **Argent en centimes entiers**, jamais de flottants. Un split somme toujours exactement au montant (le centime restant va au payeur).
- **Ingress** : en production, seules les requêtes venant du Supervisor (`172.30.32.2`) sont acceptées ; l'utilisateur HA est lu dans
  `X-Remote-User-*` (sinon sélecteur « Qui es-tu ? »). Les URLs du front sont relatives (`<base href>` injecté depuis `X-Ingress-Path`).
- **Modèle de données** : `people`, `settings`, `groups › categories › subcategories`, `months` (+ `month_incomes`, `month_weights` figés,
  `budget_lines`), `envelope_transfers`, `expenses` (+ `expense_shares`, `tags`), `fixed_generated`, `settlements`,
  `savings_accounts` / `savings_entries`, `recaps`. Migrations dans `server/src/db/migrations.ts` (ne jamais modifier une migration publiée).

### Décisions de conception à connaître

- **Ratio figé** : le ratio « selon les revenus » est calculé à la création du mois ; sans revenu saisi, on reprend celui du mois précédent.
- **Report** : `rollover` ne reporte que le non-dépensé ; les provisions reportent leur solde, même négatif.
- **Dépenses « à confirmer »** : comptées dans le budget, **exclues du solde** (le payeur est une hypothèse).
- **Mois créés implicitement** (dépense antidatée) : pas de génération de dépenses fixes ; seuls le mois courant et les mois créés explicitement en ont.
- **Récap IA** : seules des données agrégées partent chez Anthropic ; modèle par défaut `claude-opus-5-5`.
