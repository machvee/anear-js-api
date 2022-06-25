"use strict"
const MockAnearApi = require('../../api/__mocks__/AnearApi')

class AnearMessaging {
  constructor() {
    this.api = new MockAnearApi()
  }

  async getParticipants(eventId) {
    return []
  }

  async publishEventTransitionMessage(eventId, newState, callback) {
    return
  }

  resetAllParticipantTimers() {
    return
  }
}

module.exports = AnearMessaging
