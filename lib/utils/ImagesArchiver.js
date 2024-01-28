"use strict"

const archiver = require('archiver')
const { PassThrough } = require('stream')

class ImagesArchiver {
  constructor(imagesDirPath) {
    this.imagesDirPath = imagesDirPath
  }

  createTarball() {
    return new Promise((resolve, reject) => {
      const archiveSettings = {
        gzip: true,
        zlib: { level: 9 } // Compression level
      }

      if (!fs.existsSync(this.imagesDirPath) || fs.readdirSync(this.imagesDirPath).length === 0) {
        resolve(null) // Resolve to null if no files are found or directory doesn't exist
        return
      }
      
      const archive = archiver('tar', archiveSettings)
      const bufferStream = new PassThrough()
      let data = Buffer.alloc(0)

      bufferStream.on('data', chunk => {
        data = Buffer.concat([data, chunk])
      })

      archive.on('error', reject)

      archive.on('end', () => {
        const base64EncodedData = data.toString('base64')
        resolve(base64EncodedData)
      })

      archive.pipe(bufferStream)
      archive.directory(this.imagesDirPath, false)
      archive.finalize()
    })
  }
}

module.exports = ImagesArchiver

