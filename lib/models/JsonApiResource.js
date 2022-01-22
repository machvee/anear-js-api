"use strict"

const Persist = require('../utils/Persist')

const Storage = new Persist()

class JsonApiResource {

  constructor(json) {
    this.data = json.data
    this.included = json.included || {}
    this._context = json.context || this.initContext()
  }

  toJSON() {
    return {
      data: this.data,
      included: this.included,
      context: this._context,
    }
  }

  initContext() {
    return {} // override in subclass if desired
  }

  set context(data) {
    this._context = data
  }

  get context() {
    return this._context
  }

  async onLoad() {
    return // called each time the event is loaded from Storage
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

  static async getFromStorage(modelId, ...args) {
    const json = await this.getJsonFor(modelId)
    if (!json) return null
    const model = new this(json, ...args)
    await model.onLoad()
    return model
  }

  async persist() {
    return await Storage.create(this)
  }

  async update() {
    return await Storage.update(this)
  }

  async exists() {
    return await Storage.exists(this)
  }

  async remove() {
    return await Storage.remove(this)
  }

  static async close() {
    await Storage.close()
  }

  static persistKey(id) {
    return `${this.className()}:${id}`
  }

  get key() {
    return this.constructor.persistKey(this.id)
  }

  static async getJsonFor(id) {
    const key = this.persistKey(id)
    return await Storage.fetch(key)
  }
}

module.exports = JsonApiResource
