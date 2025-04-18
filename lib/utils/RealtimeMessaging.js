"use strict"

const Ably = require('ably')
const logger = require('../utils/Logger')
const AnearApi = require('../api/AnearApi')

const DefaultHeartbeatIntervalMsecs = 15000
const NotableChannelEvents = ['attached', 'suspended', 'failed']

class RealtimeMessaging {
  constructor() {
    this.ablyRealtime = null
  }

  initRealtime(appId, machineRef) {
    const clientOptions = this.ablyClientOptions(appId)

    logger.debug("Ably Client Options", clientOptions)

    this.ablyRealtime = new Ably.Realtime(clientOptions)

    this.ablyRealtime.connection.on((stateChange) =>
      machineRef.send(stateChange.current.toUpperCase())
    )
    return this
  }

  getChannel(channelName, machineRef, channelParams = {}) {
    logger.debug(`Creating channel ${channelName} for ${machineRef.id}`)

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

  enablePresenceCallbacks(channel, machineRef, presencePrefix, presenceEvents) {
    const presenceActionFunc = action => {
      const eventName = `${presencePrefix}_${action.toUpperCase()}`

      logger.debug(`${channel.name} subscribing to ${eventName}`)

      channel.presence.subscribe(
        action,
        member => {
          logger.debug(`sending machine event: rcvd presence ${eventName} from ${member.id} on ${channel.name}`)
          machineRef.send(eventName, { data: member.data })
        }
      )
    }
    presenceEvents.forEach(presenceActionFunc)
  }

  async getPresenceOnChannel(channel) {
    const members = await channel.presence.get()
    logger.debug(`presence.get() on ${channel.name} returns ${members.length} member(s)`)
    return members
  }

  async attachTo(channel) {
    // explicitly attach() to a channel, and if it was unattached,
    // it will trigger the ATTACHED event sent to a machine
    logger.debug(`Attaching to ${channel.name}....`)
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
      message => {
        logger.debug(`message rcvd on channel ${channel.name}.  sending ${eventName}`)
        machineRef.send(message.name, { message: message.data })
      }
    )
    channel.subscribe(...args)
  }

  ablyClientOptions(appId) {
    const baseUrl = AnearApi.api_base_url
    const authUrl = `${baseUrl}/messaging_auth`
    const authHeaders = {
      ...AnearApi.defaultHeaderObject,
    }
    const authParams = {
      "app-id": appId,
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
        handler: (message) => {
          logger.debug(message)
        }
      }
    }
  }

  transportParams() {
    const heartbeatInterval = process.env.ANEARAPP_API_HEARTBEAT_INTERVAL_SECONDS
      ? process.env.ANEARAPP_API_HEARTBEAT_INTERVAL_SECONDS * 1000
      : DefaultHeartbeatIntervalMsecs

    return {
      heartbeatInterval,
    }
  }

  close() {
    this.ablyRealtime && this.ablyRealtime.close()
    this.ablyRealtime = null
  }
}

const realtimeMessagingInstance = new RealtimeMessaging()

module.exports = realtimeMessagingInstance
