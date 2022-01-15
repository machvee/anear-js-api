"use strict"
const Ably = require('ably/promises')
const AnearApi = require('../api/AnearApi')
const logger = require('../utils/Logger')
const { Mutex } = require('async-mutex')

const AppId = process.env.ANEARAPP_APP_ID

const BroadcastMessageType       = 'broadcast'
const PublicDisplayMessageType   = 'public_display'
const ActionMessageType          = 'client_action'
const CreateEventMessageType     = 'create_event'
const ExitEventMessageType       = 'exit_event'
const EventTransitionMessageType = 'event_transition'

const PRESENCE_ENTER = 'enter'
const PRESENCE_LEAVE = 'leave'

// any channel messages sent with 5 secs (5s) of initial attach will be delivered
// to the subscribers
const ChannelParams = {params: {rewind: "5s"}}


const AblyLogLevel = process.env.ANEARAPP_ABLY_LOG_LEVEL || 0 // 0 - no logging, 4 - verbose logging
const AnearCreateEventChannelName = `anear:${AppId}:e`

class AnearMessaging {

  constructor(AnearEventClass, AnearParticipantClass) {
    this.api = new AnearApi()
    this.AnearEventClass = AnearEventClass
    this.AnearParticipantClass = AnearParticipantClass
    this.mutex = new Mutex()


    const baseUrl          = this.api.api_base_url
    const authUrl          = `${baseUrl}/messaging_auth`
    const authParams       = {
      "app-id":AppId
    }
    const anearAuthHeaders = {
      ...this.api.defaultHeaderObject
    }

    const clientOptions = {
      authUrl: authUrl,
      authHeaders: anearAuthHeaders,
      authParams: authParams,
      echoMessages: false,
      log: {
        level: AblyLogLevel,
        handler: (message) => {logger.debug(message)}
      }
    }

    this.eventChannels = {}
    this.participantTimers = {}

    this.initRealtime(clientOptions)
  }

  initRealtime(clientOptions) {
    logger.debug("new Ably.Realtime connection..., log level: ", AblyLogLevel)

    this.realtime = new Ably.Realtime(clientOptions)

    this.realtime.connection.on(
      "connected",
      async () => {
        logger.info("Ably connected!")
        await this.reloadAnyEventsInProgress(AppId)
        await this.setupCreateEventChannel()
      }
    )
  }

  getChannel(channelName, channelParams = ChannelParams) {
    return this.realtime.channels.get(channelName, channelParams)
  }

  clearParticipantTimer(participantId) {
    const timerId = this.participantTimers[participantId]
    if (timerId) {
      clearTimeout(timerId)
      this.participantTimers[participantId] = null
    }
  }

  setParticipantTimer(eventId, anearParticipant, timeoutMilliseconds) {
    const participantId = anearParticipant.id

    this.clearParticipantTimer(participantId)

    if (timeoutMilliseconds === 0) return

    logger.debug(`setting ${timeoutMilliseconds} msec timer for event ${eventId}, participant ${anearParticipant.id}`)

    this.participantTimers[participantId] = setTimeout(
      async () => await this.timerExpired(eventId, anearParticipant, timeoutMilliseconds),
      timeoutMilliseconds
    )
  }

  async timerExpired(eventId, anearParticipant, timeoutMilliseconds) {
    const participantId = anearParticipant.id

    logger.debug(`participant (${eventId}, ${participantId}) TIMED OUT after ${timeoutMilliseconds} msecs`)

    await this.getAnearEventWithLockFromStorage(
      eventId,
      async anearEvent => {
        const anearParticipant = await this.getAnearParticipantFromStorage(participantId)
        await anearEvent.participantTimedOut(anearParticipant)
        await anearEvent.update()
      }
    )
  }

  async getAnearEventFromStorage(eventId) {
    return await this.AnearEventClass.getFromStorage(eventId, this)
  }

  async getAnearParticipantFromStorage(participantId) {
    return await this.AnearParticipantClass.getFromStorage(participantId)
  }

  async initEventRealtimeMessaging(anearEvent) {

    if (this.eventChannels.hasOwnProperty(anearEvent.id)) {
      logger.debug(`initEventRealtimeMessaging(${anearEvent.id}) already initialized.`)
      return
    }

    this.eventChannels[anearEvent.id] = {privates: {}}

    try {
      await this.setupSpectatorsChannel(anearEvent)
      this.setupEventsChannel(anearEvent)
      await this.setupParticipantsChannel(anearEvent)
      await this.setupActionsChannel(anearEvent)
    } catch(error) {
      logger.error(`initEventRealtimeMessaging(${anearEvent.id}): `, error)
    }

    logger.debug(`initEventRealtimeMessaging(${anearEvent.id}) is complete`)

    return anearEvent
  }

