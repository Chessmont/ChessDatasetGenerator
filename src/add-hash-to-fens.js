#!/usr/bin/env node

import fs from 'fs'
import { createInterface } from 'readline'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import os from 'os'
import WorkerPool from './lib/worker-pool.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

class HashFensGenerator {
  constructor() {
    this.inputFile = './src/output/fens-all.tsv'
    this.outputFile = './src/output/fens-all-v2.tsv'
    this.outputStream = null
    this.workerPool = null

    this.numWorkers = os.cpus().length
    this.batchSize = 1000
    this.maxQueueSize = this.numWorkers * 4

    this.processedLines = 0
    this.totalLines = 0
    this.startTime = null
    this.lastLogTime = 0
  }

  async run() {
    console.log('🚀 HASH FENS GENERATOR - Workers parallèles')
    console.log('============================================')
    console.log(`📁 Input: ${this.inputFile}`)
    console.log(`📊 Output: ${this.outputFile}`)
    console.log(`🧵 Workers: ${this.numWorkers}`)
    console.log(`📦 Batch size: ${this.batchSize}`)
    console.log(`🚦 Max queue size: ${this.maxQueueSize}\n`)

    this.startTime = Date.now()

    try {
      await this.validateInputFiles()
      await this.processFensFile()
      await this.printFinalStats()
    } catch (error) {
      console.error('❌ Erreur lors de la génération:', error)
      throw error
    }
  }

  async validateInputFiles() {
    if (!fs.existsSync(this.inputFile)) {
      throw new Error(`Fichier manquant: ${this.inputFile}`)
    }
    console.log('✅ Fichier trouvé')
    
    console.log('📊 Comptage des lignes...')
    const rl = createInterface({ input: fs.createReadStream(this.inputFile, { encoding: 'utf8' }) })
    for await (const line of rl) {
      this.totalLines++
    }
    console.log(`📊 ${this.totalLines.toLocaleString()} lignes à traiter`)
  }

  async processFensFile() {
    console.log('\n🔄 Traitement du fichier Fens avec workers...')
    console.time('⏱️  Hash FENs')

    this.workerPool = new WorkerPool(join(__dirname, 'lib', 'hash-fens-worker.js'))
    const inputStream = fs.createReadStream(this.inputFile, {
      encoding: 'utf8',
      highWaterMark: 1024 * 1024
    })
    this.outputStream = fs.createWriteStream(this.outputFile)
    const rl = createInterface({ input: inputStream })

    let isFirstLine = true
    const batchLines = []
    const pendingBatches = []
    let batchId = 0
    let streamPaused = false

    const processNextBatch = async (batch) => {
      const result = await this.workerPool.execute({ lines: batch.lines, batchId: batch.id })

      for (const line of result.lines) {
        this.outputStream.write(line + '\n')
      }

      this.processedLines += batch.lines.length

      this.updateProgressLog()
    }

    for await (const line of rl) {
      if (isFirstLine) {
        this.outputStream.write(`hashFen\t${line}\n`)
        isFirstLine = false
        continue
      }

      batchLines.push(line)

      if (batchLines.length >= this.batchSize) {
        const batch = { id: batchId++, lines: [...batchLines] }
        batchLines.length = 0

        const promise = processNextBatch(batch)
        pendingBatches.push(promise)

        if (pendingBatches.length >= this.maxQueueSize) {
          if (!streamPaused) {
            streamPaused = true
            inputStream.pause()
          }
          await Promise.race(pendingBatches.map(p => p.then(() => p)))
        }

        if (streamPaused && pendingBatches.length < this.maxQueueSize / 2) {
          streamPaused = false
          inputStream.resume()
        }
      }
    }

    if (batchLines.length > 0) {
      pendingBatches.push(processNextBatch({ id: batchId++, lines: batchLines }))
    }

    await Promise.all(pendingBatches)
    await this.workerPool.shutdown()
    this.outputStream.end()

    console.log()
    console.timeEnd('⏱️  Hash FENs')
  }

  updateProgressLog() {
    const now = Date.now()

    if (now - this.lastLogTime < 500) return
    this.lastLogTime = now

    const percentage = this.totalLines > 0 ? ((this.processedLines / this.totalLines) * 100).toFixed(1) : '0.0'
    const elapsed = (now - this.startTime) / 1000
    const avgTime = elapsed / this.processedLines
    const remaining = this.totalLines - this.processedLines
    const eta = avgTime * remaining

    const elapsedStr = this.formatTime(elapsed)
    const etaStr = this.formatTime(eta)

    process.stdout.write(`\r📝 Hash: ${this.processedLines.toLocaleString()}/${this.totalLines.toLocaleString()} (${percentage}%) - ⏱️ ${elapsedStr} / ETA ${etaStr}`)
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
    const totalElapsed = (Date.now() - this.startTime) / 1000
    const totalElapsedStr = this.formatTime(totalElapsed)

    console.log('\n\n🎯 GÉNÉRATION HASH FENS TERMINÉE')
    console.log('=================================')
    console.log(`⏱️  Temps total: ${totalElapsedStr}`)
    console.log(`📝 Lignes traitées: ${this.processedLines.toLocaleString()}`)
    console.log(`✅ Fichier généré: ${this.outputFile}`)
  }
}

const generator = new HashFensGenerator()
generator.run().catch(console.error)
