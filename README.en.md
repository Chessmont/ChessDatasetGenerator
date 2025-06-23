# 🏆 Chess Dataset Generator

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chess.js](https://img.shields.io/badge/Chess.js-1.4.0-blue.svg)](https://github.com/jhlywa/chess.js)

**🌍 Language / Langue :** **English** | [Français](README.md)

An automated high-quality chess dataset generator, capable of downloading, filtering, cleaning and compiling millions of games from multiple prestigious sources, and also generating all FEN positions and aggregates.

## 📦 Pre-generated Dataset Available

🚀 **Direct Download on Kaggle**: [ChessMont Big Dataset](https://www.kaggle.com/datasets/chessmontdb/chessmont-big-dataset)

**Dataset Content:**
- 📊 **21.5 million high-quality games** (ELO ≥ 2500)
- ♟️ **1.8+ billion FEN positions** with complete statistics
- 🏆 **Premium sources**: TWIC, PGN Mentor, Chess.com Top 10K, Lichess
- ✅ **Clean data**: strict validation, deduplication, advanced filtering

*You can use this dataset directly or generate your own with this generator.*

## 🎯 Features

### 📥 **Multiple data sources**
- **Chess.com** - Games from top players (via API)
- **Lichess** - Complete monthly database
- **TWIC** (The Week in Chess) - Professional tournament games
- **PGN Mentor** - Collection of classic games

#### 🔍 **Detailed download functionality**

**TWIC (The Week in Chess)**
- Retrieves all recorded games from week 920 to the current week at script execution
- Source: Complete archive of worldwide professional tournaments

**PGN Mentor**
- Retrieves all archives from the site without exception
- Historical collection of annotated and commented games
- Source: Complete database from PGN Mentor website

**Lichess**
- Downloads all .zst files available on https://database.lichess.org/
- Volume: Over 6.7 billion games available
- Filtering: Applies conditions defined in config (ELO, time, etc.)
- Format: Monthly compressed ZSTD archives

**Chess.com**
- Retrieves via Chess.com API all players from the blitz leaderboard
- Limit: Up to the maximum defined in config (default top 10k from leaderboard)
- Downloads all games played by these players
- Filtering: Applies config conditions after download

### 🔧 **Advanced processing pipeline**
- **Smart filtering** by ELO, game duration, depth
- **Automatic deduplication** of identical games
- **Strict PGN validation** with automatic cleaning
- **Multithread streaming** for large files (>10GB)
- **Memory protection** against corrupted games

### ⚙️ **Centralized configuration**
- All parameters in a single `config.json` file
- "Online sources" mode can be enabled/disabled
- Automatic file name generation
- Customizable filtering criteria

## 🚀 Installation

### Prerequisites
- **Node.js 18+** (tested on Node.js 20)
- **8GB RAM minimum** (16GB recommended for large datasets)
- **50GB free disk space** minimum

### Install dependencies
```bash
npm install
```

## ⚙️ Configuration

Modify the `config.json` file according to your needs:

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
    "userAgent": "your-app/1.0 (contact: your@email.com)"
  }
}
```

### 📋 **Detailed parameters**

| Parameter | Description | Default value |
|-----------|-------------|---------------|
| `withOnlineGame` | Include Chess.com and Lichess | `true` |
| `minOnlineElo` | Minimum player ELO | `2500` |
| `minGameTime` | Minimum duration in seconds | `180` |
| `minPlyDepth` | Minimum number of moves | `10` |
| `generateFen` | Generate FEN files | `true` |
| `numberOfUsersInLeaderboard` | Top Chess.com players | `10000` |

## 🏁 Usage

### Complete dataset generation
```bash
node start.js
```

### Show help
```bash
node start.js --help
```

## 🔄 Generation process (7 steps)

The generator follows an optimized 7-step pipeline:

### 1. 🌐 **Source download**
- **Complete mode** (`withOnlineGame: true`): TWIC + PGN Mentor + Chess.com + Lichess
- **Offline mode** (`withOnlineGame: false`): TWIC + PGN Mentor only

### 2. 🔧 **Official compilation**
- Merges TWIC + PGN Mentor with strict filtering
- Generates the official file (e.g., `twic-pgnmentor.pgn`)

### 3. 🔄 **Deduplication**
- Automatically removes identical games
- Automatic security backup

### 4. 🔍 **Verification and cleaning**
- Strict PGN validation with `chess.js`
- **Complete mode**: checks Chess.com, Lichess and official file
- **Offline mode**: checks only the official file
- Multithread streaming for large files

### 5. 📦 **Final compilation**
- *(Complete mode only)*
- Merges all cleaned sources
- Generates the final dataset (e.g., `chessmont.pgn`)

### 6. 🏷️ **Adding identifiers**
- Adds unique IDs to each game
- Uses `nanoid` for short and safe identifiers

### 7. ♟️ **FEN generation** *(according to configuration)*
- Extracts all FEN positions from the final dataset
- Aggregates positions by occurrence with complete statistics
- Uses a **Multi-Phase K-way Aggregation Merge Multithread** algorithm
- Generates 4 output files with different filtering levels

#### 🧠 **Advanced aggregation algorithm**

The `fen.js` script analyzes all games in a PGN file and extracts each chess position (FEN notation) with result statistics (white win, black win, draw). Aggregation is done via a sophisticated multi-phase system:

**Extraction process:**
1. **Multithread parsing**: Analyzes games in parallel
2. **FEN extraction**: Generates all positions from each game
3. **Chunk sorting**: Organizes positions in alphabetical order
4. **K-way merge**: Merges and aggregates occurrences
5. **Report generation**: Creates final files according to thresholds

**⚠️ IMPORTANT PREREQUISITE:** The PGN file must have been processed by `add-ids.js` before running `fen.js` to generate the game index file.

#### 📊 **Files generated by fen.js**

| File | Description | Threshold |
|------|-------------|-----------|
| `fens-all.tsv` | All extracted positions | None |
| `fens-withoutone.tsv` | Recurring positions | ≥ 2 occurrences |
| `fens-onlyrecurrent.tsv` | Very recurring positions | ≥ 10 occurrences |
| `*-pgi.tsv` | FEN → Game ID index | All |

#### 📈 **Output data format**

```tsv
occurrence	white	black	draw
rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1	21512376	9683625	8431066	3397685
rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1	9933794	4453002	3932201	1548591
rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1	7239529	3258936	2821942	1158651
```

**Columns:**
- `occurrence`: Total number of position appearances
- `white`: Number of white wins from this position
- `black`: Number of black wins from this position
- `draw`: Number of draws from this position

**Example on 21.5M games:**
- Starting position: 21.5M occurrences (100% of games)
- 1.e4: 9.9M occurrences (46% of games start with 1.e4)
- 1.d4: 7.2M occurrences (34% of games start with 1.d4)

## 📁 Project structure

```
ChessDatasetGenerator/
├── 📄 config.json              # Centralized configuration
├── 🚀 start.js                 # Main script
├── 📂 src/
│   ├── 📥 pgn-chesscom.js      # Chess.com downloader
│   ├── 📥 pgn-lichess.js       # Lichess downloader
│   ├── 📥 pgn-pgnmentor.js     # PGN Mentor downloader
│   ├── 📥 pgn-twic.js          # TWIC downloader
│   ├── 🔧 compil.js            # Dataset compiler
│   ├── 🔄 deduplicate-pgn.js   # Deduplicator
│   ├── 🔍 game-checker.js      # Validator/cleaner
│   ├── 🏷️ add-ids.js           # ID generator
│   ├── ♟️ fen.js               # FEN extractor
│   ├── 📂 bonus/               # Bonus scripts and utilities
│   ├── 📂 lib/                 # Workers and utilities
│   ├── 📂 utils/               # Tools (compression, etc.)
│   └── 📂 output/              # Generated files
└── 📂 temp/                    # Temporary files
```

## 🎁 Bonus Scripts

### 📖 **Chess openings generator**

The `src/bonus/` folder contains specialized tools for managing chess openings.

#### **Script `openings.js`**
- **Source**: Official Lichess database (GitHub: lichess-org/chess-openings)
- **Function**: Downloads and compiles all known chess openings
- **Format**: Generates a TSV file with ECO codes, names and PGN notations

```bash
# Download all openings from Lichess
node src/bonus/openings.js
```

#### **Features**
- ✅ **Official source**: Lichess.org chess-openings repository
- ✅ **Complete ECO codes**: Encyclopedia of Chess Openings classification
- ✅ **Custom openings**: Support for `customOpenings.tsv`
- ✅ **chess.js validation**: Automatic verification of PGN sequences
- ✅ **Robust download**: Automatic retry on failure

#### **Generated files**
```
📁 src/output/
└── openings.tsv              # Complete openings database (ECO + names + PGN)
```

#### **Data format**
```tsv
eco	name	pgn
A00	Uncommon Opening	1. g3
A00	Hungarian Opening	1. g3 d5 2. Bg2
A00	Benko Opening	1. g3 d5 2. Bg2 c6 3. c4
A01	Nimzo-Larsen Attack	1. b3
```

**Columns:**
- `eco`: ECO code (Encyclopedia of Chess Openings)
- `name`: Official opening name
- `pgn`: Move sequence in PGN notation

#### **Custom openings**
You can add your own openings in `src/bonus/customOpenings.tsv`:

```tsv
eco	name	pgn
X00	My Own Opening	1. e4 e5 2. Nf3 Nc6
```

**Typical usage:**
- 🎯 **Opening analysis**: Identify openings played in your datasets
- 🧠 **Training**: Complete database for learning
- 📊 **Statistics**: Analyze opening popularity
- 🤖 **Chess engines**: Integration into engines or applications

## 🎯 Examples of generated files

### Complete mode (`withOnlineGame: true`)
```
📁 src/output/
├── chesscom-2500.pgn      # Chess.com games (ELO ≥ 2500)
├── lichess-2500.pgn       # Lichess games (ELO ≥ 2500)
├── twic.pgn               # TWIC games
├── pgnmentor.pgn          # PGN Mentor games
├── twic-pgnmentor.pgn     # Official dataset (TWIC + PGN Mentor)
├── chessmont.pgn          # Complete final dataset
└── chessmont-pgi.tsv      # FEN → Game ID index (if generateFen: true)
```

**FEN files (if `generateFen: true`):**
```
📁 src/output/
├── fens-all.tsv           # All FEN positions
├── fens-withoutone.tsv    # Positions ≥ 2 occurrences
└── fens-onlyrecurrent.tsv # Positions ≥ 10 occurrences
```

### Offline mode (`withOnlineGame: false`)
```
📁 src/output/
├── twic.pgn               # TWIC games
├── pgnmentor.pgn          # PGN Mentor games
├── twic-pgnmentor.pgn     # Final dataset (TWIC + PGN Mentor)
└── twic-pgnmentor-pgi.tsv # FEN → Game ID index (if generateFen: true)
```

**FEN files (if `generateFen: true`):**
```
📁 src/output/
├── fens-all.tsv           # All FEN positions
├── fens-withoutone.tsv    # Positions ≥ 2 occurrences
└── fens-onlyrecurrent.tsv # Positions ≥ 10 occurrences
```

## 🛠️ Individual scripts

All scripts are now centralized via configuration and support a modern CLI interface:

| Script | Description | CLI Arguments | Uses config.json |
|--------|-------------|---------------|------------------|
| `add-ids.js` | Adds unique IDs to each game | ✅ | ✅ |
| `compil.js` | Compiles multiple PGN files into one | ✅ | ✅ |
| `deduplicate-pgn.js` | Removes duplicates by hash | ✅ | ✅ |
| `game-checker.js` | Validates and cleans games (streaming) | ✅ | ✅ |
| `fen.js` | Extracts FEN positions | ✅ | ✅ |
| `src/lib/chesscom-downloader.js` | Downloads Chess.com | ✅ | ✅ |
| `src/lib/chesscom-leaderboard.js` | Downloads leaderboard | ✅ | ✅ |
| `src/lib/lichess-processor.js` | Downloads Lichess | ✅ | ✅ |
| `src/utils/compress.js` | Compresses a PGN file | ✅ | ❌ |
| `src/utils/decompress.js` | Decompresses a file | ✅ | ❌ |
| `src/utils/count-pgn.js` | Counts games | ✅ | ❌ |
| `src/bonus/openings.js` | Openings database | ✅ | ✅ |

You can also use the scripts individually:

### Download
```bash
node src/pgn-chesscom.js     # Chess.com only
node src/pgn-lichess.js      # Lichess only
node src/pgn-twic.js         # TWIC only
node src/pgn-pgnmentor.js    # PGN Mentor only
```

### Processing
```bash
# Compilation with official option
node src/compil.js file1.pgn file2.pgn --official

