"use strict"
class ErrorResponse {

  constructor(json) {
    this.json_errors = json.errors[0]
    this.error = json.errors[0]
    this.hasSource = this.error.hasOwnProperty('source')
    this.source = this.hasSource ? this.getSource() : null
    this.message = this.formatMessage()
  }

  getSource () {
    const [attrName] = this.error.source.pointer.split("/").slice(-1)
    return attrName
  }

  formatMessage () {
    return this.hasSource ? `${this.source} ${this.error.detail}` : this.error.detail
  }
}

module.exports = ErrorResponse
