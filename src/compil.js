#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const configPath = path.join(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

/**
 * Script de compilation PGN - Réunit plusieurs fichiers PGN en un seul
 * Usage: node compil.js [--official] <fichier1.pgn> <fichier2.pgn> [fichier3.pgn...]
 */

class PGNCompiler {
  constructor() {
    this.stats = {
      totalFiles: 0,
      processedFiles: 0,
      totalGames: 0,
      totalSizeMB: 0,
      errors: 0
    };
  }

  /**
   * Compile plusieurs fichiers PGN en un seul
   */
  async compile(inputFiles, outputFile) {
    console.log('🚀 COMPILATION PGN DÉMARRÉE');
    console.log('===========================');

    this.stats.totalFiles = inputFiles.length;
    console.log(`📂 Fichiers d'entrée: ${inputFiles.length}`);
    console.log(`📁 Fichier de sortie: ${outputFile}`);


    const validFiles = await this.validateInputFiles(inputFiles);
    if (validFiles.length === 0) {
      throw new Error('Aucun fichier valide trouvé');
    }


    const outputDir = path.dirname(outputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }


    const writeStream = createWriteStream(outputFile);

    try {
      const startTime = Date.now();

      for (const inputFile of validFiles) {
        this.stats.processedFiles++;
        console.log(`\n📄 [${this.stats.processedFiles}/${validFiles.length}] Traitement: ${path.basename(inputFile)}`);

        await this.processFile(inputFile, writeStream);
        this.showProgress();
      }

      writeStream.end();

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      await this.showFinalStats(outputFile, duration);

    } catch (error) {
      writeStream.destroy();
      throw error;
    }
  }

