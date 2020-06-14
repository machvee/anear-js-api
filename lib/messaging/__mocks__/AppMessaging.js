"use strict"
const MockAnearApi = require('../../api/__mocks__/AnearApi')

class AppMessaging {
  constructor() {
    this.api = new MockAnearApi()
  }

  publishEventTransitionMessage(eventId, newState, callback) {
    return
  }
}

module.exports = AppMessaging
