"use strict"
const MockAnearApi = require('../../api/__mocks__/AnearApi')

class AnearMessaging {
  constructor() {
    this.api = new MockAnearApi()
  }

  publishEventTransitionMessage(eventId, newState, callback) {
    return
  }
}

module.exports = AnearMessaging
