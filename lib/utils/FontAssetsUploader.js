"use strict"

const AnearApi = require('../api/AnearApi')
const AssetFileCollector = require('./AssetFileCollector')
const logger = require('./Logger')
const fs = require('fs').promises
const path = require('path')
const fetch = require('cross-fetch')

class FontAssetsUploader {
  constructor(fontsDirPath, appId) {
    this.fontsDirPath = fontsDirPath
    this.appId = appId
    this.api = AnearApi
  }

  async uploadAssets() {
    const collector = new AssetFileCollector(this.fontsDirPath)
    const filesToUpload = await collector.collectFiles()

    if (filesToUpload.length === 0) {
      logger.info("No font files to upload.")
      return null
    }

    try {
      const response = await this.api.getAppFontAssetsUploadUrls(this.appId, filesToUpload)
      const { "presigned-urls": presignedUrls = [], "assets-base-url": assetsBaseUrl, "up-to-date-files": upToDateFiles = [] } = response

      if (upToDateFiles && upToDateFiles.length > 0) {
        logger.debug(`These font files are up to date: ${upToDateFiles.join(', ')}`)
      }

      if (presignedUrls && presignedUrls.length > 0) {
        await Promise.all(presignedUrls.map(async (uploadInfo) => {
          const { path: relativePath, 'presigned-url': presignedUrl } = uploadInfo
          const fileData = filesToUpload.find(file => file.path === relativePath)

          if (fileData) {
            const fullFilePath = path.join(this.fontsDirPath, fileData.path)
            const fileContent = await fs.readFile(fullFilePath)
            await this.uploadToS3(presignedUrl, fileContent, fileData.content_type)
            logger.debug(`Uploaded font file ${fileData.path} to S3.`)
          } else {
            throw new Error(`File data not found for path: ${relativePath}`)
          }
        }))
      } else {
        logger.debug("No new or updated font files to upload.")
      }

      return assetsBaseUrl
    } catch (error) {
      logger.error("Error during font asset upload:", error)
      throw error
    }
  }

  async uploadToS3(presignedUrl, content, contentType) {
    const response = await fetch(presignedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: content,
    })

    if (!response.ok) {
      const responseBody = await response.text()
      throw new Error(`Failed to upload to S3: ${response.status} ${response.statusText} - ${responseBody}`)
    }
  }
}

module.exports = FontAssetsUploader