  async createEventMessagingCallback(message) {
    //
    // create the AnearEvent subclass, persist it in storage, and
    // initialize its realtime messaging
    //
    logger.info(`Ably message received....createEventMessagingCallback(${message.name})`)

    try {
      const eventJson = JSON.parse(message.data)
      const anearEvent = new this.AnearEventClass(eventJson, this)
      //
      // if we are getting this event create message from history after a quick restart,
      // we just return if the event already exists
      //
      await this.loadOrPersistEventAndInitMessaging(anearEvent)
    } catch(err) {
      logger.error(err)
    }
  }

  async loadOrPersistEventAndInitMessaging(anearEvent) {
    const eventExists = await anearEvent.exists()

    logger.info(`Event ${anearEvent.id} ${eventExists ? "already exists" : "does not exist"} in Storage`)

    if (!eventExists) {
      await anearEvent.createdEventCallback()
      await anearEvent.persist()
    }

    logger.info(`New ${anearEvent.constructor.name} Event: `, anearEvent.toJSON())

    await this.initEventRealtimeMessaging(anearEvent)
  }

  async reloadAnyEventsInProgress(appId) {
    try {
      const anearApp = await this.api.getAppZones(appId)
      for (const zone of anearApp.data.relationships.zones.data) {
        const zoneEvents = await this.api.getZoneEvents(zone.id)
        const events = zoneEvents.data.relationships.events.data

        for (const eventData of events) {
          const eventJson = await this.api.getEvent(eventData.id)
          const anearEvent = new this.AnearEventClass(eventJson, this)
          await this.loadOrPersistEventAndInitMessaging(anearEvent)
        }
      }
    } catch (err) {
      logger.error(err)
    }
  }

  async setupCreateEventChannel() {
    logger.info(`attaching to channel ${AnearCreateEventChannelName}`)

    const createEventsChannel = this.getChannel(AnearCreateEventChannelName)

    await this.attachChannel(createEventsChannel)

    this.subscribeEventMessages(
      createEventsChannel,
      CreateEventMessageType,
      async message => await this.createEventMessagingCallback(message)
    )
  }

  async setupSpectatorsChannel(anearEvent) {
    if (!anearEvent.allowsSpectators()) {
      this.eventChannels[anearEvent.id].spectators = null
      return
    }

    const spectatorsChannel = this.getChannel(anearEvent.spectatorsChannelName(), {})

    this.eventChannels[anearEvent.id].spectators = spectatorsChannel

    await this.attachChannel(spectatorsChannel)

    this.subscribePresenceEvent(
      spectatorsChannel,
      PRESENCE_ENTER,
      async message => await this.spectatorEnterMessagingCallback(anearEvent, message)
    )

    this.subscribePresenceEvent(
      spectatorsChannel,
      PRESENCE_LEAVE,
      async message => await this.spectatorLeaveMessagingCallback(anearEvent, message)
    )
  }

  async setupActionsChannel(anearEvent) {
    const actionsChannel = this.getChannel(anearEvent.actionsChannelName())

    this.eventChannels[anearEvent.id].actions = actionsChannel

    await this.attachChannel(actionsChannel)

    await this.subscribePresenceEventWithHistory(
      actionsChannel,
      PRESENCE_ENTER,
      async message => await this.participantEnterMessagingCallback(anearEvent, message)
    )
    this.subscribeEventMessages(
      actionsChannel,
      ActionMessageType,
      async message => await this.participantActionMessagingCallback(anearEvent, message)
    )
    this.subscribePresenceEvent(
      actionsChannel,
      PRESENCE_LEAVE,
      async message => await this.participantLeaveMessagingCallback(anearEvent, message)
    )
    this.subscribeEventMessages(
      actionsChannel,
      ExitEventMessageType,
      async message => await this.participantExplicitExitMessagingCallback(anearEvent, message)
    )
  }

  setupEventsChannel(anearEvent) {
    // no explicit attach needed.  We just publish to it which causes auto-attach
    this.eventChannels[anearEvent.id].events = this.getChannel(anearEvent.eventChannelName())
  }

  async setupParticipantsChannel(anearEvent) {
    const participantsChannel = this.getChannel(anearEvent.participantsChannelName())

    this.eventChannels[anearEvent.id].participants = participantsChannel

    await this.attachChannel(participantsChannel)

    this.subscribeEventMessages(
      participantsChannel,
      BroadcastMessageType,
      async message => await this.eventBroadcastMessagingCallback(message)
    )
    return participantsChannel
  }

  async participantExplicitExitMessagingCallback(anearEvent, message) {
    //
    // client user deliberately cancels out of event
    //
    const participantId = message.data.participantId

    logger.debug(`ExitEventMessage received from ${participantId} for event ${anearEvent.id}`)

    await this.mutex.runExclusive(async () => {
      await this.closeParticipant(
        anearEvent,
        participantId,
        (anearEvent, anearParticipant) => anearEvent.participantClose(anearParticipant)
      )
    })
  }

