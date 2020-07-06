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
    return this.data[index].attributes
  }

  relationships(index) {
    return this.data[index].relationships
  }

  id(index) {
    return this.data[index].id
  }

  findIncluded(data) {
    return this.included.find(inc => {
      return inc.type === data.type && inc.id === data.id
    })
  }
}

module.exports = JsonApiArrayResource
