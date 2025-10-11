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

  initRealtime(appId, actor) {
    const clientOptions = this.ablyClientOptions(appId)

    logger.debug("[RTM] Ably Client Options", clientOptions)

    this.ablyRealtime = new Ably.Realtime(clientOptions)

    this.ablyRealtime.connection.on((stateChange) =>
      actor.send(stateChange.current.toUpperCase())
    )
    return this
  }

  getChannel(channelName, actor, channelParams = {}) {
    logger.debug(`[RTM] creating channel ${channelName} for ${actor.id}`)

    const channel = this.ablyRealtime.channels.get(channelName, channelParams)
    this.enableCallbacks(channel, actor)

    return channel
  }

  enableCallbacks(channel, actor) {
    const stateChangeCallback = stateChange => {
      const channelState = stateChange.current.toUpperCase()
      logger.debug(`[RTM] sending machine event: ${channel.name} state changed to ${channelState}`)
      return actor.send(channelState, { actor })
    }

    logger.debug(`[RTM] enabling ${NotableChannelEvents} on ${channel.name}`)

    channel.on(NotableChannelEvents, stateChangeCallback)
  }

  enablePresenceCallbacks(channel, actor, presencePrefix, presenceEvents) {
    const presenceActionFunc = action => {
      const eventName = `${presencePrefix}_${action.toUpperCase()}` // e.g.  PARTICIPANT_ENTER, PARTICIPANT_LEAVE

      logger.debug(`[RTM] ${channel.name} subscribing to ${eventName}`)

      channel.presence.subscribe(
        action,
        message => {
          // this callback sends the presence data in an XState event to the actor machine,
          // Actions reference event.data to get at participantId, etc
          const { data } = message // ably presence event message from browser contains message.data.id
          const type = data.type ? data.type : 'NONE'
          logger.debug(`[RTM] rcvd presence ${eventName}, type: ${type} from ${data.id} on ${channel.name}`)
          actor.send(eventName, { data })
        }
      )
    }

    presenceEvents.forEach(presenceActionFunc)
  }

  async getPresenceOnChannel(channel) {
    const members = await channel.presence.get()
    logger.debug(`[RTM] presence.get() on ${channel.name} returns ${members.length} member(s)`)
    return members
  }

  async attachTo(channel) {
    // explicitly attach() to a channel, and if it was unattached,
    // it will trigger the ATTACHED event sent to a machine
    logger.debug(`[RTM] Attaching to ${channel.name}....`)
    return channel.attach()
  }

  async publish(channel, msgType, message) {
    return channel.publish(msgType, message)
  }

  async setPresence(channel, data) {
    try {
      await channel.presence.enter(data)
      logger.debug(`[RTM] presence.enter on ${channel.name} with`, data)
    } catch (e) {
      logger.warn(`[RTM] presence.enter failed on ${channel.name}`, e)
    }
  }

  /**
   * Detach a list of Ably channels.
   * If any detach fails, Promise.all will reject.
   * @param {Channel[]} channels
   */
  async detachAll(channels) {
    // drop any null/undefined entries
    const detachPromises = channels
      .filter(Boolean)
      .map(channel => {
        logger.debug(`[RTM] detaching from ${channel.name}`)
        return channel.detach()
      })

    await Promise.all(detachPromises)
  }

  subscribe(channel, actor, eventName = null) {
    // Note: subscribing to an Ably channel will implicitly attach()
    const args = []

    if (eventName) args.push(eventName)
    args.push(
      message => {
        logger.debug(`message rcvd on channel ${channel.name}.  sending ${message.name}`)
        actor.send(message.name, { data: message.data })
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
          logger.debug('[RTM] ' + message)
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