# Deduplication (replaces original file)
node src/deduplicate-pgn.js dataset.pgn

# Validation and cleaning
node src/game-checker.js dataset.pgn

# Adding IDs
node src/add-ids.js dataset.pgn

# FEN generation
node src/fen.js dataset.pgn
```

### Utilities
```bash
# Compression/decompression
node src/utils/compress.js dataset.pgn
node src/utils/decompress.js dataset.pgn.gz

# Count games
node src/utils/count-pgn.js dataset.pgn
```

### Bonus scripts
```bash
# Download complete chess openings database
node src/bonus/openings.js
```

## 📊 Performance

### Tested capabilities
- ✅ **Files up to 50GB** (uncompressed)
- ✅ **Millions of games** in single execution
- ✅ **Pure streaming**: constant RAM even on large files
- ✅ **Multithread**: uses all available CPU cores

### Optimizations
- **Native streaming**: no file size limit
- **Worker pool**: parallel processing for validation
- **ZSTD decompression**: native support for Lichess archives
- **Memory protection**: ignores corrupted games that are too large

## 🔍 Data quality

### Applied filters
- ✅ **Minimum ELO** configurable (default: 2500)
- ✅ **Minimum duration** configurable (default: 180s)
- ✅ **Minimum depth** configurable (default: 10 moves)
- ✅ **Variant exclusion** (King of the Hill, Atomic, etc.)
- ✅ **Strict PGN validation** with `chess.js`
- ✅ **Automatic deduplication**

### Quality sources
- **TWIC**: Professional tournaments and master games (week 920 → current)
- **PGN Mentor**: Complete historical collection of annotated games
- **Chess.com**: Top 10,000 players from the global blitz leaderboard
- **Lichess**: Complete database with 6.7+ billion evaluated games

## 🐛 Troubleshooting

### Common errors

**Memory error during validation**
```
✅ Automatic protection against corrupted games
✅ 50MB limit per game
✅ Pure streaming: constant RAM
```

**Download failed**
```bash
# Check your connection and restart
node start.js
# The script automatically resumes where it left off
```

**Corrupted file**
```bash
# Automatic cleaning removes invalid games
# Check logs to see detected errors
```

## 📈 Monitoring

The generator displays in real time:
- ⏱️ **Execution time** per step
- 📊 **Number of games** processed
- 🚀 **Processing speed** (games/second)
- 💾 **Generated file sizes**
- ❌ **Detected and corrected errors**

## 🤝 Contributing

Contributions are welcome!

### Development
```bash
git clone <your-repo>
cd ChessDatasetGenerator
npm install
```

### Adding a new source
1. Create `src/pgn-new-source.js`
2. Implement the download
3. Add to configuration
4. Update `start.js`

## 📄 License

This project is under [MIT](LICENSE) license.

## 🙏 Acknowledgments

- **Chess.com** for their public API
- **Lichess** for their open database
- **TWIC** for their historical archive
- **PGN Mentor** for their game collection
- **Chess.js** for PGN validation

---

💡 **Tip**: Start with `withOnlineGame: false` to test quickly, then enable online sources for complete datasets.

🔗 **Support**: Open an issue for any questions or improvement suggestions.