  async participantEnterMessagingCallback(anearEvent, presenceMessage) {
    // presenceMessage.clientId is the participant's user_id
    // presenceMessage.data = {
    //   id: participantId,
    //   geoLocation: {...}
    // }
    //
    const participantId = presenceMessage.data.id
    const geoLocation = presenceMessage.data.geoLocation

    logger.debug(`**** ENTER PARTICIPANT ****  event: ${anearEvent.id}, participant: ${participantId}`)

    //
    // get the participant data from the API (this will also validate the participant).
    // check if the participant is already in storage, and if so, instantiate, else
    // instantiate from API response
    //
    try {
      logger.debug(`API fetch participant info for ${participantId}`)

      const anearParticipantJson = await this.api.getEventParticipantJson(participantId)
      const anearParticipant = new this.AnearParticipantClass(anearParticipantJson)

      anearParticipant.geoLocation = geoLocation

      await this.setupPrivatePublishingChannel(anearParticipant)

      const persistedAnearParticipant = await this.AnearParticipantClass.getFromStorage(participantId)

      if (persistedAnearParticipant) {
        anearParticipant.appData = persistedAnearParticipant.appData
      }

      await this.mutex.runExclusive(async () => {
        await anearEvent.participantEnter(anearParticipant)
        await anearEvent.update()
      })
    } catch(error) {
      // participant not found or is not currently marked active at the API service
      // don't allow participation.  FIX: we need to publish to the private channel
      // with an error message type.
      logger.error(`participantEnterMessagingCallback(${anearEvent.id}, ${participantId}) error: `, error)
    }
  }

  async spectatorEnterMessagingCallback(anearEvent, message) {
    const userId = message.clientId

    logger.debug(`**** ENTER SPECTATOR ****  event: ${anearEvent.id}, user: ${userId}`)

    await anearEvent.refreshSpectator()
  }

  async spectatorLeaveMessagingCallback(anearEvent, message) {
    const userId = message.clientId
    logger.debug(`**** LEAVE SPECTATOR ****  event: ${anearEvent.id}, user: ${userId}`)
  }

  async participantLeaveMessagingCallback(anearEvent, message) {
    // this can be just a temporary leave (refresh browser for example), so we don't do anything
    // for now
    const userId = message.clientId
    logger.debug(`**** LEAVE PARTICIPANT ****  participantLeaveMessagingCallback(user: ${userId})`)
  }

  async closeParticipant(anearEvent, participantId, callback) {
    logger.debug(`closeParticipant(${participantId})`)

    this.clearParticipantTimer(participantId)

    const anearParticipant = await this.getAnearParticipantFromStorage(participantId)

    if (anearParticipant) {
      await this.detachParticipantPrivateChannel(anearEvent.id, anearParticipant)

      await this.mutex.runExclusive(async () => {
        await callback(anearEvent, anearParticipant)
        await anearEvent.update()
      })
    }
  }

  async detachParticipantPrivateChannel(eventId, anearParticipant) {
    const userId = anearParticipant.userId
    const channel = this.eventChannels[eventId].privates[userId]

    if (channel) {
      await this.detachChannel(this.eventChannels[eventId].privates[userId])
      delete this.eventChannels[eventId].privates[userId]
    }
  }

  async participantActionMessagingCallback(anearEvent, message) {
    const payload = message.data.payload
    const participantId = message.data.participantId

    logger.debug(`participantActionMessagingCallback(${anearEvent.id}, ${participantId})`)

    this.clearParticipantTimer(participantId)

    const actionJSON = JSON.parse(payload)
    const [actionEventName, actionPayload] = Object.entries(actionJSON)[0]

    const anearParticipant = await this.getAnearParticipantFromStorage(participantId)

    await this.mutex.runExclusive(async () => {
      await anearEvent.participantAction(anearParticipant, actionEventName, actionPayload)
      await anearEvent.update()
    })
  }

  async eventBroadcastMessagingCallback(eventId, message) {
    logger.debug(`eventBroadcaseMessagingCallback(${eventId}`)

    const anearEvent = await this.getAnearEventFromStorage(eventId)
    await anearEvent.eventBroadcast(message)
    await anearEvent.update()
  }

  async setupPrivatePublishingChannel(anearParticipant) {
    const privateChannel = this.getChannel(anearParticipant.privateChannelName, {})
    this.eventChannels[anearParticipant.eventId].privates[anearParticipant.userId] = privateChannel
    await this.attachChannel(privateChannel)

    logger.debug(`setupPrivatePublishingChannel(${anearParticipant.privateChannelName}) state ${privateChannel.state}`)
  }

