"use strict"

class JsonApiArrayResource {

  constructor(json_data, json_included={}) {
    this.data = json_data // array of JSON API resources
    this.included = json_included // array of included data identified by :type and :id
  }

  toJSON() {
    return {
      data: this.data,
      included: this.included
    }
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

  findIncluded (resourceIdentifier) {
    const data = resourceIdentifier.data
    return this.included.find(inc => {
      return inc.type === data.type && inc.id === data.id
    })
  }
}

module.exports = JsonApiArrayResource
