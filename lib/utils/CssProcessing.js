"use strict"

const fs = require('fs')
const path = require('path')
const CleanCSS = require('clean-css')

const logger = require('./Logger')

// Define the path to your /css folder
const cssFolderPath = path.join(__dirname, 'css')

// Create an XState action to build and minify the CSS
const CssProcessing = async s3ImageAssetsUrl => {
  try {
    // Read all .css files from the /css folder
    const cssFiles = fs.readdirSync(cssFolderPath).filter(file => file.endsWith('.css'))

    let concatenatedCSS = ''
    for (const file of cssFiles) {
      const filePath = path.join(cssFolderPath, file)
      const cssContent = fs.readFileSync(filePath, 'utf8')
      if (s3ImageAssetsUrl) {
        cssContent = cssContent.replace(
          /url\(['"]?\.\.\/assets\/images\/(.*?)['"]?\)/g, 
          `url(${s3ImageAssetsUrl}$1)`
        )
      }
      concatenatedCSS += cssContent
    }

    // Minify the compiled CSS
    const minifiedCSS = new CleanCSS({}).minify(concatenatedCSS).styles
    const fileSuffix = ".min.css"

    // return minified CSS to the caller
    return {
      css: minified,
      fileSuffix
    }
  } catch (error) {
    logger.error('Error compiling and minifying CSS:', error)
    return null
  }
}


module.exports = CssProcessing