  async attachChannel(channel) {
    try {
      return await channel.attach()
    } catch(err) {
      this.logErrorInfo(err)
    }
  }

  subscribeEventMessages(channel, messageType, callback) {
    channel.subscribe(messageType, callback)
    logger.debug(`subscribed to ${messageType} messages on ${channel.name}`)
  }

  subscribePresenceEvent(channel, action, callback) {
    channel.presence.subscribe(action, callback)
  }

  async subscribePresenceEventWithHistory(channel, action, callback) {
    logger.info(`subscribePresenceEvents(${action}) for channel ${channel.name}`)

    this.subscribePresenceEvent(channel, action, callback)

    try {
      const history = await channel.presence.history({limit: 25})

      history.items.filter(message => message.action === action).forEach(
        async message => {
          logger.info(`presence history ${action} event received`, message)
          await callback(message)
        }
      )
    } catch(err) {
      logger.error('Unable to get presence history; err = ' + err.message)
    }
  }

  async publishEventParticipantsMessage(eventId, participants, css, message, timeoutMilliseconds=0, timeoutCallback=null) {
    const channel = this.eventChannels[eventId].participants

    const setTimerFunction = () => this.setMultipleParticipantTimers(eventId, participants, timeoutMilliseconds)

    await this.publishChannelMessageWithTimeout(
      channel,
      PublicDisplayMessageType,
      css,
      message,
      timeoutMilliseconds,
      setTimerFunction,
      timeoutCallback
    )
  }

  setMultipleParticipantTimers(eventId, participants, timeoutMilliseconds) {
    if (timeoutMilliseconds === 0) return

    participants.forEach(
      anearParticipant => this.setParticipantTimer(eventId, anearParticipant, timeoutMilliseconds)
    )
  }

  async publishEventSpectatorsMessage(eventId, css, message, messageType = PublicDisplayMessageType) {
    const channel = this.eventChannels[eventId].spectators
    const payload = {
      css: css,
      content: message
    }

    await this.publishChannelMessage(channel, messageType, payload)
  }

  async publishEventPrivateMessage(
          eventId,
          anearParticipant,
          messageType,
          css,
          message,
          timeoutMilliseconds=0,
          timeoutCallback=null) {

    const userId = anearParticipant.userId
    const channel = this.eventChannels[eventId].privates[userId]
    if (!channel) throw new Error(`private channel not found.  invalid user id ${userId}`)

    const setTimerFunction = () => this.setParticipantTimer(eventId, anearParticipant, timeoutMilliseconds)

    await this.publishChannelMessageWithTimeout(
      channel,
      messageType,
      css,
      message,
      timeoutMilliseconds,
      setTimerFunction,
      timeoutCallback
    )
  }

  async publishChannelMessageWithTimeout(
          channel,
          messageType,
          css,
          message,
          timeoutMilliseconds=0,
          setTimerFunction,
          timeoutCallback=null) {

    const timerCallback = async () => {
      if (timeoutMilliseconds > 0) setTimerFunction()
      if (timeoutCallback) await timeoutCallback()
    }

    const payload = {
      css: css,
      content: message,
      timeout: timeoutMilliseconds
    }

    await this.publishChannelMessage(
      channel,
      messageType,
      payload
    )
    await timerCallback()
  }

  async publishEventTransitionMessage(eventId, newState) {
    const channel = this.eventChannels[eventId].events
    const payload = {content: {state: newState}}

    logger.debug(`publishEventTransitionMessage: event ${eventId} transitioning to ${newState}`)

    await this.publishChannelMessage(channel, EventTransitionMessageType, payload)
  }

  async publishChannelMessage(channel, messageType, payload) {
    try {
      await channel.publish(
        messageType,
        payload
      )
    } catch(err) {
      this.logErrorInfo(err)
    }
  }

  async detachAll(eventId) {
    const channels = this.eventChannels[eventId]
    await this.detachChannel(channels.events)
    await this.detachChannel(channels.participants)
    await this.detachChannel(channels.actions)

    if (channels.spectators) await this.detachChannel(channels.spectators)

    for (const channel of Object.values(channels.privates)) {
      await this.detachChannel(channel)
    }
    delete this.eventChannels[eventId]
  }

  async detachChannel (channel) {
    if (!channel || channel.state !== 'attached') return

    try {
      await channel.detach(this.logErrorInfo)
      logger.info(`channel ${channel.name} detached`)
    } catch(err) {
      this.logErrorInfo(err)
    }
  }

  logErrorInfo(errInfo) {
    if (errInfo) {
      logger.error(`Ably ERROR (${errInfo.code}):  ${errInfo.message}`)
    }
  }
}

module.exports = AnearMessaging
