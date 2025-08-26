"use strict";

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class AssetFileCollector {
  constructor(baseDir) {
    this.baseDir = baseDir;
    // Define common image MIME types
    this.mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.tiff': 'image/tiff',
      '.ico': 'image/x-icon',
      '.ttf': 'font/ttf',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
    };
  }

  async collectFiles() {
    const filesData = [];
    await this.walkDirectory(this.baseDir, filesData);
    return filesData;
  }

  async walkDirectory(dir, filesData) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue; // Skip dotfiles and dot-directories like .DS_Store
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Recursively walk through subdirectories
        await this.walkDirectory(fullPath, filesData);
      } else if (entry.isFile()) {
        const relativePath = path.relative(this.baseDir, fullPath).replace(/\\/g, '/'); // Ensure forward slashes
        const contentHash = await this.computeFileHash(fullPath);
        const contentType = this.getContentType(fullPath);
        filesData.push({
          path: relativePath,
          content_hash: contentHash,
          content_type: contentType,
        });
      }
    }
  }

  async computeFileHash(filePath) {
    const fileBuffer = await fs.readFile(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
  }

  getContentType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.mimeTypes[ext] || 'application/octet-stream';
  }
}

module.exports = AssetFileCollector
