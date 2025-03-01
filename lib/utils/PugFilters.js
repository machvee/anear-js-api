"use strict"

const PugFilters = s3ImageAssetsUrl => ({
  'cdn-img': text => `${s3ImageAssetsUrl}${text.trim()}`,
  'action': text => {
    try {
      const parsed = JSON.parse(text.trim())
      return JSON.stringify(parsed)
    } catch (error) {
      throw new Error(`Invalid JSON for click-action: ${text}`)
    }
  }
})

module.exports = PugFilters
