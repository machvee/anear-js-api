"use strict"

class JsonApiArrayResource {

  constructor(json) {
    this.data = json.data // array of JSON API resources
    this.included = json.included // array of included data identified by :type and :id
  }

  toJSON() {
    return {
      data: this.data,
      included: this.included
    }
  }

  append(otherJsonArrayResource) {
    this.data = this.data.concat(otherJsonArrayResource.data),
    this.included = this.included.concat(otherJsonArrayResource.included)
  }

  attributes(index) {
    const d = this.data[index]
    return d ? d.attributes : null
  }

  relationships(index) {
    const d = this.data[index]
    return d ? d.relationships : null
  }

  id(index) {
    const d = this.data[index]
    return d ? d.id : null
  }

  find(id) {
    return this.data.find(d => d.id === id)
  }

  findAttributes(id) {
    const d = this.find(id)
    return d ? d.attributes : null
  }

  findIncluded(data) {
    return this.included.find(inc => {
      return inc.type === data.type && inc.id === data.id
    })
  }
}

module.exports = JsonApiArrayResource
