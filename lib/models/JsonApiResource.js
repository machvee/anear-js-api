"use strict"

const logger = require('../utils/Logger')
const Persist = require('../utils/Persist')

const Storage = new Persist()

class JsonApiResource {

  constructor(json) {
    this.data = json.data
    this.included = json.included || {}
    this._appData = json.appData || this.initAppData()
  }

  toJSON() {
    return {
      data: this.data,
      included: this.included,
      appData: this._appData,
    }
  }

  initAppData() {
    return {} // override in subclass if desired
  }

  set appData(data) {
    this._appData = data
  }

  get appData() {
    return this._appData
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

  static async getWithLockFromStorage(modelId, callback, ...args) {
    return await this.getJsonWithLockFor(
      modelId,
      async json => {
        if (!json) return null
        const model = new this(json, ...args)
        await model.onLoad()
        await callback(model)
        return model
      }
    )
  }

  static async getFromStorage(modelId, ...args) {
    const json = await this.getJsonFor(modelId)
    if (!json) return null
    const model = new this(json, ...args)
    await model.onLoad()
    return model
  }

  async persist() {
    logger.debug(`${this.id} persisted`)
    return await Storage.create(this)
  }

  async update() {
    logger.debug(`${this.id} updated`)
    return await Storage.update(this)
  }

  async exists() {
    return await Storage.exists(this)
  }

  async remove() {
    logger.debug(`${this.id} persistence removed`)
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

  async lock(callback) {
    await Storage.lockCall(this, callback)
  }

  static async getJsonWithLockFor(id, callback) {
    const key = this.persistKey(id)
    return await Storage.lockedFetch(key, callback)
  }
}

module.exports = JsonApiResource
