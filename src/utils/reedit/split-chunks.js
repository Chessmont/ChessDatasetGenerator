#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import { createInterface } from 'readline';

class ChunkSplitter {
  constructor() {
    this.oldChunksDir = './temp/old';
    this.newChunksDir = './temp';
    this.maxLinesPerChunk = 3000000;
    this.globalChunkIndex = 0;
    this.maxParallelChunks = Math.max(1, os.cpus().length);
    this.chunkIndexLock = 0;
  }
  /**
   * Obtient le prochain index de chunk de manière thread-safe
   */
  getNextChunkIndex() {
    return this.chunkIndexLock++;
  }

  /**
   * Divise un chunk en sous-chunks de 3M lignes maximum
   */
  async splitSingleChunk(chunkFile) {
    const chunkPath = path.join(this.oldChunksDir, chunkFile);

    console.log(`🔄 Division du ${chunkFile}...`);


    const fileStream = fs.createReadStream(chunkPath, { encoding: 'utf8' });
    const rl = createInterface({ input: fileStream });

    let currentLines = [];
    let totalLinesProcessed = 0;
    let subChunksCreated = 0;

    for await (const line of rl) {
      if (line.trim()) {
        currentLines.push(line);


        if (currentLines.length >= this.maxLinesPerChunk) {
          await this.writeSubChunk(currentLines, chunkFile);
          subChunksCreated++;
          totalLinesProcessed += currentLines.length;
          currentLines = [];
        }
      }
    }


    if (currentLines.length > 0) {
      await this.writeSubChunk(currentLines, chunkFile);
      subChunksCreated++;
      totalLinesProcessed += currentLines.length;
    }

    console.log(`   ✅ ${chunkFile} → ${subChunksCreated} sous-chunks (${totalLinesProcessed.toLocaleString()} lignes au total)`);
    return { subChunksCreated, totalLinesProcessed };
  }

  /**
   * Écrit un sous-chunk avec les lignes données
   */
  async writeSubChunk(lines, sourceChunkFile) {
    const chunkIndex = this.getNextChunkIndex();
    const newChunkFile = path.join(this.newChunksDir, `chunk_${chunkIndex}.tmp`);

    const writeStream = fs.createWriteStream(newChunkFile, { encoding: 'utf8' });

    for (const line of lines) {
      writeStream.write(line + '\n');
    }

    writeStream.end();
    await new Promise(resolve => writeStream.on('finish', resolve));

    console.log(`   📝 chunk_${chunkIndex}.tmp créé (${lines.length.toLocaleString()} lignes) depuis ${sourceChunkFile}`);
  }  /**
   * Divise tous les chunks
   */
  async splitAllChunks() {
    console.log('🚀 DIVISION DES CHUNKS EN SOUS-CHUNKS DE 3M LIGNES (MULTITHREAD)');
    console.log('=================================================================');
    console.log(`📁 Source: ${this.oldChunksDir}`);
    console.log(`📂 Destination: ${this.newChunksDir}`);
    console.log(`📏 Taille max par chunk: ${this.maxLinesPerChunk.toLocaleString()} lignes`);
    console.log(`🧵 Traitement parallèle: ${this.maxParallelChunks} chunks simultanés\n`);


    if (!fs.existsSync(this.oldChunksDir)) {
      throw new Error(`Dossier source non trouvé: ${this.oldChunksDir}`);
    }


    if (!fs.existsSync(this.newChunksDir)) {
      fs.mkdirSync(this.newChunksDir, { recursive: true });
    }


    const chunkFiles = fs.readdirSync(this.oldChunksDir)
      .filter(file => file.startsWith('chunk_') && file.endsWith('.tmp'))
      .sort((a, b) => {
        const numA = parseInt(a.match(/chunk_(\d+)\.tmp/)?.[1] || 0);
        const numB = parseInt(b.match(/chunk_(\d+)\.tmp/)?.[1] || 0);
        return numA - numB;
      });

    if (chunkFiles.length === 0) {
      throw new Error(`Aucun fichier chunk trouvé dans ${this.oldChunksDir}`);
    }

    console.log(`📂 ${chunkFiles.length} chunks trouvés à diviser\n`);

    console.time('⏱️  Division des chunks');


    let totalSubChunks = 0;
    let totalLinesProcessed = 0;

    for (let i = 0; i < chunkFiles.length; i += this.maxParallelChunks) {
      const batch = chunkFiles.slice(i, i + this.maxParallelChunks);

      console.log(`🔄 Traitement du batch ${Math.floor(i / this.maxParallelChunks) + 1}/${Math.ceil(chunkFiles.length / this.maxParallelChunks)} (${batch.length} chunks)`);


      const results = await Promise.all(
        batch.map(chunkFile => this.splitSingleChunk(chunkFile))
      );


      for (const result of results) {
        totalSubChunks += result.subChunksCreated;
        totalLinesProcessed += result.totalLinesProcessed;
      }

      const progress = ((i + batch.length) / chunkFiles.length * 100).toFixed(1);
      console.log(`   ✅ Batch terminé - Progression: ${progress}% (${totalSubChunks} sous-chunks créés)\n`);
    }

    console.timeEnd('⏱️  Division des chunks');


    const newChunkFiles = fs.readdirSync(this.newChunksDir)
      .filter(file => file.startsWith('chunk_') && file.endsWith('.tmp'));

    console.log(`\n✅ Division terminée !`);
    console.log(`📊 ${chunkFiles.length} chunks originaux → ${newChunkFiles.length} nouveaux chunks`);
    console.log(`📝 ${totalLinesProcessed.toLocaleString()} lignes traitées au total`);
    console.log(`📁 Nouveaux chunks dans: ${this.newChunksDir}`);
    console.log(`📏 Chaque nouveau chunk ≤ ${this.maxLinesPerChunk.toLocaleString()} lignes`);
  }

  /**
   * Lance la division
   */
  async run() {
    try {
      await this.splitAllChunks();
    } catch (error) {
      console.error(`❌ ERREUR: ${error.message}`);
      console.error('Stack:', error.stack);
      process.exit(1);
    }
  }
}


const splitter = new ChunkSplitter();
splitter.run();
