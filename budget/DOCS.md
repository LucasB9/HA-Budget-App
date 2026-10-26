# Household Budget

Budget de foyer partagé pour deux personnes : budget mensuel, dépenses « à la Tricount », épargne et récap mensuel par IA.
L'app s'ouvre depuis la barre latérale de Home Assistant (entrée **Budget**) et fonctionne aussi à distance via Tailscale.

## Premier lancement

1. Ouvrez **Budget** dans la barre latérale.
2. L'assistant propose d'**importer un fichier JSON** (votre budget, voir ci-dessous) ou de **partir de zéro** (deux prénoms et deux revenus).
3. Si Home Assistant ne dit pas qui ouvre l'app, une question « Qui es-tu ? » s'affiche une fois par appareil.

### Format du fichier de budget

Un exemple avec des montants fictifs est fourni (bouton « Charger l'exemple »). Vos vrais montants ne doivent **jamais** être
commités dans le dépôt Git : gardez-les dans un fichier local (par exemple `seed.local.json`, ignoré par Git) et importez-le depuis l'app.

```json
{
  "version": 1,
  "people": [{ "name": "Alex", "monthlyIncome": 3000 }, { "name": "Sam", "monthlyIncome": 1000 }],
  "defaultSplitMode": "income",
  "groups": [
    {
      "name": "Logement",
      "categories": [
        { "name": "Loyer", "amount": 1000, "type": "fixed", "day": 1, "payer": "Alex" },
        { "name": "Chauffage", "amount": 100, "type": "variable" }
      ]
    }
  ]
}
```

- `type` : `fixed` (dépense récurrente créée automatiquement), `variable` (enveloppe suivie par vos dépenses) ou `provision` (somme mise de côté chaque mois pour un coût annuel).
- `rollover: true` reporte le non-dépensé d'une catégorie variable au mois suivant. Les provisions s'accumulent toujours.
- `sublines` découpe une catégorie (leur somme doit égaler `amount`). `payer` et `split` (`income`, `equal`, `personal`) règlent les dépenses fixes.

## Comment ça marche

- **Budget** : chaque catégorie affiche budget, dépensé et reste, avec une alerte douce au-dessus de 80 % et à 100 %.
  Les dépenses fixes et les provisions n'alertent que lorsqu'elles sont dépassées.
- **Dépenses** : ajout en quelques secondes (montant, catégorie, payeur). Répartition par défaut selon les revenus ;
  50/50, 100 % pour une personne ou pourcentages personnalisés possibles à chaque dépense.
- **Ratio selon les revenus** : calculé à partir des revenus du mois et **figé** à la création du mois. Modifier les revenus
  ne réécrit jamais les soldes passés ; pour le mois en cours, l'action « Recalculer ce mois » (avec confirmation) met tout à jour.
- **Dépenses fixes** : créées à leur jour du mois, « à confirmer ». Confirmez-les avec le montant réel. Tant qu'elles sont
  « à confirmer », elles comptent dans le budget mais **pas dans le solde** entre vous deux.
- **Solde** : qui doit combien à qui (ce mois-ci et au total), remboursements et historique.
- **Virements d'enveloppes** : déplacez du budget d'une catégorie à une autre pour un mois ; l'historique est conservé.
- **Imprévus** : catégorie intégrée pour ce qui ne rentre nulle part ; un badge rappelle de reclasser ces dépenses.
- **Épargne** : comptes (PEA, livret, assurance-vie…), versement du mois, solde de fin de mois, objectifs, taux d'épargne.

## Options

| Option | Rôle |
|---|---|
| `anthropic_api_key` | Clé API Anthropic pour le récap IA. Laisser vide pour le désactiver. |
| `anthropic_model` | Modèle du récap (`claude-opus-5-5` par défaut ; `claude-sonnet-5-5` est moins cher). |
| `shortcut_token` | Active l'ajout de dépenses depuis l'app Raccourcis d'iOS. Laisser vide pour le désactiver. |

## Récap IA

« Générer le récap » (écran **Plus › Récap IA**) envoie à l'API Anthropic uniquement des données **agrégées** : budget et dépensé par
catégorie, comparaison avec les mois précédents, dépenses notables avec leurs notes et tags, mouvements d'épargne et équilibre entre
vous deux. Aucun numéro de compte ni coordonnée bancaire. Le bouton « Voir les données envoyées » affiche exactement ce qui part.
Le récap est enregistré ; l'historique reste consultable. Coût : de l'ordre de quelques centimes par récap.

Dans **Réglages**, vous pouvez activer la génération automatique du récap du mois écoulé, dans les premiers jours du mois.

## Capteurs Home Assistant

L'app publie ces capteurs pour vos tableaux de bord et notifications (mis à jour après chaque modification et chaque heure) :

`sensor.budget_remaining`, `sensor.budget_spent`, `sensor.budget_balance_owed` (attributs `debtor`, `creditor`, `summary`),
`sensor.budget_savings_rate`, `sensor.budget_pending_expenses`.

Ces états ne survivent pas à un redémarrage de Home Assistant : ils réapparaissent à la prochaine mise à jour de l'app.

## Raccourci iOS (ajout rapide)

1. Définissez `shortcut_token` (une longue valeur aléatoire) dans la configuration de l'app.
2. Dans **Réseau**, associez un port de l'hôte au port `3000/tcp` (par exemple `8765`).
3. Dans l'app Raccourcis, action **Obtenir le contenu de l'URL** :
   - URL : `http://<nom-tailscale-de-votre-HA>:8765/api/shortcut/expense`
   - Méthode : `POST`, en-tête `Authorization: Bearer <votre jeton>`, corps JSON :

   ```json
   { "amount": "42,50", "category": "Courses", "payer": "Sam", "note": "marché" }
   ```

`amount` accepte `42,50`. `category` et `payer` sont reconnus par leur nom (casse et accents ignorés) ; une catégorie inconnue
classe la dépense en **Imprévus**. Champs facultatifs : `date` (`2026-10-31` ou `31/10/2026`), `tags`, `split` (`income`, `equal`, `personal`).
`GET /api/shortcut/options` renvoie les catégories et prénoms pour construire un menu.

Ce port n'expose que cet endpoint : tout le reste de l'app refuse les connexions qui ne passent pas par Home Assistant.
N'ouvrez ce port que sur votre réseau privé (Tailscale), pas sur Internet.

## Sauvegardes et données

- La base SQLite est dans `/data` de l'app : elle est incluse dans les **sauvegardes Home Assistant**.
- **Réglages › Sauvegarde complète** télécharge un fichier JSON et permet de le restaurer (confirmation requise ; une copie de la base
  actuelle est conservée avant le remplacement).
- **Réglages › Export et import CSV** : dépenses et épargne, séparateur `;`, montants avec virgule. L'import vérifie tout le fichier
  et n'écrit rien s'il contient une erreur (les lignes fautives sont listées).
