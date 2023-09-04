"use strict"

const logger = require('../../lib/utils/Logger')
const AnearAppData = require('../../tests/fixtures/AnearAppFixture')

class AnearApi {
  constructor(apiKey, apiVersion) {
    this.apiKey = apiKey
    this.apiVersion = apiVersion
  }

  getAccount() {
  }

  getApp() {
    return Promise.resolve(AnearAppData)
  }

  async transitionEvent(eventId, eventName='next') {
    return {state: "announce"}
  }

  getEventParticipant(participantId, geoLocation) {
    return Promise.resolve(new AnearParticipant({}, {}))
  }
}

module.exports = AnearApi
