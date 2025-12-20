#!/usr/bin/env node

import fs from 'fs'
import { createInterface } from 'readline'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import WorkerPool from './lib/worker-pool.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

class TSVGenerator {
  constructor() {
    this.pgnFile = './scripts/data/chessmont.pgn'
    this.inputFensFile = './src/output/fens-all.tsv'
    this.outputPgiFile = './src/output/all-pgi-v2.tsv'
    this.outputFensFile = './src/output/fens-all-v2.tsv'

    this.pgiStream = null
    this.processedGames = 0
    this.totalGames = 21512376
    this.totalPositions = 0
    this.startTime = null
    this.lastLogTime = 0

    this.pgiWorkerPool = null
    this.fensWorkerPool = null
    this.batchSize = 1000
  }

  async run() {
    console.log('🚀 TSV GENERATOR V2 - Chess Dataset with cityHash64')
    console.log('====================================================')
    console.log(`📁 Input PGN: ${this.pgnFile}`)
    console.log(`📁 Input Fens: ${this.inputFensFile}`)
    console.log(`📊 Output PGI: ${this.outputPgiFile}`)
    console.log(`📝 Output Fens: ${this.outputFensFile}\n`)

    this.startTime = Date.now()

    try {
      await this.validateInputFiles()
      await this.parseGamesForPgi()
      await this.processFensFile()
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
    if (!fs.existsSync(this.inputFensFile)) {
      throw new Error(`Fichier manquant: ${this.inputFensFile}`)
    }
    console.log('✅ Fichiers trouvés')
  }

  async parseGamesForPgi() {
    console.log('\n🔄 Génération du fichier PGI depuis le PGN...')
    console.time('⏱️  Parsing PGN')

    this.pgiWorkerPool = new WorkerPool(join(__dirname, 'lib', 'regen-pgi-worker.js'))
    this.pgiStream = fs.createWriteStream(this.outputPgiFile)
    this.pgiStream.write('hashFen\tfen\tgameId\twhiteElo\tofficial\tdate\n')

    const stream = fs.createReadStream(this.pgnFile, { encoding: 'utf8' })
    const rl = createInterface({ input: stream })

    const batchLines = []
    const pendingBatches = []
    let batchId = 0

    for await (const line of rl) {
      batchLines.push(line)

      if (batchLines.length >= this.batchSize) {
        const batch = [...batchLines]
        batchLines.length = 0

        const promise = this.processPgiBatch(batch, batchId++)
        pendingBatches.push(promise)

        if (pendingBatches.length >= 100) {
          await Promise.race(pendingBatches)
        }
      }
    }

    if (batchLines.length > 0) {
      pendingBatches.push(this.processPgiBatch(batchLines, batchId++))
    }

    await Promise.all(pendingBatches)
    await this.pgiWorkerPool.shutdown()
    this.pgiStream.end()

    console.log()
    console.timeEnd('⏱️  Parsing PGN')
    console.log(`✅ ${this.processedGames.toLocaleString()} parties parsées`)
    console.log(`✅ ${this.totalPositions.toLocaleString()} positions traitées`)
  }

  async processPgiBatch(pgnLines, batchId) {
    const result = await this.pgiWorkerPool.execute({ pgnLines, batchId })

    for (const pos of result.positions) {
      this.pgiStream.write(`${pos.hashFen}\t${pos.fen}\t${pos.gameId}\t${pos.whiteElo}\t${pos.official}\t${pos.date}\n`)
    }

    this.processedGames += result.processedGames
    this.totalPositions += result.positions.length

    if (this.processedGames % 1000 === 0) {
      this.updateProgressLog(this.processedGames, this.totalGames, 'parties')
    }
  }

  async processFensFile() {
    console.log('\n🔄 Traitement du fichier Fens...')
    console.time('⏱️  Processing Fens')

    this.fensWorkerPool = new WorkerPool(join(__dirname, 'lib', 'regen-fens-worker.js'))
    const inputStream = fs.createReadStream(this.inputFensFile, { encoding: 'utf8' })
    const outputStream = fs.createWriteStream(this.outputFensFile)
    const rl = createInterface({ input: inputStream })

    let isFirstLine = true
    let lineCount = 0
    const batchLines = []
    const pendingBatches = []
    let batchId = 0

    for await (const line of rl) {
      if (isFirstLine) {
        outputStream.write(`hashFen\t${line}\n`)
        isFirstLine = false
        continue
      }

      batchLines.push(line)

      if (batchLines.length >= this.batchSize * 10) {
        const batch = [...batchLines]
        batchLines.length = 0

        const promise = this.processFensBatch(batch, batchId++, outputStream)
        pendingBatches.push(promise)

        if (pendingBatches.length >= 100) {
          const results = await Promise.race(pendingBatches.map(p => p.then(() => p)))
          lineCount += results.lineCount || 0
        }
      }
    }

    if (batchLines.length > 0) {
      const result = await this.processFensBatch(batchLines, batchId++, outputStream)
      lineCount += result.lineCount
    }

    const results = await Promise.all(pendingBatches)
    lineCount += results.reduce((sum, r) => sum + (r.lineCount || 0), 0)

    await this.fensWorkerPool.shutdown()
    outputStream.end()

    console.log()
    console.timeEnd('⏱️  Processing Fens')
    console.log(`✅ ${lineCount.toLocaleString()} lignes traitées`)
  }

  async processFensBatch(lines, batchId, outputStream) {
    const result = await this.fensWorkerPool.execute({ lines, batchId })

    for (const line of result.lines) {
      outputStream.write(line + '\n')
    }

    const lineCount = result.lines.length
    if (lineCount > 0 && lineCount % 100000 === 0) {
      process.stdout.write(`\r🔄 Fens: ${lineCount.toLocaleString()} lignes traitées`)
    }

    return { lineCount }
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

    console.log('\n\n🎯 GÉNÉRATION TSV V2 TERMINÉE')
    console.log('==============================')
    console.log(`⏱️  Temps total: ${totalElapsedStr}`)
    console.log(`🎯 Parties traitées: ${this.processedGames.toLocaleString()}`)
    console.log(`🔗 Liaisons game-positions: ${this.totalPositions.toLocaleString()}`)
    console.log(`✅ Fichiers générés:`)
    console.log(`   - ${this.outputPgiFile}`)
    console.log(`   - ${this.outputFensFile}`)
  }
}

const generator = new TSVGenerator()
generator.run().catch(console.error)
