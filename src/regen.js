#!/usr/bin/env node

import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import os from 'os'
import { Worker } from 'worker_threads'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

class TSVGenerator {
  constructor() {
    this.pgnFile = './src/output/chessmont.pgn'
    this.outputPgiFile = './src/output/all-pgi-v2.tsv'

    this.pgiStream = null
    this.processedGames = 0
    this.totalGames = 21521235
    this.totalPositions = 0
    this.startTime = null
    this.lastLogTime = 0

    this.numWorkers = os.cpus().length
    this.batchSize = 16
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

    this.pgiStream = fs.createWriteStream(this.outputPgiFile)
    this.pgiStream.write('hashFen\tfen\tgameId\twhiteElo\tofficial\tdate\n')

    const workers = []
    const workerStates = []
    const batchQueue = []
    let isStreamingComplete = false
    let activeTasks = 0

    for (let i = 0; i < this.numWorkers; i++) {
      const worker = new Worker('./src/lib/regen-pgi-worker.js')
      workers.push(worker)
      workerStates.push(true)

      worker.on('message', (message) => {
        activeTasks--
        workerStates[i] = true

        if (message.success) {
          for (const pos of message.result.positions) {
            this.pgiStream.write(`${pos.hashFen}\t${pos.fen}\t${pos.gameId}\t${pos.whiteElo}\t${pos.official}\t${pos.date}\n`)
          }

          this.processedGames += message.result.processedGames
          this.totalPositions += message.result.positions.length
          this.updateProgressLog(this.processedGames, this.totalGames, 'parties')
        } else {
          console.error(`\nWorker ${i} error:`, message.error)
        }

        processNextBatch()
      })

      worker.on('error', (error) => {
        activeTasks--
        workerStates[i] = true
        console.error(`\nWorker ${i} crashed:`, error)
        processNextBatch()
      })
    }

    const processNextBatch = () => {
      const availableWorkerIndex = workerStates.findIndex(state => state === true)

      if (availableWorkerIndex === -1 || batchQueue.length === 0) {
        if (isStreamingComplete && activeTasks === 0 && batchQueue.length === 0) {
          finishProcessing()
        }
        return
      }

      const batch = batchQueue.shift()
      const worker = workers[availableWorkerIndex]

      workerStates[availableWorkerIndex] = false
      activeTasks++

      worker.postMessage({
        games: batch,
        batchId: Math.random().toString(36)
      })

      if (streamPaused && batchQueue.length < this.maxQueueSize / 2) {
        streamPaused = false
        stream.resume()
      }
    }

    let promiseResolve = null

    const finishProcessing = () => {
      workers.forEach(worker => worker.terminate())
      this.pgiStream.end()
      console.log()
      console.timeEnd('⏱️  Parsing PGN')
      console.log(`✅ ${this.processedGames.toLocaleString()} parties parsées`)
      console.log(`✅ ${this.totalPositions.toLocaleString()} positions traitées`)
      if (promiseResolve) promiseResolve()
    }

    const READ_CHUNK_SIZE = 1024 * 1024
    const stream = fs.createReadStream(this.pgnFile, {
      encoding: 'utf8',
      highWaterMark: READ_CHUNK_SIZE
    })

    let buffer = ''
    let currentGame = ''
    let inGame = false
    let currentBatch = []
    let streamPaused = false

    stream.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('[ID ')) {
          if (inGame && currentGame.trim()) {
            currentBatch.push(currentGame)

            if (currentBatch.length >= this.batchSize) {
              batchQueue.push([...currentBatch])
              currentBatch = []

              if (!streamPaused && batchQueue.length >= this.maxQueueSize) {
                streamPaused = true
                stream.pause()
              }

              processNextBatch()
            }
          }

          currentGame = line + '\n'
          inGame = true
        } else {
          currentGame += line + '\n'
        }
      }
    })

    stream.on('end', () => {
      if (buffer.trim()) {
        const line = buffer.trim()
        if (line.startsWith('[ID ')) {
          if (inGame && currentGame.trim()) {
            currentBatch.push(currentGame)
          }
          currentGame = line + '\n'
          inGame = true
        } else {
          currentGame += line + '\n'
        }
      }

      if (inGame && currentGame.trim()) {
        currentBatch.push(currentGame)
      }

      if (currentBatch.length > 0) {
        batchQueue.push(currentBatch)
      }

      isStreamingComplete = true
      processNextBatch()
    })

    stream.on('error', (error) => {
      console.error('❌ Erreur de lecture du fichier:', error)
      workers.forEach(worker => worker.terminate())
      throw error
    })

    return new Promise((resolve, reject) => {
      promiseResolve = resolve
      stream.on('error', reject)
    })
  }

  updateProgressLog(processed, total, type) {
    const now = Date.now()

    if (now - this.lastLogTime < 500) return
    this.lastLogTime = now

    const percentage = total > 0 ? ((processed / total) * 100).toFixed(1) : '0.0'
    const elapsed = (now - this.startTime) / 1000
    const avgTime = elapsed / processed
    const remaining = total - processed
    const eta = avgTime * remaining

    const elapsedStr = this.formatTime(elapsed)
    const etaStr = this.formatTime(eta)

    process.stdout.write(`\r🔄 ${type}: ${processed.toLocaleString()}/${total.toLocaleString()} (${percentage}%) - ${this.totalPositions.toLocaleString()} positions - ⏱️ ${elapsedStr} / ETA ${etaStr}`)
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
