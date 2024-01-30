"use strict"

const fs = require('fs')
const path = require('path')
const CleanCSS = require('clean-css')

const logger = require('./Logger')

// Create an XState action to build and minify the CSS
const CssProcessing = async (cssDirPath, s3ImageAssetsUrl) => {
  try {
    // Read all .css files from the /css folder
    const cssFiles = fs.readdirSync(cssDirPath).filter(file => file.endsWith('.css'))

    let concatenatedCss = ''
    for (const file of cssFiles) {
      const filePath = path.join(cssDirPath, file)
      let cssContent = fs.readFileSync(filePath, 'utf8')
      if (s3ImageAssetsUrl) {
        cssContent = cssContent.replace(
          /url\(['"]?\.\.\/assets\/images\/(.*?)['"]?\)/g, 
          `url(${s3ImageAssetsUrl}$1)`
        )
      }
      concatenatedCss += cssContent
    }

    // Minify the compiled CSS
    const minifiedCss = new CleanCSS({}).minify(concatenatedCss).styles
    const fileSuffix = ".min.css"

    // return minified CSS to the caller
    logger.debug(`CSS minified to length ${minifiedCss.length}`)

    return {
      css: minifiedCss,
      fileSuffix
    }
  } catch (error) {
    logger.error('Error compiling and minifying CSS:', error)
    return null
  }
}


module.exports = CssProcessing
