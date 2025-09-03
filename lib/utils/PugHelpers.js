"use strict"

const PugHelpers = s3ImageAssetsUrl => ({
  cdnImg: filename => `${s3ImageAssetsUrl}/${filename.trim()}`,
  action: payload => {
    let finalPayload;
    if (typeof payload === 'string') {
      // If a simple string is passed, treat it as the event name with an empty payload.
      finalPayload = { [payload]: {} };
    } else if (typeof payload === 'object' && payload !== null) {
      // If an object is passed, use it as is.
      finalPayload = payload;
    } else {
      throw new Error("Invalid payload for action(): must be a string or an object.");
    }

    try {
      return JSON.stringify(finalPayload);
    } catch (error) {
      throw new Error("Invalid JSON for data-click-action:", finalPayload);
    }
  }
})

module.exports = PugHelpers
