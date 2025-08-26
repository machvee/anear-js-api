"use strict"

const fetch = require('cross-fetch')
const CssProcessing = require('./CssProcessing')
const logger = require('./Logger') // Assuming you have a Logger module
const AnearApi = require('../api/AnearApi')
const fs = require('fs')

class CSSUploader {
  /**
   * Constructs a CSSUploader.
   * @param {string} cssDirPath - The directory path where CSS files are located.
   * @param {string} assetsBaseUrl - The base URL for image assets in the CSS.
   * @param {string} appId - The application ID.
   */
  constructor(cssDirPath, imageAssetsUrl, fontAssetsUrl, appId) {
    this.cssDirPath = cssDirPath
    this.imageAssetsUrl = imageAssetsUrl
    this.fontAssetsUrl = fontAssetsUrl
    this.appId = appId
    this.api = AnearApi
  }

  /**
   * Processes and uploads the CSS file.
   * @returns {Promise<string>} - The public URL of the uploaded CSS file.
   */
  async uploadCss() {
    if (!fs.existsSync(this.cssDirPath)) {
      logger.info(`No css directory found at ${this.cssDirPath}. Skipping CSS upload.`)
      return
    }

    try {
      const { css, fileSuffix, contentHash } = await CssProcessing(this.cssDirPath, this.imageAssetsUrl, this.fontAssetsUrl)

      const { 'presigned-url': presignedUrl, 'public-url': publicUrl } = await this.api.getAppCssUploadUrl(this.appId, contentHash, fileSuffix)

      if (presignedUrl) {
        await this.uploadToS3(presignedUrl, css, 'text/css')
        logger.debug('Uploaded CSS file to S3.')
      } else {
        logger.debug('CSS file is up to date; no upload necessary.')
      }

      // Step 4: Return the public URL of the uploaded CSS file
      return publicUrl
    } catch (error) {
      logger.error('Error uploading CSS file:', error)
      throw error // Re-throw the error for the caller to handle
    }
  }

  /**
   * Uploads content to S3 using a presigned URL.
   * @param {string} presignedUrl - The presigned URL for uploading to S3.
   * @param {string|Buffer} content - The content to upload.
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

module.exports = CSSUploader