  /**
   * Valide que les fichiers d'entrée existent et ne sont pas vides
   */
  async validateInputFiles(inputFiles) {
    const validFiles = [];

    for (const file of inputFiles) {
      try {
        if (!fs.existsSync(file)) {
          console.warn(`⚠️  Fichier introuvable: ${file}`);
          continue;
        }

        const stats = await fs.promises.stat(file);
        if (stats.size === 0) {
          console.warn(`⚠️  Fichier vide: ${file}`);
          continue;
        }

        validFiles.push(file);
        console.log(`✅ ${path.basename(file)} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

      } catch (error) {
        console.warn(`⚠️  Erreur fichier ${file}: ${error.message}`);
        this.stats.errors++;
      }
    }

    return validFiles;
  }

  /**
   * Traite un fichier et l'ajoute au flux de sortie
   */
  async processFile(inputFile, writeStream) {
    return new Promise((resolve, reject) => {
      const readStream = createReadStream(inputFile, { encoding: 'utf8' });

      let gameCount = 0;
      let processedSize = 0;
      const fileStats = fs.statSync(inputFile);
      const fileSizeMB = (fileStats.size / (1024 * 1024)).toFixed(1);

      readStream.on('data', (chunk) => {
        processedSize += chunk.length;


        const gameMatches = chunk.match(/\[Event /g);
        if (gameMatches) {
          gameCount += gameMatches.length;
        }


        writeStream.write(chunk);


        if (processedSize % (10 * 1024 * 1024) === 0) {
          const progress = ((processedSize / fileStats.size) * 100).toFixed(1);
          process.stdout.write(`\r  📈 Progrès: ${progress}% (${gameCount} parties)`);
        }
      });

      readStream.on('end', () => {

        writeStream.write('\n');

        this.stats.totalGames += gameCount;
        console.log(`\n  ✅ ${path.basename(inputFile)}: ${gameCount.toLocaleString()} parties (${fileSizeMB} MB)`);
        resolve();
      });

      readStream.on('error', (error) => {
        console.error(`❌ Erreur lecture ${inputFile}: ${error.message}`);
        this.stats.errors++;
        reject(error);
      });
    });
  }

  /**
   * Affiche la progression
   */
  showProgress() {
    const progress = ((this.stats.processedFiles / this.stats.totalFiles) * 100).toFixed(1);
    console.log(`📊 Progression: ${progress}% | Parties totales: ${this.stats.totalGames.toLocaleString()}`);
  }

  /**
   * Affiche les statistiques finales
   */
  async showFinalStats(outputFile, duration) {
    try {
      const outputStats = await fs.promises.stat(outputFile);
      const outputSizeMB = (outputStats.size / 1024 / 1024).toFixed(1);

      console.log('\n🏆 COMPILATION TERMINÉE !');
      console.log('=========================');
      console.log(`⏱️  Durée: ${duration}s`);
      console.log(`📊 Fichiers traités: ${this.stats.processedFiles}/${this.stats.totalFiles}`);
      console.log(`📊 Parties totales: ${this.stats.totalGames.toLocaleString()}`);
      console.log(`📊 Taille finale: ${outputSizeMB} MB`);
      console.log(`📊 Erreurs: ${this.stats.errors}`);
      console.log(`📁 Fichier final: ${outputFile}`);

    } catch (error) {
      console.warn('Impossible de récupérer les stats du fichier final');
    }
  }
}

/**
 * Fonction principale pour l'exécution depuis la ligne de commande
 */
async function main() {

  let args = process.argv.slice(2);
  let useOfficialName = false;


  if (args.includes('--official')) {
    useOfficialName = true;
    args = args.filter(arg => arg !== '--official');
  }

  const inputFiles = args;

  if (inputFiles.length === 0) {
    console.log('❌ ERREUR: Au moins un fichier PGN requis');
    console.log('');
    console.log('📖 USAGE:');
    console.log('  node compil.js [--official] <fichier1.pgn> <fichier2.pgn> [fichier3.pgn...]');
    console.log('');
    console.log('🔧 OPTIONS:');
    console.log('  --official    Utilise officialPGNFileName au lieu de finalPGNFileName');
    console.log('');
    console.log('📝 EXEMPLES:');
    console.log('  node compil.js ./output/chesscom-2500.pgn ./output/lichess-2500.pgn');
    console.log('  node compil.js --official ./output/twic.pgn ./output/pgnmentor.pgn');
    console.log('  node compil.js C:\\path\\to\\file1.pgn C:\\path\\to\\file2.pgn');
    console.log('');
    console.log('💡 Tous les fichiers doivent avoir l\'extension .pgn');

    if (useOfficialName) {
      console.log(`📁 Le fichier de sortie sera: ${config.officialPGNFileName} (mode officiel)`);
    } else {
      console.log(`📁 Le fichier de sortie sera: ${config.finalPGNFileName} (mode standard)`);
    }
    process.exit(1);
  }


  for (const file of inputFiles) {
    if (!file.toLowerCase().endsWith('.pgn')) {
      console.log(`❌ ERREUR: Le fichier doit avoir l'extension .pgn: ${file}`);
      console.log('💡 Assurez-vous que tous les fichiers sont des fichiers PGN valides');
      process.exit(1);
    }
  }


  const outputFileName = useOfficialName ? config.officialPGNFileName : config.finalPGNFileName;
  const outputFile = path.join(__dirname, 'output', outputFileName);

  console.log('🚀 COMPILATION PGN');
  console.log('==================');
  console.log(`🎯 Compilation de ${inputFiles.length} fichier(s) vers: ${outputFileName}`);

  if (useOfficialName) {
    console.log('🏛️  Mode OFFICIEL activé');
  } else {
    console.log('📦 Mode STANDARD');
  }

  try {
    const compiler = new PGNCompiler();
    await compiler.compile(inputFiles, outputFile);

  } catch (error) {
    console.error(`❌ ERREUR: ${error.message}`);
    process.exit(1);
  }
}


if (process.argv[1] && process.argv[1].endsWith('compil.js')) {
  main();
}
