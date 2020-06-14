"use strict"
const JsonApiResource = require('./JsonApiResource')

class AnearZone extends JsonApiResource {

  constructor(json) {
    super(json)
    this.app = this.findIncluded(this.relationships['app'])
  }
}

module.exports = AnearZone
