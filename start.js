#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Charger la configuration
const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

class DatasetGenerator {
  constructor() {
    this.srcDir = path.join(__dirname, 'src');
    this.outputDir = path.join(__dirname, 'src', 'output');


    const minElo = config.minOnlineElo;
    const minTime = config.minGameTime;

    this.sourceFiles = {
      twic: path.join(this.outputDir, 'twic.pgn'),
      pgnmentor: path.join(this.outputDir, 'pgnmentor.pgn'),
      chesscom: path.join(this.outputDir, `chesscom-${minElo}-${minTime}.pgn`),
      lichess: path.join(this.outputDir, `lichess-${minElo}-${minTime}.pgn`)
    };

    this.finalPGN = path.join(this.outputDir, config.finalPGNFileName);
    this.officialPGN = path.join(this.outputDir, config.officialPGNFileName);
    this.withOnlineGame = config.withOnlineGame;
  }

  /**
   * Exécute une commande Node.js et retourne une promesse
   */
  runNodeScript(scriptPath, args = []) {
    return new Promise((resolve, reject) => {
      const scriptName = path.basename(scriptPath);
      console.log(`\n🚀 Lancement: ${scriptName} ${args.join(' ')}`);
      console.time(`⏱️  ${scriptName}`);

      const nodeProcess = spawn('node', [scriptPath, ...args], {
        stdio: 'inherit',
        cwd: __dirname
      });

      nodeProcess.on('close', (code) => {
        console.timeEnd(`⏱️  ${scriptName}`);
        if (code === 0) {
          console.log(`✅ ${scriptName} terminé avec succès`);
          resolve();
        } else {
          console.error(`❌ ${scriptName} a échoué avec le code: ${code}`);
          reject(new Error(`Script ${scriptName} failed with code ${code}`));
        }
      });

      nodeProcess.on('error', (error) => {
        console.timeEnd(`⏱️  ${scriptName}`);
        console.error(`❌ Erreur lors du lancement de ${scriptName}:`, error.message);
        reject(error);
      });
    });
  }

  /**
   * Vérifie si un fichier existe et contient des données
   */
  checkFile(filePath) {
    try {
      const stats = fs.statSync(filePath);
      const sizeKB = (stats.size / 1024).toFixed(1);
      console.log(`📁 ${path.basename(filePath)}: ${sizeKB} KB`);
      return stats.size > 0;
    } catch (error) {
      console.log(`⚠️  ${path.basename(filePath)}: Non trouvé`);
      return false;
    }
  }

  /**
   * Affiche un rapport des fichiers générés
   */
  showFilesReport() {
    console.log('\n📊 FICHIERS GÉNÉRÉS');
    console.log('===================');

    Object.entries(this.expectedFiles).forEach(([source, filePath]) => {
      this.checkFile(filePath);
    });

    console.log('\n📋 FICHIERS FINAUX');
    console.log('==================');
    this.checkFile(this.finalPGN);
    this.checkFile(this.officialPGN);
  }

  /**
   * Télécharge les données depuis toutes les sources acceptées
   */
  async downloadAllSources() {
    console.log('\n🌐 PHASE 1: TÉLÉCHARGEMENT DES SOURCES');
    console.log('======================================');


    const mandatoryScripts = [
      path.join(this.srcDir, 'pgn-pgnmentor.js'),
      path.join(this.srcDir, 'pgn-twic.js')
    ];


    const onlineScripts = [
      path.join(this.srcDir, 'pgn-chesscom.js'),
      path.join(this.srcDir, 'pgn-lichess.js')
    ];


    console.log('📦 Téléchargement des sources obligatoires (TWIC + PGN Mentor)');
    for (const script of mandatoryScripts) {
      try {
        await this.runNodeScript(script);
      } catch (error) {
        console.error(`⚠️  Échec du téléchargement ${path.basename(script)}, mais on continue...`);
      }
    }


    if (this.withOnlineGame) {
      console.log('🌐 Téléchargement des sources en ligne (Chess.com + Lichess)');
      for (const script of onlineScripts) {
        try {
          await this.runNodeScript(script);
        } catch (error) {
          console.error(`⚠️  Échec du téléchargement ${path.basename(script)}, mais on continue...`);
        }
      }
    } else {
      console.log('⏭️  Sources en ligne désactivées (withOnlineGame: false)');
    }
  }

  /**
   * ÉTAPE 2: Compile TWIC + PGN Mentor avec --official
   */
  async compileOfficial() {
    console.log('\n🔧 PHASE 2: COMPILATION OFFICIELLE (TWIC + PGN Mentor)');
    console.log('=====================================================');

    const compilScript = path.join(this.srcDir, 'compil.js');
    const officialSources = [this.sourceFiles.twic, this.sourceFiles.pgnmentor];

    console.log(`📦 Compilation officielle → ${config.officialPGNFileName}`);
    await this.runNodeScript(compilScript, [...officialSources, '--official']);
  }

