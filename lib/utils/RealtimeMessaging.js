"use strict"

const Ably = require('ably/promises')
const logger = require('../utils/Logger')

const ChannelRewindSeconds = 5

const DefaultChannelParams = {params: {rewind: `${ChannelRewindSeconds}s`}}
const DefaultHeartbeatIntervalMsecs = 15000
const NotableChannelEvents = ['attached', 'suspended', 'failed']
const AllPresenceEvents = ['enter', 'leave', 'update']

class RealtimeMessaging {
  // Ably wrapper that handles client authentication with the Anear API server,
  // and turns connection events into XState events sent to the ConnectionMachine
  // This connection handles all ably traffic for the App and all of the instanitated
  // AnearEventMachines
  constructor(appId, anearApi) {
    this.appId = appId
    this.anearApi = anearApi
    this.ablyRealtime = null
  }

  initRealtime(machineRef) {
    const clientOptions = this.ablyClientOptions()

    logger.debug("Ably Client Options", clientOptions)

    this.ablyRealtime = new Ably.Realtime.Promise(clientOptions)

    this.ablyRealtime.connection.on(
      stateChange => machineRef.send(stateChange.current.toUpperCase())
    )
    return this
  }

  getChannel(channelName, machineRef, {channelParams = DefaultChannelParams, presencePrefix = null, presenceEvents = AllPresenceEvents} = {}) {
    logger.debug(`Creating channel ${channelName}`)

    const channel = this.ablyRealtime.channels.get(channelName, channelParams)
    this.enableCallbacks(channel, machineRef, presencePrefix, presenceEvents)
    return channel
  }

  enableCallbacks(channel, machineRef, presencePrefix, presenceEvents) {
    const stateChangeCallback = stateChange => {
      const channelState = stateChange.current
      logger.debug(`${channel.name} state changed to ${channelState}`)
      return machineRef.send(channelState.toUpperCase())
    }

    channel.on(NotableChannelEvents, stateChangeCallback)

    if (presencePrefix) {
      const presenceActionFunc = action => {
        const eventName = `${presencePrefix}_${action.toUpperCase()}`
        channel.presence.subscribe(
          action,
          member => machineRef.send(eventName, { member })
        )
      }
      presenceEvents.forEach(presenceActionFunc)
    }
  }

  ablyClientOptions() {
    const baseUrl     = this.anearApi.api_base_url
    const authUrl     = `${baseUrl}/messaging_auth`
    const authHeaders = {
      ...this.anearApi.defaultHeaderObject
    }
    const authParams = {
      "app-id": this.appId
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

  detachAll(channels) {
    const detachPromises = channels.map(channel => channel.detach())
    try {
      return Promise.all(detachPromises)
    } catch(error) {
      logger.error("Error detaching channels: ", error)
    }
  }

  close() {
    this.ablyRealtime && this.ablyRealtime.close()
    this.ablyRealtime = null
  }
}

module.exports = RealtimeMessaging
