"use strict"

const Ably = require('ably/promises')
const logger = require('../utils/Logger')

const DefaultChannelParams = {params: {rewind: "5s"}}

class RealtimeMessaging {
  constructor(appMachine, anearApi) {
    this.appMachine = appMachine
    this.anearApi = anearApi
  }

  initRealtime() {
    this.realtime = new Ably.Realtime.Promise(this.ablyClientOptions())

    this.realtime.connection.on(
      stateChange => {
        this.appMachine.send({type: stateChange.current.toUpperCase()})
      }
    )
    return this
  }

  getChannel(name, channelParams = DefaultChannelParams) {
    return this.realtime.channels.get(name, channelParams)
  }

  ablyClientOptions() {
    const baseUrl     = this.anearApi.api_base_url
    const authUrl     = `${baseUrl}/messaging_auth`
    const authHeaders = {
      ...this.anearApi.defaultHeaderObject
    }
    const authParams = {
      "app-id": this.appMachine.context.appId
    }
    const AblyLogLevel = process.env.ANEARAPP_ABLY_LOG_LEVEL || 0
    const transportParams = this.ablyTransportParams()

    return {
      authUrl,
      authHeaders,
      authParams,
      transportParams: this.transportParams(),
      echoMessages: false,
      log: {
        level: AblyLogLevel,
        handler: message => {logger.debug(message)}
      }
    }
  }

  transportParams() {
    const heartBeatInterval = (
      process.env.ANEARAPP_API_HEARTBEAT_INTERVAL_SECONDS 
        ? process.env.ANEARAPP_API_HEARTBEAT_INTERVAL_SECONDS * 1000
        : DEFAULT_MESSAGING_IDLE_TIMEOUT_MSECS
    )

    return {
      heartbeatInterval
    }
  }
}

module.exports = RealtimeMessaging
