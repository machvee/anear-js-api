"use strict"

const fs = require("fs")
const path = require("path")
const pug = require("pug")

const PugSuffix = ".pug"
const DefaultTemplatesRootDir = "./views"

class PugLoader {
  constructor(dirPath = DefaultTemplatesRootDir) {
    this.dirPath = dirPath
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
      } else if (stat.isFile() && path.extname(file) === PugSuffix) {
        const templatePath = path.relative(this.dirPath, filePath)
        const compiledTemplate = pug.compileFile(filePath)
        this.templates[templatePath] = compiledTemplate
      }
    }
  }
}

module.exports = PugLoader
