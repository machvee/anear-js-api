"use strict"

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const CleanCSS = require('clean-css')

const logger = require('./Logger')

const computeContentHash = (content) => {
  return crypto.createHash('sha256').update(content).digest('hex')
}

const CssProcessing = async (cssDirPath, s3ImageAssetsUrl, s3FontAssetsUrl) => {
  try {
    // Read all .css files from the cssDirPath
    const cssFiles = fs.readdirSync(cssDirPath).filter(file => file.endsWith('.css'))

    let concatenatedCss = ''
    for (const file of cssFiles) {
      const filePath = path.join(cssDirPath, file)
      let cssContent = fs.readFileSync(filePath, 'utf8')

      cssContent = cssContent.replace(
        /url\(['"]?\.\.\/assets\/(images|fonts)\/(.*?)['"]?\)/g,
        (match, type, filename) => {
          const baseUrl = type === 'images' ? s3ImageAssetsUrl : s3FontAssetsUrl;
          return `url(${baseUrl}/${filename})`;
        }
      );

      concatenatedCss += cssContent
    }

    // Minify the compiled CSS
    const minifiedCssResult = new CleanCSS({}).minify(concatenatedCss)

    // Check for minification errors
    if (minifiedCssResult.errors && minifiedCssResult.errors.length > 0) {
      logger.error('CSS minification errors:', minifiedCssResult.errors)
      throw new Error('CSS minification failed')
    }

    const minifiedCss = minifiedCssResult.styles
    const fileSuffix = '.min.css'

    // Compute the content hash of the minified CSS content
    const contentHash = computeContentHash(minifiedCss)

    // Log the details
    logger.debug(`CSS minified to length ${minifiedCss.length}`)
    logger.debug(`Content hash of minified CSS: ${contentHash}`)

    // Return minified CSS, fileSuffix, and contentHash
    return {
      css: minifiedCss,
      fileSuffix,
      contentHash
    }
  } catch (error) {
    logger.error('Error compiling and minifying CSS:', error)
    return null
  }
}

module.exports = CssProcessing
