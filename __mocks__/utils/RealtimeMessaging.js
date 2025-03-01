"use strict"

const logger = require('../../lib/utils/Logger')

class RealtimeMessaging {
  initRealtime(appId, appMachine) {
    return this
  }

  getChannel(channelName) {
    return {}
  }
}

const realtimeMessagingInstance = new RealtimeMessaging()

module.exports = realtimeMessagingInstance
