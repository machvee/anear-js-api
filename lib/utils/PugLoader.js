"use strict"

const fs = require("fs")
const path = require("path")
const pug = require("pug")

const C = require('../utils/Constants')

class PugLoader {
  constructor(rootDirPath) {
    this.rootDirPath = rootDirPath
    this.templates = {}
  }

  compiledPugTemplates() {
    this.walkDir(this.rootDirPath)
    return this.templates
  }

  walkDir(currentPath) {
    const files = fs.readdirSync(currentPath)

    for (const file of files) {
      const filePath = path.join(currentPath, file)
      const stat = fs.statSync(filePath)

      if (stat.isDirectory()) {
        this.walkDir(filePath); // Recursive call to process subdirectories
      } else if (stat.isFile() && path.extname(file) === C.PugSuffix) {
        const templatePath = path.relative(this.rootDirPath, filePath)
        this.templates[templatePath] = this.compilePugTemplateFromPath(filePath)
      }
    }
  }

  compilePugTemplateFromPath(filePath) {
    const pugContent = fs.readFileSync(filePath, 'utf8')

    return pug.compile(
      pugContent,
      {
        filename: filePath // Provide the absolute path of the file being compiled
      }
    )
  }
}

module.exports = PugLoader
