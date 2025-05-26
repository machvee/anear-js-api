"use strict"

class JsonApiResource {

  constructor(json) {
    this.data = json.data
    this.included = json.included || {}
    this.context = json.context || this.initContext()
  }

  toJSON() {
    return {
      data: this.data,
      included: this.included,
      context: this.context
    }
  }

  initContext() {
    // context can be used as subclass context, or it can become the XState context
    return null // override in subclass if desired
  }

  get attributes() {
    return this.data.attributes
  }

  get relationships() {
    return this.data.relationships
  }

  get id() {
    return this.data.id
  }

  static className() {
    //subclass name
    return this.toString().split ('(' || /s+/)[0].split (' ' || /s+/)[1]
  }

  findIncluded (resourceIdentifier) {
    const data = resourceIdentifier.data
    return this.included.find(inc => {
      return inc.type === data.type && inc.id === data.id
    })
  }
}

module.exports = JsonApiResource
