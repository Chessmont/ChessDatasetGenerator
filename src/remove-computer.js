#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { createInterface } from 'readline';

class ComputerGameRemover {
  constructor(inputFile) {
    if (!inputFile) {
      throw new Error('Fichier d\'entrée requis');
    }

    if (!inputFile.toLowerCase().endsWith('.pgn')) {
      throw new Error('Le fichier doit avoir l\'extension .pgn');
    }

    if (!fs.existsSync(inputFile)) {
      throw new Error(`Le fichier ${inputFile} n'existe pas`);
    }

    this.inputFile = inputFile;
    this.tempFile = inputFile + '.remove';
    this.computerEventPattern = /\[Event .*\b(TCEC|CCC|WCCC|Computer|ICGA)\b/i;

    this.stats = {
      totalGames: 0,
      keptGames: 0,
      removedGames: 0,
      processedBytes: 0,
      totalBytes: 0
    };
  }

  /**
   * Vérifie si une partie est une partie d'ordinateur
   */
  isComputerGame = (pgn) => this.computerEventPattern.test(pgn);

  /**
   * Filtre le fichier PGN en streaming
   */
  async filterFile() {
    const fileName = path.basename(this.inputFile);
    console.log(`🤖 DÉBUT SUPPRESSION PARTIES D'ORDINATEURS: ${fileName}`);
    console.log('==============================================');

    const fileStats = await fs.promises.stat(this.inputFile);
    const fileSizeMB = (fileStats.size / 1024 / 1024).toFixed(1);
    console.log(`📁 Taille du fichier: ${fileSizeMB} MB`);

    this.stats.totalBytes = fileStats.size;

    const writeStream = createWriteStream(this.tempFile, { encoding: 'utf8' });
    const readStream = createReadStream(this.inputFile, { encoding: 'utf8' });
    const rl = createInterface({
      input: readStream,
      crlfDelay: Infinity
    });

    console.log('🔄 Traitement en streaming...');
    console.log('🎯 Filtrage: TCEC, CCC, WCCC, Computer, ICGA');

    let currentGame = '';
    let lastProgressUpdate = Date.now();

    for await (const line of rl) {
      this.stats.processedBytes += Buffer.byteLength(line + '\n', 'utf8');

      const now = Date.now();
      if (now - lastProgressUpdate > 2000) {
        const progress = ((this.stats.processedBytes / this.stats.totalBytes) * 100).toFixed(1);
        const processedMB = (this.stats.processedBytes / 1024 / 1024).toFixed(1);
        process.stdout.write(`\r🔄 Progression: ${progress}% (${processedMB}/${fileSizeMB} MB) | Total: ${this.stats.totalGames} | Conservées: ${this.stats.keptGames} | Supprimées: ${this.stats.removedGames}`);
        lastProgressUpdate = now;
      }

      if (line.startsWith('[Event ')) {
        if (currentGame.trim() !== '') {
          this.stats.totalGames++;

          if (this.isComputerGame(currentGame)) {
            this.stats.removedGames++;
          } else {
            this.stats.keptGames++;
            writeStream.write(currentGame);
          }
        }

        currentGame = line + '\n';
      } else {
        currentGame += line + '\n';
      }
    }

    if (currentGame.trim() !== '') {
      this.stats.totalGames++;

      if (this.isComputerGame(currentGame)) {
        this.stats.removedGames++;
      } else {
        this.stats.keptGames++;
        writeStream.write(currentGame);
      }
    }

    writeStream.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    console.log('\n💾 Remplacement du fichier original...');

    const backupFile = this.inputFile + '.backup';
    await fs.promises.rename(this.inputFile, backupFile);
    await fs.promises.rename(this.tempFile, this.inputFile);

    console.log('\n✅ FILTRAGE TERMINÉ !');
    console.log('=====================');
    console.log(`📊 Parties totales: ${this.stats.totalGames.toLocaleString()}`);
    console.log(`📊 Parties conservées: ${this.stats.keptGames.toLocaleString()}`);
    console.log(`📊 Parties supprimées: ${this.stats.removedGames.toLocaleString()}`);

    if (this.stats.totalGames > 0) {
      console.log(`📊 Taux de suppression: ${((this.stats.removedGames / this.stats.totalGames) * 100).toFixed(2)}%`);
    }

    const originalStats = await fs.promises.stat(backupFile);
    const newStats = await fs.promises.stat(this.inputFile);
    const originalSizeMB = (originalStats.size / 1024 / 1024).toFixed(1);
    const newSizeMB = (newStats.size / 1024 / 1024).toFixed(1);
    const savedMB = (originalSizeMB - newSizeMB).toFixed(1);
    const savedPercent = ((savedMB / originalSizeMB) * 100).toFixed(1);

    console.log(`📊 Taille originale: ${originalSizeMB} MB`);
    console.log(`📊 Nouvelle taille: ${newSizeMB} MB`);
    console.log(`📊 Espace économisé: ${savedMB} MB (${savedPercent}%)`);
    console.log(`📁 Fichier nettoyé: ${this.inputFile}`);
    console.log(`📁 Backup sauvé: ${backupFile}`);
    console.log('💡 Tu peux supprimer le backup si tout est OK');
  }
}

const showHelp = () => {
  console.log(`
🤖 Script de Suppression des Parties d'Ordinateurs
╭─────────────────────────────────────────────────────────────╮
│ Supprime les parties d'engines/bots d'un fichier PGN       │
╰─────────────────────────────────────────────────────────────╯

Usage:
  node remove-computer.js <fichier.pgn>

Arguments:
  fichier.pgn     Le fichier PGN à nettoyer

Filtres appliqués:
  - TCEC (Top Chess Engine Championship)
  - CCC (Chess.com Computer Championship)
  - WCCC (World Computer Chess Championship)
  - Computer (événements avec "Computer")
  - ICGA (International Computer Games Association)

Exemples:
  node remove-computer.js output/twic.pgn
  node remove-computer.js final-dataset.pgn
`);
};

const main = async () => {
  try {
    const args = process.argv.slice(2);

    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
      showHelp();
      return;
    }

    if (args.length !== 1) {
      console.error('❌ Erreur: Un seul fichier PGN doit être spécifié');
      showHelp();
      process.exit(1);
    }

    const inputFile = args[0];

    console.log('🤖 SCRIPT DE SUPPRESSION DES PARTIES D\'ORDINATEURS');
    console.log('==================================================');
    console.log(`🎯 Fichier d'entrée: ${inputFile}`);

    const remover = new ComputerGameRemover(inputFile);

    const startTime = Date.now();
    await remover.filterFile();
    const endTime = Date.now();

    const durationSeconds = ((endTime - startTime) / 1000).toFixed(1);
    console.log(`⏰ Durée totale: ${durationSeconds} secondes`);
    console.log('🏆 NETTOYAGE TERMINÉ AVEC SUCCÈS !');

  } catch (error) {
    console.error(`❌ Erreur: ${error.message}`);
    process.exit(1);
  }
};

process.on('uncaughtException', (error) => {
  console.error('\n❌ ERREUR FATALE:', error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('\n❌ ERREUR:', reason);
  process.exit(1);
});

main().catch(error => {
  console.error('❌ ERREUR:', error.message);
  process.exit(1);
});
