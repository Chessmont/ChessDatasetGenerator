import { writeFile, readFile, unlink } from 'fs/promises'
import { mkdir, access } from 'fs/promises'
import { existsSync } from 'fs'
import https from 'https'
import path from 'path'
import { Chess } from 'chess.js'


const remoteFiles = ['a', 'b', 'c', 'd', 'e']
const remoteBaseURL = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master/'

const localFolder = './temp'
const customOpeningsFile = './customOpenings.tsv'
const outputFile = './openings.tsv'

const downloadFileOnce = (url, dest) =>
  new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error(`Échec téléchargement ${url} - Status: ${res.statusCode}`))
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', async () => {
        await writeFile(dest, data)
        resolve()
      })
    }).on('error', reject)
  })

const downloadFile = async (url, dest, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      await downloadFileOnce(url, dest)
      return
    } catch (err) {
      if (i === retries - 1) throw err
      console.log(`⚠️ Tentative ${i + 1} échouée pour ${url}, retry...`)
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}

const ensureFolder = async folderPath => {
  if (!existsSync(folderPath)) await mkdir(folderPath, { recursive: true })
}

const processFilesWithFen = filesContent => {
  const positions = new Map()
  const header = 'eco\tname\tpgn\tfen\tply'

  for (const lines of filesContent) {
    for (let index = 0; index < lines.length; index++) {
      if (index === 0 && lines[index].startsWith('eco')) continue
      const [eco, name, fullPgn] = lines[index].split('\t')
      if (!eco || !name || !fullPgn?.trim()) {
        console.warn(`⚠️ Ligne invalide ignorée: ${lines[index]}`)
        continue
      }

      const chess = new Chess()
      const sans = fullPgn.trim().split(' ').filter(x => !x.includes('.'))
      const playedSans = []

      let fenToOfficial = null

      for (let i = 0; i < sans.length; i++) {
        const san = sans[i]
        try {
          chess.move(san)
          playedSans.push(san)
          const fullFen = chess.fen().trim()
          const ply = i + 1
          const partialPgn = playedSans
            .map((s, j) => (j % 2 === 0 ? `${Math.floor(j / 2) + 1}. ${s}` : s))
            .join(' ')

          if (!positions.has(fullFen)) {
            positions.set(fullFen, {
              eco,
              name,
              pgn: partialPgn,
              fen: fullFen,
              ply,
              isOfficial: false
            })
          }
          if (i === sans.length - 1) {
            fenToOfficial = fullFen
          }
        } catch {
          break
        }
      }

      if (fenToOfficial) {
        const ply = sans.length
        const partialPgn = playedSans
          .map((s, j) => (j % 2 === 0 ? `${Math.floor(j / 2) + 1}. ${s}` : s))
          .join(' ')
        positions.set(fenToOfficial, {
          eco,
          name,
          pgn: partialPgn,
          fen: fenToOfficial,
          ply,
          isOfficial: true
        })
      }
    }
  }

  const output = [header]
  for (const { eco, name, pgn, fen, ply } of positions.values()) {
    output.push(`${eco}\t${name}\t${pgn}\t${fen}\t${ply}`)
  }
  return output
}

const main = async () => {
  await ensureFolder(localFolder)
  await ensureFolder(path.dirname(outputFile))

  console.log('📥 Téléchargement des fichiers de Lichess...')
  for (const letter of remoteFiles) {
    const url = `${remoteBaseURL}${letter}.tsv`
    const dest = path.join(localFolder, `${letter}.tsv`)
    await downloadFile(url, dest)
    console.log(`✅ ${letter}.tsv téléchargé`)
  }

  console.log('🛠️ Lecture et fusion avec FEN...')
  const filesContent = []

  for (const file of remoteFiles) {
    const filePath = path.join(localFolder, `${file}.tsv`)
    try {
      await access(filePath)
      const content = await readFile(filePath, 'utf8')
      const lines = content.trim().split('\n')
      if (lines.length === 0) continue
      filesContent.push(lines)
    } catch (e) {
      console.warn(`⚠️  Fichier manquant (ignoré) : ${file}.tsv`)
    }
  }

  try {
    await access(customOpeningsFile)
    const content = await readFile(customOpeningsFile, 'utf8')
    const lines = content.trim().split('\n')
    if (lines.length > 0) {
      filesContent.push(lines)
    }
  } catch (e) {
    console.warn(`⚠️  Fichier customOpenings.tsv manquant (ignoré)`)
  }

  const allContent = processFilesWithFen(filesContent).join('\n') + '\n'

  await writeFile(outputFile, allContent)
  console.log(`🎉 Fichier ${outputFile} généré avec succès avec FEN !`)

  for (const file of remoteFiles) {
    const filePath = path.join(localFolder, `${file}.tsv`)
    try {
      await access(filePath)
      await unlink(filePath)
    } catch (e) {
    }
  }
}

main().catch(err => {
  console.error('❌ Erreur :', err)
})
