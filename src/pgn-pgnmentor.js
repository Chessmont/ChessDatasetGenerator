#!/usr/bin/env node

import PGNMentorProcessor from './lib/pgnmentor-processor.js';
import fs from 'fs';

const PROGRESS_FILE = './src/progress/pgnmentor.pv';

class PgnMentorMain {
  constructor() {
    this.processor = new PGNMentorProcessor();
  }
  async readProgress(progressFile = PROGRESS_FILE) {
    try {
      if (fs.existsSync(progressFile)) {
        const content = await fs.promises.readFile(progressFile, 'utf8');
        const processedFiles = content.trim().split('\n').filter(line => line.trim());
        return { processedFiles };
      } else {
        console.log('Première exécution');
        return { processedFiles: [] };
      }
    } catch (error) {
      console.warn('Erreur lecture progression, reprise depuis le début');
      return { processedFiles: [] };
    }
  }

  async saveProgress(progressData, progressFile = PROGRESS_FILE) {
    try {
      const content = progressData.processedFiles.join('\n');
      await fs.promises.writeFile(progressFile, content, 'utf8');
    } catch (error) {
      console.warn(`Impossible de sauver la progression: ${error.message}`);
    }
  }
  async run() {
    console.log('Démarrage du traitement PGN Mentor avec déduplication avancée\n');
    console.time('Temps total');

    try {

      console.log('🔄 PRÉPARATION: Chargement des parties existantes');
      await this.processor.loadExistingHashes();
      console.log('');

      let totalGames = 0;
      let uniqueGames = 0;
      let duplicates = 0;
      let pgnFilesProcessed = 0;
      let zipFilesProcessed = 0;


      console.log('🎯 PHASE 1: Traitement des tournois (fichiers PGN directs)');
      console.log('📂 Récupération de la liste des fichiers PGN...');

      const allPgnLinks = await this.processor.getAllPgnLinks();
      console.log(`📁 ${allPgnLinks.length} fichiers PGN trouvés`);


      const progress = await this.readProgress();
      const processedSet = new Set(progress.processedFiles);

      const remainingPgnFiles = allPgnLinks.filter(link => !processedSet.has(link.name));
      console.log(`⏭️  ${remainingPgnFiles.length} fichiers PGN restants à traiter\n`);

      for (let i = 0; i < remainingPgnFiles.length; i++) {
        const pgnLink = remainingPgnFiles[i];
        console.log(`[${i + 1}/${remainingPgnFiles.length}] ${pgnLink.name}`);

        try {
          const stats = await this.processor.processPgnFile(pgnLink);

          totalGames += stats.totalGames;
          uniqueGames += stats.uniqueGames;
          duplicates += stats.duplicatesFound;
          pgnFilesProcessed++;

          progress.processedFiles.push(pgnLink.name);
          await this.saveProgress(progress);

          console.log(`✅ ${stats.uniqueGames} uniques, ${stats.duplicatesFound} doublons`);

        } catch (error) {
          console.error(`❌ Erreur: ${error.message}`);
          progress.processedFiles.push(pgnLink.name);
          await this.saveProgress(progress);
        }
      }

      console.log(`\n📊 Résumé Phase 1 - Fichiers PGN:`);
      console.log(`  Fichiers traités: ${pgnFilesProcessed}/${allPgnLinks.length}`);
      console.log(`  Parties uniques ajoutées: ${uniqueGames}`);
      console.log(`  Doublons évités: ${duplicates}\n`);


      console.log('🎯 PHASE 2: Traitement des collections (fichiers ZIP)');
      console.log('📦 Récupération de la liste des fichiers ZIP...');

      const allZipLinks = await this.processor.getAllZipLinks();
      console.log(`📁 ${allZipLinks.length} fichiers ZIP trouvés`);

      const remainingZipFiles = allZipLinks.filter(link => !processedSet.has(link.name));
      console.log(`⏭️  ${remainingZipFiles.length} fichiers ZIP restants à traiter\n`);

      for (let i = 0; i < remainingZipFiles.length; i++) {
        const zipLink = remainingZipFiles[i];
        console.log(`[${i + 1}/${remainingZipFiles.length}] ${zipLink.name}`);

        try {
          const stats = await this.processor.processZipFile(zipLink);

          totalGames += stats.totalGames;
          uniqueGames += stats.uniqueGames;
          duplicates += stats.duplicatesFound;
          zipFilesProcessed++;

          progress.processedFiles.push(zipLink.name);
          await this.saveProgress(progress);

          console.log(`✅ ${stats.uniqueGames} uniques, ${stats.duplicatesFound} doublons`);

        } catch (error) {
          console.error(`❌ Erreur: ${error.message}`);
          progress.processedFiles.push(zipLink.name);
          await this.saveProgress(progress);
        }
      }

      console.log('\n📊 Résumé final:');
      console.log(`  Fichiers PGN traités: ${pgnFilesProcessed}/${allPgnLinks.length}`);
      console.log(`  Fichiers ZIP traités: ${zipFilesProcessed}/${allZipLinks.length}`);
      console.log(`  Total parties analysées: ${totalGames}`);
      console.log(`  Parties uniques conservées: ${uniqueGames}`);
      console.log(`  Doublons éliminés: ${duplicates}`);

    } catch (error) {
      console.error('Erreur fatale:', error.message);
      process.exit(1);
    }

    console.timeEnd('Temps total');
    console.log('✅ Traitement PGN Mentor terminé !');
  }
}


const main = new PgnMentorMain();
main.run().catch(console.error);