  /**
   * ÉTAPE 3: Déduplique le fichier officiel
   */
  async deduplicateOfficial() {
    console.log('\n🔄 PHASE 3: DÉDUPLICATION DU FICHIER OFFICIEL');
    console.log('==============================================');

    const deduplicateScript = path.join(this.srcDir, 'deduplicate-pgn.js');
    console.log(`🧹 Déduplication → ${config.officialPGNFileName}`);
    await this.runNodeScript(deduplicateScript, [this.officialPGN]);
  }

  /**
   * ÉTAPE 4: Vérifie et nettoie les fichiers avec game-checker
   */
  async checkAndCleanGames() {
    console.log('\n🔍 PHASE 4: VÉRIFICATION ET NETTOYAGE DES PARTIES');
    console.log('=================================================');

    const gameCheckerScript = path.join(this.srcDir, 'game-checker.js');

    if (this.withOnlineGame) {

      console.log('🌐 Vérification des 3 sources (en ligne + officiel)');

      const filesToCheck = [
        this.sourceFiles.chesscom,
        this.sourceFiles.lichess,
        this.officialPGN
      ];

      for (const file of filesToCheck) {
        if (this.checkFile(file)) {
          console.log(`🔍 Vérification → ${path.basename(file)}`);
          await this.runNodeScript(gameCheckerScript, [file]);
        } else {
          console.log(`⏭️  Fichier absent, ignoré → ${path.basename(file)}`);
        }
      }
    } else {

      console.log('📁 Vérification du fichier officiel uniquement');
      console.log(`🔍 Vérification → ${config.officialPGNFileName}`);
      await this.runNodeScript(gameCheckerScript, [this.officialPGN]);
    }
  }

  /**
   * ÉTAPE 5: Compile le dataset final (si withOnlineGame = true)
   */
  async compileFinal() {
    if (!this.withOnlineGame) {
      console.log('\n⏭️  PHASE 5: COMPILATION FINALE IGNORÉE (withOnlineGame: false)');
      return;
    }

    console.log('\n🔧 PHASE 5: COMPILATION FINALE (TOUTES LES SOURCES)');
    console.log('===================================================');

    const compilScript = path.join(this.srcDir, 'compil.js');


    const availableFiles = [];
    const filesToCompile = [
      this.sourceFiles.chesscom,
      this.sourceFiles.lichess,
      this.officialPGN
    ];

    filesToCompile.forEach(file => {
      if (this.checkFile(file)) {
        availableFiles.push(file);
      }
    });

    if (availableFiles.length === 0) {
      throw new Error('Aucun fichier source disponible pour la compilation finale');
    }

    console.log(`📦 Compilation finale (${availableFiles.length} sources) → ${config.finalPGNFileName}`);
    await this.runNodeScript(compilScript, availableFiles);
  }

  /**
   * ÉTAPE 6: Ajoute les IDs au fichier final
   */
  async addIds() {
    console.log('\n🏷️  PHASE 6: AJOUT DES IDs');
    console.log('==========================');

    const addIdsScript = path.join(this.srcDir, 'add-ids.js');


    const sourceFile = this.withOnlineGame ? this.finalPGN : this.officialPGN;
    const sourceLabel = this.withOnlineGame ? config.finalPGNFileName : config.officialPGNFileName;

    console.log(`🏷️  Ajout des IDs → ${sourceLabel}`);
    await this.runNodeScript(addIdsScript, [sourceFile]);
  }

