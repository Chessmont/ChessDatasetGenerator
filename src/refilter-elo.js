#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class EloRefilter {
  constructor() {
    this.outputDir = path.join(__dirname, 'output');
    this.inputFiles = [
      {
        input: path.join(this.outputDir, 'lichess-2400-180.pgn'),
        output: path.join(this.outputDir, 'lichess-2500-180.pgn'),
        name: 'Lichess'
      },
      {
        input: path.join(this.outputDir, 'chesscom-2400-180.pgn'),
        output: path.join(this.outputDir, 'chesscom-2500-180.pgn'),
        name: 'Chess.com'
      }
    ];
    this.CHUNK_SIZE = 2 * 1024 * 1024; // 2MB par chunk
    this.stats = {
      totalFiles: 0,
      totalGamesInput: 0,
      totalGamesOutput: 0,
      totalSizeInput: 0,
      totalSizeOutput: 0
    };
  }

  /**
   * Point d'entrée principal
   */
  async run() {
    try {
      console.log('🔄 DÉBUT RE-FILTRAGE ELO 2500+');
      console.log('===============================');

      for (const fileConfig of this.inputFiles) {
        if (fs.existsSync(fileConfig.input)) {
          console.log(`\n📂 Traitement: ${fileConfig.name}`);
          await this.processFile(fileConfig);
        } else {
          console.log(`⚠️  Fichier non trouvé: ${fileConfig.input}`);
        }
      }

      this.showFinalStats();

    } catch (error) {
      console.error(`❌ ERREUR: ${error.message}`);
      process.exit(1);
    }
  }
  /**
   * Traite un fichier PGN
   */
  async processFile(fileConfig) {
    const { input, output, name } = fileConfig;

    // Statistiques du fichier d'entrée
    const inputStats = fs.statSync(input);
    const inputSizeMB = (inputStats.size / (1024 * 1024)).toFixed(2);

    console.log(`📊 Fichier d'entrée: ${inputSizeMB} MB`);
    console.log(`🔍 Filtrage ELO >= 2500...`);

    // Initialiser le fichier de sortie
    if (fs.existsSync(output)) {
      fs.unlinkSync(output);
    }
    
    let totalGamesInput = 0;
    let totalGamesOutput = 0;
    let processedSize = 0;
    let currentGame = '';
    let gameHeaders = {};
    let inGameMoves = false;

    const writeStream = fs.createWriteStream(output, { flags: 'w' });

    const processCompleteGame = () => {
      if (currentGame.trim()) {
        totalGamesInput++;

        if (this.shouldKeepGame(gameHeaders)) {
          writeStream.write(currentGame + '\n\n');
          totalGamesOutput++;
        }

        // Afficher le progrès détaillé
        if (totalGamesInput % 5000 === 0) {
          const progress = ((processedSize / inputStats.size) * 100).toFixed(1);
          const keepRate = totalGamesInput > 0 ? ((totalGamesOutput / totalGamesInput) * 100).toFixed(1) : '0.0';
          const rejected = totalGamesInput - totalGamesOutput;
          process.stdout.write(`\r📈 Traité: ${totalGamesInput.toLocaleString()} | ✅ Gardé: ${totalGamesOutput.toLocaleString()} (${keepRate}%) | ❌ Rejeté: ${rejected.toLocaleString()} | 📊 Progression: ${progress}%`);
        }
      }

      // Reset pour la prochaine partie
      currentGame = '';
      gameHeaders = {};
      inGameMoves = false;
    };

    // Lire le fichier par chunks
    const stream = fs.createReadStream(input, { encoding: 'utf8' });
    let buffer = '';

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => {
        buffer += chunk;
        processedSize += chunk.length;

        const lines = buffer.split('\n');
        // Garder la dernière ligne incomplète dans le buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('[Event ')) {
            if (currentGame) {
              processCompleteGame();
            }
            currentGame = line + '\n';
            gameHeaders = { Event: this.extractHeaderValue(line, 'Event') };
            inGameMoves = false;
          }
          else if (line.startsWith('[') && !inGameMoves) {
            currentGame += line + '\n';

            if (line.startsWith('[WhiteElo ')) {
              gameHeaders.WhiteElo = parseInt(this.extractHeaderValue(line, 'WhiteElo')) || 0;
            } else if (line.startsWith('[BlackElo ')) {
              gameHeaders.BlackElo = parseInt(this.extractHeaderValue(line, 'BlackElo')) || 0;
            }
          }
          else if (line.trim() === '' && currentGame && !inGameMoves) {
            currentGame += line + '\n';
            inGameMoves = true;
          }
          else if (inGameMoves || (!line.startsWith('[') && currentGame)) {
            currentGame += line + '\n';
            inGameMoves = true;

            // Détecter la fin de partie
            if (line.match(/\s+(1-0|0-1|1\/2-1\/2|\*)\s*$/)) {
              processCompleteGame();
            }
          }
        }
      });

      stream.on('end', () => {
        // Traiter la dernière ligne restante
        if (buffer.trim()) {
          const line = buffer.trim();
          if (line.startsWith('[Event ')) {
            if (currentGame) {
              processCompleteGame();
            }
            currentGame = line + '\n';
          } else if (currentGame) {
            currentGame += line + '\n';
            if (line.match(/\s+(1-0|0-1|1\/2-1\/2|\*)\s*$/)) {
              processCompleteGame();
            }
          }
        }

        // Traiter la dernière partie si elle existe
        if (currentGame) {
          processCompleteGame();
        }

        writeStream.end();

        // Statistiques finales
        const outputStats = fs.statSync(output);
        const outputSizeMB = (outputStats.size / (1024 * 1024)).toFixed(2);
        const reductionPercent = (((inputStats.size - outputStats.size) / inputStats.size) * 100).toFixed(1);

        console.log(`\n✅ ${name} terminé:`);
        const keepRate = totalGamesInput > 0 ? ((totalGamesOutput / totalGamesInput) * 100).toFixed(1) : '0.0';
        const rejected = totalGamesInput - totalGamesOutput;
        console.log(`   📊 Parties: ${totalGamesInput.toLocaleString()} → ${totalGamesOutput.toLocaleString()} (${keepRate}% gardées)`);
        console.log(`   ❌ Rejetées: ${rejected.toLocaleString()} (ELO < 2500)`);
        console.log(`   📏 Taille: ${inputSizeMB} MB → ${outputSizeMB} MB (-${reductionPercent}%)`);
        console.log(`   📁 Sortie: ${path.basename(output)}`);

        // Mettre à jour les stats globales
        this.stats.totalFiles++;
        this.stats.totalGamesInput += totalGamesInput;
        this.stats.totalGamesOutput += totalGamesOutput;
        this.stats.totalSizeInput += inputStats.size;
        this.stats.totalSizeOutput += outputStats.size;

        resolve();
      });

      stream.on('error', reject);
    });
  }
  /**
   * Vérifie si une partie doit être conservée (ELO >= 2500)
   */
  shouldKeepGame(gameHeaders) {
    const whiteElo = gameHeaders.WhiteElo || 0;
    const blackElo = gameHeaders.BlackElo || 0;

    return whiteElo >= 2500 && blackElo >= 2500;
  }

  /**
   * Extrait la valeur d'un header PGN
   */
  extractHeaderValue(headerLine, headerName) {
    const match = headerLine.match(new RegExp(`\\[${headerName}\\s+"([^"]*)"\\]`));
    return match ? match[1] : '';
  }

  /**
   * Affiche les statistiques finales
   */
  showFinalStats() {
    const inputSizeMB = (this.stats.totalSizeInput / (1024 * 1024)).toFixed(2);
    const outputSizeMB = (this.stats.totalSizeOutput / (1024 * 1024)).toFixed(2);
    const reductionPercent = (((this.stats.totalSizeInput - this.stats.totalSizeOutput) / this.stats.totalSizeInput) * 100).toFixed(1);

    console.log('\n════════════════════════════════════════════════════════════');
    console.log('📊 RÉSUMÉ FINAL RE-FILTRAGE ELO 2500+');
    console.log('════════════════════════════════════════════════════════════');
    console.log(`📁 Fichiers traités: ${this.stats.totalFiles}`);
    console.log(`📈 Parties: ${this.stats.totalGamesInput.toLocaleString()} → ${this.stats.totalGamesOutput.toLocaleString()} (${((this.stats.totalGamesOutput / this.stats.totalGamesInput) * 100).toFixed(1)}%)`);
    console.log(`📏 Taille: ${inputSizeMB} MB → ${outputSizeMB} MB (-${reductionPercent}%)`);
    console.log('────────────────────────────────────────────────────────────');
    console.log('🎯 Fichiers générés:');
    console.log('   📁 lichess-2500.pgn');
    console.log('   📁 chesscom-2500.pgn');
    console.log('════════════════════════════════════════════════════════════');
  }
}

// Exécution directe
const refilter = new EloRefilter();
refilter.run();

export default EloRefilter;
