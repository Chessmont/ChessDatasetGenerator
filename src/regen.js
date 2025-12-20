#!/usr/bin/env node

import fs from 'fs'
import { createInterface } from 'readline'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import os from 'os'
import WorkerPool from './lib/worker-pool.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

class TSVGenerator {
  constructor() {
    this.pgnFile = './src/output/chessmont.pgn'
    this.outputPgiFile = './src/output/all-pgi-v2.tsv'

    this.pgiStream = null
    this.processedGames = 0
    this.totalGames = 21512376
    this.totalPositions = 0
    this.startTime = null
    this.lastLogTime = 0

    this.pgiWorkerPool = null
    this.numWorkers = os.cpus().length
    this.batchSize = 1000
    this.maxQueueSize = this.numWorkers * 4
  }

  async run() {
    console.log('🚀 TSV GENERATOR V2 - Chess Dataset with cityHash64')
    console.log('====================================================')
    console.log(`📁 Input PGN: ${this.pgnFile}`)
    console.log(`📊 Output PGI: ${this.outputPgiFile}`)
    console.log(`🧵 Workers: ${this.numWorkers}`)
    console.log(`📦 Batch size: ${this.batchSize}`)
    console.log(`🚦 Max queue size: ${this.maxQueueSize}\n`)

    this.startTime = Date.now()

    try {
      await this.validateInputFiles()
      await this.parseGamesForPgi()
      await this.printFinalStats()
    } catch (error) {
      console.error('❌ Erreur lors de la génération:', error)
      throw error
    }
  }

  async validateInputFiles() {
    if (!fs.existsSync(this.pgnFile)) {
      throw new Error(`Fichier manquant: ${this.pgnFile}`)
    }
    console.log('✅ Fichier PGN trouvé')
  }

  async parseGamesForPgi() {
    console.log('\n🔄 Génération du fichier PGI depuis le PGN...')
    console.time('⏱️  Parsing PGN')

    this.pgiWorkerPool = new WorkerPool(join(__dirname, 'lib', 'regen-pgi-worker.js'))
    this.pgiStream = fs.createWriteStream(this.outputPgiFile)
    this.pgiStream.write('hashFen\tfen\tgameId\twhiteElo\tofficial\tdate\n')

    const stream = fs.createReadStream(this.pgnFile, { 
      encoding: 'utf8',
      highWaterMark: 1024 * 1024
    })
    const rl = createInterface({ input: stream })

    const batchLines = []
    const batchQueue = []
    let batchId = 0
    let streamPaused = false

    const processNextBatch = async () => {
      if (batchQueue.length === 0) return

      const batch = batchQueue.shift()

      if (streamPaused && batchQueue.length < this.maxQueueSize / 2) {
        streamPaused = false
        stream.resume()
      }

      const result = await this.pgiWorkerPool.execute({ pgnLines: batch.lines, batchId: batch.id })

      for (const pos of result.positions) {
        this.pgiStream.write(`${pos.hashFen}\t${pos.fen}\t${pos.gameId}\t${pos.whiteElo}\t${pos.official}\t${pos.date}\n`)
      }

      this.processedGames += result.processedGames
      this.totalPositions += result.positions.length

      if (this.processedGames % 1000 === 0) {
        this.updateProgressLog(this.processedGames, this.totalGames, 'parties')
      }
    }

    for await (const line of rl) {
      batchLines.push(line)

      if (batchLines.length >= this.batchSize) {
        const batch = { id: batchId++, lines: [...batchLines] }
        batchLines.length = 0

        batchQueue.push(batch)

        if (!streamPaused && batchQueue.length >= this.maxQueueSize) {
          streamPaused = true
          stream.pause()
        }

        processNextBatch()
      }
    }

    if (batchLines.length > 0) {
      batchQueue.push({ id: batchId++, lines: batchLines })
    }

    while (batchQueue.length > 0) {
      await processNextBatch()
    }

    await this.pgiWorkerPool.waitForCompletion()
    await this.pgiWorkerPool.shutdown()
    this.pgiStream.end()

    console.log()
    console.timeEnd('⏱️  Parsing PGN')
    console.log(`✅ ${this.processedGames.toLocaleString()} parties parsées`)
    console.log(`✅ ${this.totalPositions.toLocaleString()} positions traitées`)
  }

  updateProgressLog(processed, total, type) {
    const now = Date.now()

    if (now - this.lastLogTime < 1000) return
    this.lastLogTime = now

    const percentage = total > 0 ? ((processed / total) * 100).toFixed(1) : '0.0'
    const elapsed = (now - (this.startTime || now)) / 1000
    const avgTime = elapsed / processed
    const remaining = total - processed
    const eta = avgTime * remaining

    const elapsedStr = this.formatTime(elapsed)
    const etaStr = this.formatTime(eta)

    process.stdout.write(`\r🔄 ${type}: ${processed.toLocaleString()}/${total.toLocaleString()} (${percentage}%) - ⏱️ ${elapsedStr} / ETA ${etaStr}`)
  }

  formatTime(seconds) {
    if (seconds < 60) return `${Math.round(seconds)}s`
    if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60)
      const remainingSeconds = Math.round(seconds % 60)
      return `${minutes}min${remainingSeconds}s`
    }
    const hours = Math.floor(seconds / 3600)
    const remainingMinutes = Math.round((seconds % 3600) / 60)
    return `${hours}h${remainingMinutes}min`
  }

  async printFinalStats() {
    const totalElapsed = (Date.now() - (this.startTime || Date.now())) / 1000
    const totalElapsedStr = this.formatTime(totalElapsed)

    console.log('\n\n🎯 GÉNÉRATION PGI TERMINÉE')
    console.log('==============================')
    console.log(`⏱️  Temps total: ${totalElapsedStr}`)
    console.log(`🎯 Parties traitées: ${this.processedGames.toLocaleString()}`)
    console.log(`🔗 Liaisons game-positions: ${this.totalPositions.toLocaleString()}`)
    console.log(`✅ Fichier généré: ${this.outputPgiFile}`)
  }
}

const generator = new TSVGenerator()
generator.run().catch(console.error)
