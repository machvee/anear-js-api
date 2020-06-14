"use strict"
const MockAnearApi = require('../../lib/__mocks__/AnearApi')

class AppMessaging {
  constructor() {
    this.api = new MockAnearApi()
  }

  publishEventTransitionMessage(eventId, newState, callback) {
  }
}

module.exports = AppMessaging
