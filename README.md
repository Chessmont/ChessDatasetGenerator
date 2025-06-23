# 🏆 Chess Dataset Generator

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chess.js](https://img.shields.io/badge/Chess.js-1.4.0-blue.svg)](https://github.com/jhlywa/chess.js)

**🌍 Language / Langue :** [English](README.en.md) | **Français**

Un générateur automatisé de datasets d'échecs haute qualité, capable de télécharger, filtrer, nettoyer et compiler des millions de parties depuis plusieurs sources prestigieuses, et également génerer toute les positions fen et les aggregés.

## 📦 Dataset pré-généré disponible

🚀 **Téléchargement direct sur Kaggle** : [ChessMont Big Dataset](https://www.kaggle.com/datasets/chessmontdb/chessmont-big-dataset)

**Contenu du dataset :**
- 📊 **21,5 millions de parties** haute qualité (ELO ≥ 2500)
- ♟️ **1,8+ milliards de positions FEN** avec statistiques complètes
- 🏆 **Sources premium** : TWIC, PGN Mentor, Chess.com Top 10K, Lichess
- ✅ **Données nettoyées** : validation stricte, déduplication, filtrage avancé

*Vous pouvez utiliser ce dataset directement ou générer le vôtre avec ce générateur.*

## 🎯 Fonctionnalités

### 📥 **Sources de données multiples**
- **Chess.com** - Parties des meilleurs joueurs (via API)
- **Lichess** - Base de données mensuelle complète
- **TWIC** (The Week in Chess) - Parties de tournois professionnels
- **PGN Mentor** - Collection de parties classiques

#### 🔍 **Fonctionnement détaillé des téléchargements**

**TWIC (The Week in Chess)**
- Récupère toutes les parties enregistrées depuis la semaine 920 jusqu'à la semaine de date d'exécution du script
- Source : Archive complète des tournois professionnels mondiaux

**PGN Mentor**
- Récupère toutes les archives du site sans exception
- Collection historique de parties annotées et commentées
- Source : Base de données complète du site PGN Mentor

**Lichess**
- Télécharge tous les fichiers .zst disponibles sur https://database.lichess.org/
- Volume : Plus de 6,7 milliards de parties disponibles
- Filtrage : Applique les conditions définies dans la config (ELO, temps, etc.)
- Format : Archives mensuelles compressées ZSTD

**Chess.com**
- Récupère via l'API Chess.com tous les joueurs du leaderboard blitz
- Limite : Jusqu'au maximum défini dans la config (par défaut les 10k premiers du leaderboard)
- Télécharge toutes les parties jouées par ces joueurs
- Filtrage : Applique les conditions de la config après téléchargement

### 🔧 **Pipeline de traitement avancé**
- **Filtrage intelligent** par ELO, durée de partie, profondeur
- **Déduplication automatique** des parties identiques
- **Validation PGN stricte** avec nettoyage automatique
- **Streaming multithread** pour les gros fichiers (>10GB)
- **Protection mémoire** contre les parties corrompues

### ⚙️ **Configuration centralisée**
- Tous les paramètres dans un seul fichier `config.json`
- Mode "sources en ligne" activable/désactivable
- Génération automatique des noms de fichiers
- Critères de filtrage personnalisables

## 🚀 Installation

### Prérequis
- **Node.js 18+** (testé sous Node.js 20)
- **8GB RAM minimum** (16GB recommandé pour les gros datasets)
- **50GB espace disque libre** minimum

### Installation des dépendances
```bash
npm install
```

## ⚙️ Configuration

Modifiez le fichier `config.json` selon vos besoins :

```json
{
  "officialPGNFileName": "twic-pgnmentor.pgn",
  "finalPGNFileName": "chessmont.pgn",

  "withOnlineGame": true,
  "minOnlineElo": 2500,
  "minGameTime": 180,
  "minPlyDepth": 10,

  "generateFen": true,

  "chesscom": {
    "numberOfUsersInLeaderboard": 10000,
    "userAgent": "votre-app/1.0 (contact: votre@email.com)"
  }
}
```

### 📋 **Paramètres détaillés**

| Paramètre | Description | Valeur par défaut |
|-----------|-------------|-------------------|
| `withOnlineGame` | Inclure Chess.com et Lichess | `true` |
| `minOnlineElo` | ELO minimum des joueurs | `2500` |
| `minGameTime` | Durée minimum en secondes | `180` |
| `minPlyDepth` | Nombre minimum de coups | `10` |
| `generateFen` | Générer les fichiers FEN | `true` |
| `numberOfUsersInLeaderboard` | Top joueurs Chess.com | `10000` |

## 🏁 Utilisation

### Génération complète du dataset
```bash
node start.js
```

### Afficher l'aide
```bash
node start.js --help
```

## 🔄 Processus de génération (7 étapes)

Le générateur suit un pipeline optimisé en 7 étapes :

### 1. 🌐 **Téléchargement des sources**
- **Mode complet** (`withOnlineGame: true`) : TWIC + PGN Mentor + Chess.com + Lichess
- **Mode hors-ligne** (`withOnlineGame: false`) : TWIC + PGN Mentor uniquement

### 2. 🔧 **Compilation officielle**
- Fusionne TWIC + PGN Mentor avec filtrage strict
- Génère le fichier officiel (ex: `twic-pgnmentor.pgn`)

### 3. 🔄 **Déduplication**
- Supprime automatiquement les parties identiques
- Sauvegarde de sécurité automatique

### 4. 🔍 **Vérification et nettoyage**
- Validation PGN stricte avec `chess.js`
- **Mode complet** : vérifie Chess.com, Lichess et fichier officiel
- **Mode hors-ligne** : vérifie uniquement le fichier officiel
- Streaming multithread pour les gros fichiers

### 5. 📦 **Compilation finale**
- *(Uniquement en mode complet)*
- Fusionne toutes les sources nettoyées
- Génère le dataset final (ex: `chessmont.pgn`)

### 6. 🏷️ **Ajout des identifiants**
- Ajoute des IDs uniques à chaque partie
- Utilise `nanoid` pour des identifiants courts et sûrs

### 7. ♟️ **Génération des FENs** *(selon configuration)*
- Extrait toutes les positions FEN depuis le dataset final
- Agrège les positions par occurrence avec statistiques complètes
- Utilise un algorithme **Multi-Phase K-way Aggregation Merge Multithread**
- Génère 4 fichiers de sortie avec différents niveaux de filtrage

#### 🧠 **Algorithme d'agrégation avancé**

Le script `fen.js` analyse toutes les parties d'un fichier PGN et extrait chaque position d'échecs (notation FEN) avec les statistiques de résultat (victoire blanche, victoire noire, nulle). L'agrégation se fait via un système multi-phase sophistiqué :

**Processus d'extraction :**
1. **Parse multithread** : Analyse les parties en parallèle
2. **Extraction FEN** : Génère toutes les positions de chaque partie
3. **Tri par chunks** : Organise les positions par ordre alphabétique
4. **Merge K-way** : Fusionne et agrège les occurrences
5. **Génération des rapports** : Crée les fichiers finaux selon les seuils

**⚠️ PRÉREQUIS IMPORTANT :** Le fichier PGN doit avoir été traité par `add-ids.js` avant l'exécution de `fen.js` pour générer le fichier d'index des parties.

#### 📊 **Fichiers générés par fen.js**

| Fichier | Description | Seuil |
|---------|-------------|-------|
| `fens-all.tsv` | Toutes les positions extraites | Aucun |
| `fens-withoutone.tsv` | Positions récurrentes | ≥ 2 occurrences |
| `fens-onlyrecurrent.tsv` | Positions très récurrentes | ≥ 10 occurrences |
| `*-pgi.tsv` | Index FEN → Game ID | Toutes |

#### 📈 **Format des données de sortie**

```tsv
occurrence	white	black	draw
rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1	21512376	9683625	8431066	3397685
rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1	9933794	4453002	3932201	1548591
rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1	7239529	3258936	2821942	1158651
```

**Colonnes :**
- `occurrence` : Nombre total d'apparitions de la position
- `white` : Nombre de victoires des blancs depuis cette position
- `black` : Nombre de victoires des noirs depuis cette position
- `draw` : Nombre de nulles depuis cette position

**Exemple sur 21,5M de parties :**
- Position de départ : 21,5M occurrences (100% des parties)
- 1.e4 : 9,9M occurrences (46% des parties commencent par 1.e4)
- 1.d4 : 7,2M occurrences (34% des parties commencent par 1.d4)

## 📁 Structure du projet

```
ChessDatasetGenerator/
├── 📄 config.json              # Configuration centralisée
├── 🚀 start.js                 # Script principal
├── 📂 src/
│   ├── 📥 pgn-chesscom.js      # Téléchargeur Chess.com
│   ├── 📥 pgn-lichess.js       # Téléchargeur Lichess
│   ├── 📥 pgn-pgnmentor.js     # Téléchargeur PGN Mentor
│   ├── 📥 pgn-twic.js          # Téléchargeur TWIC
│   ├── 🔧 compil.js            # Compilateur de datasets
│   ├── 🔄 deduplicate-pgn.js   # Déduplicateur
│   ├── 🔍 game-checker.js      # Validateur/nettoyeur
│   ├── 🏷️ add-ids.js           # Générateur d'IDs
│   ├── ♟️ fen.js               # Extracteur de FENs
│   ├── 📂 bonus/               # Scripts bonus et utilitaires
│   ├── 📂 lib/                 # Workers et utilitaires
│   ├── 📂 utils/               # Outils (compression, etc.)
│   └── 📂 output/              # Fichiers générés
└── 📂 temp/                    # Fichiers temporaires
```

## 🎁 Scripts Bonus

### 📖 **Générateur d'ouvertures d'échecs**

Le dossier `src/bonus/` contient des outils spécialisés pour gérer les ouvertures d'échecs.

#### **Script `openings.js`**
- **Source** : Base de données officielle Lichess (GitHub: lichess-org/chess-openings)
- **Fonction** : Télécharge et compile toutes les ouvertures d'échecs connues
- **Format** : Génère un fichier TSV avec codes ECO, noms et notations PGN

```bash
# Télécharger toutes les ouvertures depuis Lichess
node src/bonus/openings.js
```

#### **Fonctionnalités**
- ✅ **Source officielle** : Lichess.org chess-openings repository
- ✅ **Codes ECO complets** : Classification Encyclopedia of Chess Openings
- ✅ **Ouvertures personnalisées** : Support pour `customOpenings.tsv`
- ✅ **Validation chess.js** : Vérification automatique des séquences PGN
- ✅ **Téléchargement robuste** : Retry automatique en cas d'échec

#### **Fichiers générés**
```
📁 src/output/
└── openings.tsv              # Base complète des ouvertures (ECO + noms + PGN)
```

#### **Format des données**
```tsv
eco	name	pgn
A00	Uncommon Opening	1. g3
A00	Hungarian Opening	1. g3 d5 2. Bg2
A00	Benko Opening	1. g3 d5 2. Bg2 c6 3. c4
A01	Nimzo-Larsen Attack	1. b3
```

**Colonnes :**
- `eco` : Code ECO (Encyclopedia of Chess Openings)
- `name` : Nom officiel de l'ouverture
- `pgn` : Séquence de coups en notation PGN

#### **Ouvertures personnalisées**
Vous pouvez ajouter vos propres ouvertures dans `src/bonus/customOpenings.tsv` :

```tsv
eco	name	pgn
X00	Ma Propre Ouverture	1. e4 e5 2. Nf3 Nc6
```

**Usage typique :**
- 🎯 **Analyse d'ouvertures** : Identifier les ouvertures jouées dans vos datasets
- 🧠 **Entraînement** : Base de données complète pour l'apprentissage
- 📊 **Statistiques** : Analyser la popularité des ouvertures
- 🤖 **Engines d'échecs** : Intégration dans des moteurs ou applications

## 🎯 Exemples de fichiers générés

### Mode complet (`withOnlineGame: true`)
```
📁 src/output/
├── chesscom-2500.pgn      # Parties Chess.com (ELO ≥ 2500)
├── lichess-2500.pgn       # Parties Lichess (ELO ≥ 2500)
├── twic.pgn               # Parties TWIC
├── pgnmentor.pgn          # Parties PGN Mentor
├── twic-pgnmentor.pgn     # Dataset officiel (TWIC + PGN Mentor)
├── chessmont.pgn          # Dataset final complet
└── chessmont-pgi.tsv      # Index FEN → Game ID (si generateFen: true)
```

**Fichiers FEN (si `generateFen: true`) :**
```
📁 src/output/
├── fens-all.tsv           # Toutes les positions FEN
├── fens-withoutone.tsv    # Positions ≥ 2 occurrences
└── fens-onlyrecurrent.tsv # Positions ≥ 10 occurrences
```

### Mode hors-ligne (`withOnlineGame: false`)
```
📁 src/output/
├── twic.pgn               # Parties TWIC
├── pgnmentor.pgn          # Parties PGN Mentor
├── twic-pgnmentor.pgn     # Dataset final (TWIC + PGN Mentor)
└── twic-pgnmentor-pgi.tsv # Index FEN → Game ID (si generateFen: true)
```

**Fichiers FEN (si `generateFen: true`) :**
```
📁 src/output/
├── fens-all.tsv           # Toutes les positions FEN
├── fens-withoutone.tsv    # Positions ≥ 2 occurrences
└── fens-onlyrecurrent.tsv # Positions ≥ 10 occurrences
```

## 🛠️ Scripts individuels

Tous les scripts sont maintenant centralisés via la configuration et supportent une interface CLI moderne :

| Script | Description | Arguments CLI | Utilise config.json |
|--------|-------------|---------------|-------------------|
| `add-ids.js` | Ajoute des IDs uniques à chaque partie | ✅ | ✅ |
| `compil.js` | Compile plusieurs fichiers PGN en un seul | ✅ | ✅ |
| `deduplicate-pgn.js` | Supprime les doublons par hash | ✅ | ✅ |
| `game-checker.js` | Valide et nettoie les parties (streaming) | ✅ | ✅ |
| `fen.js` | Extrait les positions FEN | ✅ | ✅ |
| `src/lib/chesscom-downloader.js` | Télécharge Chess.com | ✅ | ✅ |
| `src/lib/chesscom-leaderboard.js` | Télécharge leaderboard | ✅ | ✅ |
| `src/lib/lichess-processor.js` | Télécharge Lichess | ✅ | ✅ |
| `src/utils/compress.js` | Compresse un fichier PGN | ✅ | ❌ |
| `src/utils/decompress.js` | Décompresse un fichier | ✅ | ❌ |
| `src/utils/count-pgn.js` | Compte les parties | ✅ | ❌ |
| `src/bonus/openings.js` | Base des ouvertures | ✅ | ✅ |

Vous pouvez aussi utiliser les scripts individuellement :

### Téléchargement
```bash
node src/pgn-chesscom.js     # Chess.com seulement
node src/pgn-lichess.js      # Lichess seulement
node src/pgn-twic.js         # TWIC seulement
node src/pgn-pgnmentor.js    # PGN Mentor seulement
```

### Traitement
```bash
# Compilation avec option officielle
node src/compil.js file1.pgn file2.pgn --official

# Déduplication (remplace le fichier original)
node src/deduplicate-pgn.js dataset.pgn

# Validation et nettoyage
node src/game-checker.js dataset.pgn

# Ajout d'IDs
node src/add-ids.js dataset.pgn

# Génération de FENs
node src/fen.js dataset.pgn
```

### Utilitaires
```bash
# Compression/décompression
node src/utils/compress.js dataset.pgn
node src/utils/decompress.js dataset.pgn.gz

# Compter les parties
node src/utils/count-pgn.js dataset.pgn
```

### Scripts bonus
```bash
# Télécharger la base complète des ouvertures d'échecs
node src/bonus/openings.js
```

## 📊 Performance

### Capacités testées
- ✅ **Fichiers jusqu'à 50GB** (décompressés)
- ✅ **Millions de parties** en une seule exécution
- ✅ **Streaming pur** : RAM constante même sur gros fichiers
- ✅ **Multithread** : utilise tous les cœurs CPU disponibles

### Optimisations
- **Streaming natif** : aucune limite de taille de fichier
- **Pool de workers** : traitement parallèle pour la validation
- **Décompression ZSTD** : support natif des archives Lichess
- **Protection mémoire** : ignore les parties corrompues trop volumineuses

## 🔍 Qualité des données

### Filtres appliqués
- ✅ **ELO minimum** configurable (défaut: 2500)
- ✅ **Durée minimum** configurable (défaut: 180s)
- ✅ **Profondeur minimum** configurable (défaut: 10 coups)
- ✅ **Exclusion des variantes** (King of the Hill, Atomic, etc.)
- ✅ **Validation PGN stricte** avec `chess.js`
- ✅ **Déduplication automatique**

### Sources de qualité
- **TWIC** : Tournois professionnels et parties de maîtres (semaine 920 → actuelle)
- **PGN Mentor** : Collection historique complète de parties annotées
- **Chess.com** : Top 10,000 joueurs du leaderboard blitz mondial
- **Lichess** : Base complète avec 6,7+ milliards de parties évaluées

## 🐛 Dépannage

### Erreurs courantes

**Erreur de mémoire lors de la validation**
```
✅ Protection automatique contre les parties corrompues
✅ Limitation à 50MB par partie
✅ Streaming pur : RAM constante
```

**Téléchargement échoué**
```bash
# Vérifiez votre connexion et relancez
node start.js
# Le script reprend automatiquement où il s'est arrêté
```

**Fichier corrompu**
```bash
# Le nettoyage automatique supprime les parties invalides
# Vérifiez les logs pour voir les erreurs détectées
```

## 📈 Monitoring

Le générateur affiche en temps réel :
- ⏱️ **Temps d'exécution** par étape
- 📊 **Nombre de parties** traitées
- 🚀 **Vitesse de traitement** (parties/seconde)
- 💾 **Tailles des fichiers** générés
- ❌ **Erreurs détectées** et corrigées

## 🤝 Contribution

Les contributions sont les bienvenues !

### Développement
```bash
git clone <votre-repo>
cd ChessDatasetGenerator
npm install
```

### Ajout d'une nouvelle source
1. Créer `src/pgn-nouvelle-source.js`
2. Implémenter le téléchargement
3. Ajouter à la configuration
4. Mettre à jour `start.js`

## 📄 License

Ce projet est sous licence [MIT](LICENSE).

## 🙏 Remerciements

- **Chess.com** pour leur API publique
- **Lichess** pour leur base de données ouverte
- **TWIC** pour leur archive historique
- **PGN Mentor** pour leur collection de parties
- **Chess.js** pour la validation PGN

---

💡 **Astuce** : Commencez avec `withOnlineGame: false` pour tester rapidement, puis activez les sources en ligne pour des datasets complets.

🔗 **Support** : Ouvrez une issue pour toute question ou suggestion d'amélioration.
