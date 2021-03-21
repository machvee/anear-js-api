"use strict"
const Ably = require('ably/promises')
const AnearApi = require('../api/AnearApi')
const logger = require('../utils/Logger')

const AppId = process.env.ANEARAPP_APP_ID

const BroadcastMessageType       = 'broadcast'
const PublicDisplayMessageType   = 'public_display'
const CssDisplayMessageType      = 'css_display'
const ActionMessageType          = 'client_action'
const CreateEventMessageType     = 'create_event'
const ExitEventMessageType       = 'exit_event'
const EventTransitionMessageType = 'event_transition'

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

  async getAnearEventWithLockFromStorage(eventId, callback) {
    return await this.AnearEventClass.getWithLockFromStorage(
      eventId,
      callback,
      this
    )
  }

  async getAnearParticipantFromStorage(participantId) {
    return await this.AnearParticipantClass.getFromStorage(participantId)
  }

  async getAnearParticipantWithLockFromStorage(participantId, callback) {
    return await this.AnearParticipantClass.getWithLockFromStorage(
      participantId,
      callback
    )
  }

  async initEventRealTimeMessaging(anearEvent) {

    if (this.eventChannels.hasOwnProperty(anearEvent.id)) {
      logger.debug(`initEventRealTimeMessaging(${anearEvent.id}) already initialized.`)
      return
    }

    let spectatorsChannel = null

    if (anearEvent.allowsSpectators()) {
      spectatorsChannel = await this.setupSpectatorsChannel(anearEvent)
    }

    const actionsChannel = await this.setupActionsChannel(anearEvent)
    const eventsChannel = await this.setupEventsChannel(anearEvent)
    const participantsChannel = await this.setupParticipantsChannel(anearEvent)

    this.eventChannels[anearEvent.id] = {
      events: eventsChannel,
      participants: participantsChannel,
      actions: actionsChannel,
      spectators: spectatorsChannel,
      privates: {}
    }

    logger.debug(`initEventRealTimeMessaging(${anearEvent.id}) complete`)

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

    await this.initEventRealTimeMessaging(anearEvent)
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
    const spectatorsChannel = this.getChannel(anearEvent.spectatorsChannelName(), {})

    await this.attachChannel(spectatorsChannel)

    this.subscribePresenceEvent(
      spectatorsChannel,
      'enter',
      async message => await this.spectatorEnterMessagingCallback(anearEvent.id, message)
    )

    this.subscribePresenceEvent(
      spectatorsChannel,
      'leave',
      async message => await this.spectatorLeaveMessagingCallback(anearEvent.id, message)
    )
    return spectatorsChannel
  }

  async setupActionsChannel(anearEvent) {
    const actionsChannel = this.getChannel(anearEvent.actionsChannelName())

    await this.attachChannel(actionsChannel)

    await this.subscribePresenceEventWithHistory(
      actionsChannel,
      'enter',
      async message => await this.participantEnterMessagingCallback(anearEvent.id, message)
    )
    await this.subscribeEventMessages(
      actionsChannel,
      ActionMessageType,
      async message => await this.participantActionMessagingCallback(anearEvent.id, message)
    )
    this.subscribePresenceEvent(
      actionsChannel,
      'leave',
      async message => await this.participantLeaveMessagingCallback(anearEvent.id, message)
    )
    this.subscribeEventMessages(
      actionsChannel,
      ExitEventMessageType,
      async message => await this.participantExplicitExitMessagingCallback(anearEvent.id, message)
    )

    return actionsChannel
  }

  setupEventsChannel(anearEvent) {
    // no explicit attach needed.  We just publish to it which auto-attaches
    return this.getChannel(anearEvent.eventChannelName())
  }

  async setupParticipantsChannel(anearEvent) {
    const participantsChannel = this.getChannel(anearEvent.participantsChannelName())

    await this.attachChannel(participantsChannel)

    this.subscribeEventMessages(
      participantsChannel,
      BroadcastMessageType,
      async message => await this.eventBroadcastMessagingCallback(message)
    )
    return participantsChannel
  }

  async participantExplicitExitMessagingCallback(eventId, message) {
    //
    // client user deliberately cancels out of event
    //
    const participantId = message.data.participantId

    logger.debug(`ExitEventMessage received from ${participantId} for event ${eventId}`)

    await this.closeParticipant(eventId, participantId,
      (anearEvent, anearParticipant) => anearEvent.participantClose(anearParticipant)
    )
  }

  async participantEnterMessagingCallback(eventId, presenceMessage) {
    // presenceMessage.clientId is the participant's user_id
    // presenceMessage.data = {
    //   id: participantId,
    //   geoLocation: {...}
    // }
    //
    const participantId = presenceMessage.data.id
    const geoLocation = presenceMessage.data.geoLocation

    logger.debug(`**** ENTER PARTICIPANT ****  event: ${eventId}, participant: ${participantId}`)

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

      const eventLockCallback = async (anearEvent) => {
        await anearEvent.publishCss(anearParticipant)
        await anearEvent.participantEnter(anearParticipant)
        await anearEvent.update()
      }

      if (persistedAnearParticipant) {
        anearParticipant.appData = persistedAnearParticipant.appData
        await anearParticipant.update()
      }

      await this.getAnearEventWithLockFromStorage(anearParticipant.eventId, eventLockCallback)

    } catch(err) {
      // participant not found or is not currently marked active at the API service
      // don't allow participation.  FIX: we need to publish to the private channel
      // with an error message type.
      logger.error(`participantEnterMessagingCallback(${eventId}, ${participantId}) error: `, err)
    }
  }

  async spectatorEnterMessagingCallback(eventId, message) {
    const userId = message.clientId
    const anearEvent = await this.getAnearEventFromStorage(eventId)

    logger.debug(`**** ENTER SPECTATOR ****  event: ${eventId}, user: ${userId}`)

    await anearEvent.publishSpectatorCss()
    await anearEvent.refreshSpectator()
  }

  spectatorLeaveMessagingCallback(eventId, message) {
    const userId = message.clientId
    logger.debug(`**** LEAVE SPECTATOR ****  event: ${eventId}, user: ${userId}`)
  }

  async participantLeaveMessagingCallback(eventId, message) {
    // this can be just a temporary leave (refresh browser for example), so we don't do anything
    // for now
    const userId = message.clientId
    logger.debug(`**** LEAVE PARTICIPANT ****  participantLeaveMessagingCallback(user: ${userId})`)
  }

  async closeParticipant(eventId, participantId, callback) {
    logger.debug(`closeParticipant(${participantId})`)

    this.clearParticipantTimer(participantId)

    await this.getAnearEventWithLockFromStorage(
      eventId,
      async (anearEvent) => {
        const anearParticipant = await this.getAnearParticipantFromStorage(participantId)


        if (anearParticipant) {
          await this.detachParticipantPrivateChannel(eventId, anearParticipant)

          await callback(anearEvent, anearParticipant)
          await anearEvent.update()
        }
      }
    )
  }

  async detachParticipantPrivateChannel(eventId, anearParticipant) {
    const userId = anearParticipant.userId
    const channel = this.eventChannels[eventId].privates[userId]

    if (channel) {
      await this.detachChannel(this.eventChannels[eventId].privates[userId])
      delete this.eventChannels[eventId].privates[userId]
    }
  }

  async participantActionMessagingCallback(eventId, message) {
    const payload = message.data.payload
    const participantId = message.data.participantId

    logger.debug(`participantActionMessagingCallback(${eventId}, ${participantId})`)

    this.clearParticipantTimer(participantId)

    const actionJSON = JSON.parse(payload)
    const [actionEventName, actionPayload] = Object.entries(actionJSON)[0]

    await this.getAnearEventWithLockFromStorage(
      eventId,
      async anearEvent => {
        const anearParticipant = await this.getAnearParticipantFromStorage(participantId)
        await anearEvent.participantAction(anearParticipant, actionEventName, actionPayload)
        await anearEvent.update()
      }
    )
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

  async publishEventParticipantsMessage(eventId, participants, message, timeoutMilliseconds=0, timeoutCallback=null) {
    const channel = this.eventChannels[eventId].participants

    const setTimerFunction = () => this.setMultipleParticipantTimers(eventId, participants, timeoutMilliseconds)

    await this.publishChannelMessageWithTimeout(
      channel,
      PublicDisplayMessageType,
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

  async publishEventSpectatorsMessage(eventId, message, messageType = PublicDisplayMessageType) {
    const channel = this.eventChannels[eventId].spectators
    const payload = {content: message}

    await this.publishChannelMessage(channel, messageType, payload)
  }

  async publishEventCssMessage(eventId, anearParticipant, cssMessage) {
    logger.debug(`publishEventCssMessage(${eventId})`)

    await this.publishEventPrivateMessage(
      eventId,
      anearParticipant,
      CssDisplayMessageType,
      cssMessage
    )
  }

  async publishSpectatorsCssMessage(eventId, cssMessage) {
    await this.publishEventSpectatorsMessage(
      eventId,
      cssMessage,
      CssDisplayMessageType
    )
  }

  async publishEventPrivateMessage(
          eventId,
          anearParticipant,
          messageType,
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
      message,
      timeoutMilliseconds,
      setTimerFunction,
      timeoutCallback
    )
  }

  async publishChannelMessageWithTimeout(
          channel,
          messageType,
          message,
          timeoutMilliseconds=0,
          setTimerFunction,
          timeoutCallback=null) {

    const timerCallback = async () => {
      if (timeoutMilliseconds > 0) setTimerFunction()
      if (timeoutCallback) await timeoutCallback()
    }

    const payload = {
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
