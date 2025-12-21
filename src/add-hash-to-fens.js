#!/usr/bin/env node

import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import os from 'os'
import { Worker } from 'worker_threads'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

class HashFensGenerator {
  constructor() {
    this.inputFile = './src/output/fens-all.tsv'
    this.outputFile = './src/output/fens-all-v2.tsv'
    this.outputStream = null

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
    const stream = fs.createReadStream(this.inputFile, { encoding: 'utf8' })
    let buffer = ''

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        this.totalLines += lines.length
      })

      stream.on('end', () => {
        if (buffer.trim()) this.totalLines++
        console.log(`📊 ${this.totalLines.toLocaleString()} lignes à traiter`)
        resolve()
      })

      stream.on('error', reject)
    })
  }

  async processFensFile() {
    console.log('\n🔄 Traitement du fichier Fens avec workers...')
    console.time('⏱️  Hash FENs')

    this.outputStream = fs.createWriteStream(this.outputFile)

    const workers = []
    const workerStates = []
    const batchQueue = []
    let isStreamingComplete = false
    let activeTasks = 0
    let isFirstLine = true

    for (let i = 0; i < this.numWorkers; i++) {
      const worker = new Worker('./lib/hash-fens-worker.js')
      workers.push(worker)
      workerStates.push(true)

      worker.on('message', (message) => {
        activeTasks--
        workerStates[i] = true

        if (message.success) {
          for (const line of message.result.lines) {
            this.outputStream.write(line + '\n')
          }

          this.processedLines += message.result.lines.length
          this.updateProgressLog()
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
        lines: batch,
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
      this.outputStream.end()
      console.log()
      console.timeEnd('⏱️  Hash FENs')
      if (promiseResolve) promiseResolve()
    }

    const READ_CHUNK_SIZE = 1024 * 1024
    const stream = fs.createReadStream(this.inputFile, {
      encoding: 'utf8',
      highWaterMark: READ_CHUNK_SIZE
    })

    let buffer = ''
    let currentBatch = []
    let streamPaused = false

    stream.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (isFirstLine) {
          this.outputStream.write(`hashFen\t${line}\n`)
          isFirstLine = false
          continue
        }

        currentBatch.push(line)

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
    })

    stream.on('end', () => {
      if (buffer.trim()) {
        if (isFirstLine) {
          this.outputStream.write(`hashFen\t${buffer}\n`)
          isFirstLine = false
        } else {
          currentBatch.push(buffer)
        }
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
