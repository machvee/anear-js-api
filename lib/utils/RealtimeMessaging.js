"use strict"

const Ably = require('ably/promises')
const logger = require('../utils/Logger')

const DefaultChannelParams = {params: {rewind: "5s"}}
const DefaultHeartbeatIntervalMsecs = 15000
const NotableChannelEvents = ['attached', 'suspended', 'failed']
const NotablePresenceEvents = ['enter', 'leave', 'update']

class RealtimeMessaging {
  // Ably wrapper that handles client authentication with the Anear API server,
  // and turns connection events into XState events sent to the ConnectionMachine
  // This connection handles all ably traffic for the App and all of the instanitated
  // AnearEventMachines
  constructor(connectionMachine) {
    this.connectionMachine = connectionMachine
    this.ablyRealtime = null
  }

  initRealtime({ appId, anearApi }) {
    const clientOptions = this.ablyClientOptions(appId, anearApi)

    logger.debug("Ably Client Options", clientOptions)

    this.ablyRealtime = new Ably.Realtime.Promise(
      this.ablyClientOptions(appId, anearApi)
    )

    this.ablyRealtime.connection.on(
      stateChange => this.connectionMachine.send(stateChange.current.toUpperCase())
    )
    return this
  }

  getChannel(channelName, parentMachine, {channelParams = DefaultChannelParams, presencePrefix = null}) {
    logger.debug(`Creating channel ${channelName}`)

    const channel = this.ablyRealtime.channels.get(channelName, channelParams)
    this.enableCallbacks(channel, parentMachine, presencePrefix)
    return channel
  }

  enableCallbacks(channel, parentMachine, presencePrefix) {
    const stateChangeCallback = stateChange => {
      const channelState = stateChange.current
      logger.debug(`${channel.name} state changed to ${channelState}`)
      return parentMachine.send(channelState.toUpperCase())
    }

    channel.on(NotableChannelEvents, stateChangeCallback)

    if (presencePrefix) {
      const actionFunc = action => {
        channel.presence.subscribe(
          action,
          member => parentMachine.send(action.toUpperCase(), { member })
        )
      }
      NotablePresenceEvents.forEach(actionFunc)
    }
  }

  ablyClientOptions(appId, anearApi) {
    const baseUrl     = anearApi.api_base_url
    const authUrl     = `${baseUrl}/messaging_auth`
    const authHeaders = {
      ...anearApi.defaultHeaderObject
    }
    const authParams = {
      "app-id": appId
    }
    const AblyLogLevel = process.env.ANEARAPP_ABLY_LOG_LEVEL || 0
    const transportParams = this.transportParams()

    return {
      authUrl,
      authHeaders,
      authParams,
      transportParams,
      echoMessages: false,
      log: {
        level: AblyLogLevel,
        handler: message => {logger.debug(message)}
      }
    }
  }

  transportParams() {
    const heartbeatInterval = (
      process.env.ANEARAPP_API_HEARTBEAT_INTERVAL_SECONDS 
        ? process.env.ANEARAPP_API_HEARTBEAT_INTERVAL_SECONDS * 1000
        : DefaultHeartbeatIntervalMsecs
    )

    return {
      heartbeatInterval
    }
  }

  close() {
    this.ablyRealtime && this.ablyRealtime.close()
    this.ablyRealtime = null
  }
}

module.exports = RealtimeMessaging
