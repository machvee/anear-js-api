"use strict"

const fs = require("fs")
const path = require("path")
const pug = require("pug")
const C = require('../utils/Constants')

const DefaultTemplatesRootDir = "./views"
const ImagePathRegex = /src=['"]\.\.\/assets\/images\/(.*?)['"]/g

class PugLoader {
  constructor(s3ImageAssetsUrl, dirPath = DefaultTemplatesRootDir) {
    this.dirPath = dirPath
    this.s3ImageAssetsUrl = s3ImageAssetsUrl
    this.templates = {}
  }

  compiledPugTemplates() {
    this.walkDir(this.dirPath)
    return this.templates
  }

  walkDir(currentPath) {
    const files = fs.readdirSync(currentPath)

    for (const file of files) {
      const filePath = path.join(currentPath, file)
      const stat = fs.statSync(filePath)

      if (stat.isDirectory()) {
        this.walkDir(filePath) // Use "this" to refer to the method.
      } else if (stat.isFile() && path.extname(file) === C.PugSuffix) {
        const templatePath = path.relative(this.dirPath, filePath)
        let pugContent = fs.readFileSync(filePath, 'utf8')

        // Replace relative image paths with the S3 URL
        if (this.s3ImageAssetsUrl) {
          pugContent = pugContent.replace(ImagePathRegex, `src='${this.s3ImageAssetsUrl}$1'`)
        }
        
        const compiledTemplate = pug.compile(pugContent)
        this.templates[templatePath] = compiledTemplate
      }
    }
  }
}

module.exports = PugLoader
