"use strict"

const Ably = require('ably/promises')
const logger = require('../utils/Logger')
const AnearApi = require ('../api/AnearApi')
const C = require('../utils/Constants')

const ChannelRewindSeconds = 5

const DefaultChannelParams = {params: {rewind: `${ChannelRewindSeconds}s`}}
const DefaultHeartbeatIntervalMsecs = 15000
const NotableChannelEvents = ['attached', 'suspended', 'failed']

class RealtimeMessaging {
  // Ably wrapper that handles client authentication with the Anear API server,
  // and turns connection events into XState events sent to the ConnectionMachine
  // This connection handles all ably traffic for the App and all of the instanitated
  // AnearEventMachines
  constructor(appId) {
    this.appId = appId
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

  getChannel(channelName, machineRef, {channelParams = DefaultChannelParams} = {}) {
    logger.debug(`Creating channel ${channelName}`)

    const channel = this.ablyRealtime.channels.get(channelName, channelParams)
    this.enableCallbacks(channel, machineRef)

    return channel
  }

  enableCallbacks(channel, machineRef) {
    const stateChangeCallback = stateChange => {
      const channelState = stateChange.current.toUpperCase()
      logger.debug(`sending machine event: ${channel.name} state changed to ${channelState}`)
      return machineRef.send(channelState)
    }

    logger.debug(`enabling ${NotableChannelEvents} on ${channel.name}`)

    channel.on(NotableChannelEvents, stateChangeCallback)
  }

  enablePresenceCallbacks(channel, machineRef, presencePrefix, presenceEvents = C.ParticipantPresenceEvents) {
    const presenceActionFunc = action => {
      const eventName = `${presencePrefix}_${action.toUpperCase()}`

      logger.debug(`${channel.name} subscribing to ${eventName}`)

      channel.presence.subscribe(
        action,
        member => {
          logger.debug(`sending machine event: rcvd ${eventName} from ${member.id} on ${channel.name}`)
          machineRef.send(eventName, { member })
        }
      )
    }
    presenceEvents.forEach(presenceActionFunc)
  }

  async getAndNotifyPresenceOnChannel(channel, machineRef, presencePrefix) {
    const members = await channel.presence.get()

    const action = 'enter'
    const eventName = `${presencePrefix}_${action.toUpperCase()}`

    logger.debug(`presence.get() on ${eventName} returns ${members.length} member(s)`)

    members.forEach(
      member => {
        logger.debug(`sending machine event: ${action} from ${member.id} on ${channel.name}`)
        machineRef.send(eventName, { data: member.data })
      }
    )
  }

  async attachTo(channel) {
    // explicitly attach() to a channel, and if it was unattached,
    // it will trigger the ATTACHED event sent to a machine
    return channel.attach()
  }

  async publish(channel, msgType, message) {
    return channel.publish(msgType, message)
  }

  subscribe(channel, machineRef, eventName = null) {
    // Note: subscribing to an Ably channel will implicitly attach()
    const args = []

    if (eventName) args.push(eventName)
    args.push(
      message => machineRef.send(message.name, { message: message.data })
    )
    channel.subscribe(...args)
  }

  ablyClientOptions() {
    const baseUrl     = AnearApi.api_base_url
    const authUrl     = `${baseUrl}/messaging_auth`
    const authHeaders = {
      ...AnearApi.defaultHeaderObject
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