  /**
   * ÉTAPE 7: Génère les FENs (optionnel)
   */
  async generateFens() {
    console.log('\n♟️  PHASE 7: GÉNÉRATION DES FENs');
    console.log('===============================');

    // Vérifier si la génération des FENs est activée
    if (!config.generateFen) {
      console.log('⏭️  Génération des FENs désactivée dans la configuration');
      console.log('💡 Pour activer : définir "generateFen": true dans config.json');
      return;
    }

    const fenScript = path.join(this.srcDir, 'fen.js');


    const sourceFile = this.withOnlineGame ? this.finalPGN : this.officialPGN;
    const sourceLabel = this.withOnlineGame ? config.finalPGNFileName : config.officialPGNFileName;

    console.log(`♟️  Génération FENs depuis → ${sourceLabel}`);
    await this.runNodeScript(fenScript, [sourceFile]);
  }
  /**
   * Lance le processus complet de génération selon la configuration
   */
  async generateDataset() {
    const startTime = Date.now();

    console.log('🏁 GÉNÉRATEUR DE DATASET D\'ÉCHECS');
    console.log('==================================');
    console.log(`📅 Démarrage: ${new Date().toLocaleString('fr-FR')}`);
    console.log(`⚙️  Configuration:`);
    console.log(`   • ELO minimum: ${config.minOnlineElo}`);
    console.log(`   • Temps minimum: ${config.minGameTime}s`);
    console.log(`   • Profondeur: ${config.minPlyDepth} coups`);
    console.log(`   • Sources en ligne: ${this.withOnlineGame ? 'OUI' : 'NON'}`);

    try {

      await this.downloadAllSources();


      await this.compileOfficial();


      await this.deduplicateOfficial();


      await this.checkAndCleanGames();


      await this.compileFinal();


      await this.addIds();


      // ÉTAPE 7: Génération des FENs (selon configuration)
      await this.generateFens();


      const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      console.log('\n🎉 GÉNÉRATION TERMINÉE AVEC SUCCÈS');
      console.log('==================================');
      console.log(`⏱️  Durée totale: ${duration} minutes`);
      console.log(`📅 Fin: ${new Date().toLocaleString('fr-FR')}`);

      this.showFilesReport();

    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      console.error('\n💥 ERREUR LORS DE LA GÉNÉRATION');
      console.error('===============================');
      console.error(`❌ ${error.message}`);
      console.error(`⏱️  Durée avant échec: ${duration} minutes`);

      this.showFilesReport();
      process.exit(1);
    }
  }

  /**
   * Affiche un rapport des fichiers générés
   */
  showFilesReport() {
    console.log('\n📊 RAPPORT DES FICHIERS');
    console.log('=======================');

    console.log('\n📁 Sources téléchargées:');
    console.log(`   TWIC: ${this.checkFile(this.sourceFiles.twic) ? '✅' : '❌'}`);
    console.log(`   PGN Mentor: ${this.checkFile(this.sourceFiles.pgnmentor) ? '✅' : '❌'}`);

    if (this.withOnlineGame) {
      console.log(`   Chess.com: ${this.checkFile(this.sourceFiles.chesscom) ? '✅' : '❌'}`);
      console.log(`   Lichess: ${this.checkFile(this.sourceFiles.lichess) ? '✅' : '❌'}`);
    }

    console.log('\n📋 Fichiers finaux:');
    const officialExists = this.checkFile(this.officialPGN);
    const finalExists = this.checkFile(this.finalPGN);

    console.log(`   ${config.officialPGNFileName}: ${officialExists ? '✅' : '❌'}`);
    if (this.withOnlineGame) {
      console.log(`   ${config.finalPGNFileName}: ${finalExists ? '✅' : '❌'}`);
    }


    if (officialExists) this.checkFile(this.officialPGN);
    if (finalExists && this.withOnlineGame) this.checkFile(this.finalPGN);
  }
}


const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
🏁 Générateur de Dataset d'Échecs
=================================

Usage: node start.js [options]

Options:
  --help, -h     Affiche cette aide

Description:
  Lance le processus complet de génération du dataset d'échecs selon la configuration.

PROCESSUS (7 ÉTAPES):
  1. 🌐 Téléchargement des sources
     ${config.withOnlineGame ? '• TWIC, PGN Mentor, Chess.com, Lichess' : '• TWIC, PGN Mentor uniquement'}

  2. 🔧 Compilation officielle (TWIC + PGN Mentor → ${config.officialPGNFileName})

  3. 🔄 Déduplication du fichier officiel

  4. 🔍 Vérification et nettoyage des parties
     ${config.withOnlineGame ? '• Chess.com, Lichess, Officiel' : '• Fichier officiel uniquement'}

  5. 📦 Compilation finale${config.withOnlineGame ? ` (toutes sources → ${config.finalPGNFileName})` : ' (ignorée)'}

  6. 🏷️  Ajout des IDs au fichier final

  7. ♟️  Génération des FENs (selon configuration)

Configuration actuelle (config.json):
  • ELO minimum: ${config.minOnlineElo}
  • Temps minimum: ${config.minGameTime}s
  • Profondeur: ${config.minPlyDepth} coups
  • Sources en ligne: ${config.withOnlineGame ? 'ACTIVÉES' : 'DÉSACTIVÉES'}
  • Génération FENs: ${config.generateFen ? 'ACTIVÉE' : 'DÉSACTIVÉE'}

Fichiers générés:
  • ${config.officialPGNFileName} (dataset officiel filtré)
  ${config.withOnlineGame ? `• ${config.finalPGNFileName} (dataset complet avec sources en ligne)` : ''}
`);
  process.exit(0);
}


const generator = new DatasetGenerator();
generator.generateDataset().catch(error => {
  console.error('Erreur fatale:', error.message);
  process.exit(1);
});
