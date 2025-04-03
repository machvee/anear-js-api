"use strict"

const PugHelpers = s3ImageAssetsUrl => ({
  cdnImg: filename => `${s3ImageAssetsUrl}/${filename.trim()}`,
  action: payload => {
    try {
      return JSON.stringify(payload)
    } catch (error) {
      throw new Error("Invalid JSON for data-click-action:", payload)
    }
  }
})

module.exports = PugHelpers
