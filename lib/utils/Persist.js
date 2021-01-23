"use strict"

const redis = require('async-redis')
const AsyncLock = require('async-lock')
const logger = require('./Logger')

const lock = new AsyncLock()

class Persist {

  constructor(options={}) {
    this.init(options)
  }

  init(options={}) {
    this.client = redis.createClient()
    this.client.on("error", function (err) {
      logger.error("Error " + err);
    });
    this.client.on('connect', () => {
      logger.info('Redis client connected');
    });
  }

  async close() {
    await this.client.quit()
  }

  async store(model) {
    const jsonString = JSON.stringify(model.toJSON())
    return await this.client.set(model.key, jsonString)
  }

  async fetch(key) {
    const model = await this.client.get(key)
    return JSON.parse(model)
  }

  async exists(model) {
    const result = await this.client.exists(model.key)
    logger.debug(`exists(${model.key}) == ${result == 1}`)
    return result == 1
  }

  async create(model) {
    const alreadyPersisted = await this.exists(model)

    if (alreadyPersisted) {
      throw new Error(`model ${model.id} already exists`)
    }
    return await this.store(model)
  }

  async update(model) {
    return await this.store(model)
  }

  async remove(model) {
    return await this.client.del(model.key)
  }

  async lockCall(model, callback) {
    return await lock.acquire(
      model.key,
      async () => {
        await callback(model)
      }
    )
  }

  async lockedFetch(key, callback) {
    return await lock.acquire(key,
      async () => {
        const modelJson = await this.fetch(key)
        if (callback) await callback(modelJson)
        return modelJson
      }
    )
  }
}

module.exports = Persist
