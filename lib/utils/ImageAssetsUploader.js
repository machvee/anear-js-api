"use strict"

const fs = require('fs').promises
const path = require('path')
const AssetFileCollector = require('./AssetFileCollector')
const AnearApi = require('../api/AnearApi')
const fetch = require('cross-fetch')
const logger = require('./Logger')

class ImageAssetsUploader {
  /**
   * Constructs an ImageAssetsUploader.
   * @param {string} baseDir - The base directory where image assets are located.
   * @param {string} appId - The application ID.
   */
  constructor(baseDir, appId) {
    this.baseDir = baseDir
    this.appId = appId
  }

  /**
   * Uploads image assets to S3 using presigned URLs obtained from the server.
   * @returns {Promise<string>} - The assets base URL for use in CSS processing.
   */
  async uploadAssets() {
    try {
      // Step 1: Collect assets with AssetFileCollector
      const collector = new AssetFileCollector(this.baseDir)
      const filesData = await collector.collectFiles() // Array of files with path, content_hash, content_type

      // Log collected files
      logger.debug(`Collected ${filesData.length} asset files.`)

      // Step 2: Make the API call to server to get any presigned URLs
      const responseAttrs = await AnearApi.getAppImageAssetsUploadUrls(this.appId, filesData)

      // Destructure the response attributes
      const {
        'presigned-urls': presignedUrls = [],
        'up-to-date-files': upToDateFiles = [],
        'final-urls': finalUrls = [],
        'assets-base-url': assetsBaseUrl
      } = responseAttrs

      logger.debug('Received response from server:', responseAttrs)

      // Step 3: For each presigned URL, upload image file content to S3
      if (presignedUrls && presignedUrls.length > 0) {
        await Promise.all(presignedUrls.map(async (uploadInfo) => {
          const { path: filePath, 'presigned-url': presignedUrl } = uploadInfo

          // Find the file in filesData to get the full local path
          const fileData = filesData.find(file => file.path === filePath)
          if (fileData) {
            // Read the file content
            const fullFilePath = path.join(this.baseDir, fileData.path)
            const fileContent = await fs.readFile(fullFilePath)

            // Upload to S3 via presigned URL
            await this.uploadToS3(presignedUrl, fileContent, fileData.content_type)

            logger.debug(`Uploaded file ${fileData.path} to S3.`)
          } else {
            throw new Error(`File data not found for path: ${filePath}`)
          }
        }))
      } else {
        logger.debug('No files to upload; all files are up to date.')
      }

      // Step 4: Return the assets base URL for subsequent use in CSS processing
      return assetsBaseUrl
    } catch (error) {
      logger.error('Error uploading image assets:', error)
      throw error // Re-throw the error for the caller to handle
    }
  }

  /**
   * Uploads content to S3 using a presigned URL.
   * @param {string} presignedUrl - The presigned URL for uploading to S3.
   * @param {Buffer} content - The file content to upload.
   * @param {string} contentType - The MIME type of the content.
   */
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

module.exports = ImageAssetsUploader
