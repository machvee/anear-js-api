"use strict"
const Ably = require('ably')
const AnearApi = require('../api/AnearApi')
const logger = require('../utils/Logger')

const BroadcastMessageType       = 'broadcast'
const PublicDisplayMessageType   = 'public_display'
const PrivateDisplayMessageType  = 'private_display'
const ActionMessageType          = 'client_action'
const CreateEventMessageType     = 'create_event'
const ActionTimedOutMessageType  = 'client_timed_out'
const ExitEventMessageType       = 'exit_event'
const EventTransitionMessageType = 'event_transition'

const AblyLogLevel = process.env.ANEARAPP_ABLY_LOG_LEVEL || 0 // 0 - no logging, 4 - verbose logging
const AnearCreateEventChannelName = `anear:${process.env.ANEARAPP_APP_ID}:e`

class AnearMessaging {

  constructor(AnearEventClass, AnearParticipantClass) {
    this.api = new AnearApi()
    this.AnearEventClass = AnearEventClass
    this.AnearParticipantClass = AnearParticipantClass


    const baseUrl          = this.api.api_base_url
    const authUrl          = `${baseUrl}/messaging_auth`
    const authParams       = {
      "app-id":process.env.ANEARAPP_APP_ID
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

    this._eventChannels = {}

    logger.debug("new Ably.Realtime connection..., log level: ", AblyLogLevel)

    this._realtime = new Ably.Realtime(clientOptions)

    this._realtime.connection.on("connected", () => {
      logger.info("Ably connected!")
    })

    this.setupCreateEventChannel()
  }

  async getAnearEventFromStorage(eventId) {
    //
    // retrieve an AnearEvent subclass from storage and initialize
    //
    return await this.AnearEventClass.getFromStorage(eventId, this)
  }

  async getAnearParticipantFromStorage(participantId) {
    //
    // retrieve an AnearEvent subclass from storage and initialize
    //
    return await this.AnearParticipantClass.getFromStorage(participantId)
  }

  async initEventRealTimeMessaging(anearEvent) {

    let spectatorsChannel = null

    if (anearEvent.allowsSpectators()) {
      spectatorsChannel = this.setupSpectatorsChannel(anearEvent)
    }

    const actionsChannel = this.setupActionsChannel(anearEvent)
    const eventsChannel = this.setupEventsChannel(anearEvent)
    const participantsChannel = this.setupParticipantsChannel(anearEvent)

    this._eventChannels[anearEvent.id] = {
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

      if (!await anearEvent.exists()) {
        await anearEvent.createdEventCallback()
        await anearEvent.persist()
        logger.info(`New ${anearEvent.constructor.name} Event: `, anearEvent.toJSON())
      }

      await this.initEventRealTimeMessaging(anearEvent)

    } catch(err) {
      logger.error(err)
    }
  }

  setupCreateEventChannel() {
    logger.info(`attaching to channel ${AnearCreateEventChannelName}`)

    const createEventsChannel = this._realtime.channels.get(AnearCreateEventChannelName)

    this.attachChannel(createEventsChannel, channel => {
      this.subscribeEventMessagesWithHistory(
        channel,
        CreateEventMessageType,
        message => this.createEventMessagingCallback(message)
      )
    })
  }

  setupSpectatorsChannel(anearEvent) {
    const spectatorsChannel = this._realtime.channels.get(anearEvent.spectatorsChannelName())

    this.attachChannel(spectatorsChannel, (channel) => {
      this.subscribePresenceEventWithHistory(
        channel.presence,
        'enter',
        message => this.spectatorEnterMessagingCallback(anearEvent.id, message)
      )

      this.subscribePresenceEventWithHistory(
        channel.presence,
        'leave',
        message => this.spectatorLeaveMessagingCallback(anearEvent.id, message)
      )
    })
    return spectatorsChannel
  }

  setupActionsChannel(anearEvent) {
    const actionsChannel = this._realtime.channels.get(anearEvent.actionsChannelName())

    this.attachChannel(actionsChannel, (channel) => {
      this.subscribePresenceEventWithHistory(
        channel.presence,
        'enter',
        message => this.participantEnterMessagingCallback(anearEvent.id, message)
      )
      this.subscribePresenceEventWithHistory(
        channel.presence,
        'leave',
        message => this.participantLeaveMessagingCallback(anearEvent.id, message)
      )
      this.subscribeEventMessagesWithHistory(
        channel,
        ActionMessageType,
        message => this.participantActionMessagingCallback(anearEvent.id, message)
      )
      this.subscribeEventMessagesWithHistory(
        channel,
        ExitEventMessageType,
        message => this.participantExplicitExitMessagingCallback(anearEvent.id, message)
      )
      this.subscribeEventMessagesWithHistory(
        channel,
        ActionTimedOutMessageType,
        message => this.participantActionTimedOutMessagingCallback(anearEvent.id, message)
      )
    })
    return actionsChannel
  }

  setupEventsChannel(anearEvent) {
    // no explicit attach needed.  We just publish to it which auto-attaches
    const eventsChannel = this._realtime.channels.get(anearEvent.eventChannelName())
    return eventsChannel
  }

  setupParticipantsChannel(anearEvent) {
    const participantsChannel = this._realtime.channels.get(anearEvent.participantsChannelName())

    this.attachChannel(participantsChannel, (channel) => {
      this.subscribeEventMessages(
        channel,
        BroadcastMessageType,
        message => this.eventBroadcastMessagingCallback(message)
      )
    })
    return participantsChannel
  }

  async participantExplicitExitMessagingCallback(eventId, message) {
    //
    // client user deliberately cancels out of event
    //
    const userId = message.clientId

    logger.debug(`ExitEventMessage received from ${userId} for event ${eventId}`)

    await this.closeParticipant(eventId, userId,
      (anearEvent, participantUserId) => anearEvent.participantClose(participantUserId)
    )
  }

  async participantEnterMessagingCallback(eventId, message) {
    // message.clientId is the participant's user_id
    // message.data = {
    //   id: participantId,
    //   geoLocation: {...}
    // }
    //
    const userId = message.clientId
    const participantId = message.data.id

    logger.debug(`**** ENTER PARTICIPANT ****  event: ${eventId}, user: ${userId}, participant: ${participantId}`)

    //
    // get the participant data from the API (this will also validate the participant).  
    // check if the participant is already in storage, and if so, instantiate, else 
    // instantiate from API response
    //
    try {
      const anearParticipantJson = await this.api.getEventParticipantJson(participantId)

      const anearParticipant = new this.AnearParticipantClass(anearParticipantJson)
      anearParticipant.geoLocation = message.data.geoLocation

      logger.debug(`API fetch participant info for ${anearParticipant.name}`)

      const persistedAnearParticipant = await this.AnearParticipantClass.getFromStorage(
        participantId
      )

      if (persistedAnearParticipant) {
        anearParticipant.appData = persistedAnearParticipant.appData
        await anearParticipant.update()
      }

      const anearEvent = await this.getAnearEventFromStorage(anearParticipant.eventId)
      await this.setPrivatePublishingChannel(anearParticipant)

      await anearEvent.participantEnter(anearParticipant)

      await anearEvent.update()
    } catch(err) {
      // participant not found or is not currently marked active at the API service
      // don't allow participation.  FIX: we need to publish to the private channel
      // with an error message type.
      logger.error(err)
    }
  }

  async spectatorEnterMessagingCallback(eventId, message) {
    // TODO: increment a spectator counter stored in app data
    const userId = message.clientId
    const anearEvent = await this.getAnearEventFromStorage(eventId)

    logger.debug(`**** ENTER SPECTATOR ****  event: ${eventId}, user: ${userId}`)
    anearEvent.refreshSpectator()
  }

  async spectatorLeaveMessagingCallback(eventId, message) {
    const userId = message.clientId
    logger.debug(`**** LEAVE SPECTATOR ****  event: ${eventId}, user: ${userId}`)
  }

  async participantLeaveMessagingCallback(eventId, message) {
    // this can be just a temporary leave (refresh browser for example), so we don't do anything
    // for now
    const userId = message.clientId
    logger.debug(`**** LEAVE PARTICIPANT ****  participantLeaveMessagingCallback(userId: ${userId})`)
  }

  async closeParticipant(eventId, participantUserId, callback) {
    logger.debug(`closeParticipant user: ${participantUserId}`)

    const anearEvent = await this.getAnearEventFromStorage(eventId)

    if (anearEvent) {
      this.detachParticipantPrivateChannel(eventId, participantUserId)

      await callback(anearEvent, participantUserId)
      await anearEvent.update()
    }
  }

  detachParticipantPrivateChannel(eventId, participantUserId) {
    const channel = this._eventChannels[eventId].privates[participantUserId]

    if (channel) {
      this.detachChannel(this._eventChannels[eventId].privates[participantUserId])
      delete this._eventChannels[eventId].privates[participantUserId]
    }
  }

  async participantActionTimedOutMessagingCallback(eventId, message) {
    const userId = message.clientId
    logger.debug(`participant TIMED OUT!(${eventId}, ${userId})`)

    const anearEvent = await this.getAnearEventFromStorage(eventId)

    await anearEvent.participantTimedOut(userId)

    this.detachParticipantPrivateChannel(eventId, userId)

    await anearEvent.update()
  }

  async participantActionMessagingCallback(eventId, message) {
    const userId = message.clientId
    const payload = message.data.payload
    const participantId = message.data.participantId

    logger.debug(`participantActionMessagingCallback(${eventId}, ${participantId})`)

    const actionJSON = JSON.parse(payload)
    const anearEvent = await this.getAnearEventFromStorage(eventId)
    const anearParticipant = await this.getAnearParticipantFromStorage(participantId)

    await anearEvent.participantAction(anearParticipant, actionJSON)

    await anearEvent.update()
  }

  async eventBroadcastMessagingCallback(eventId, message) {
    logger.debug(`eventBroadcaseMessagingCallback(${eventId}`)

    const anearEvent = await this.getAnearEventFromStorage(eventId)
    await anearEvent.eventBroadcast(message)
    await anearEvent.update()
  }

  async setPrivatePublishingChannel(anearParticipant) {
    const privateChannel = this._realtime.channels.get(anearParticipant.privateChannelName)
    logger.debug(`setPrivatePublishingChannel(${anearParticipant.privateChannelName})`)
    this._eventChannels[anearParticipant.eventId].privates[anearParticipant.userId] = privateChannel
  }

  attachChannel(channel, attachSuccessCallback) {
    channel.attach((err) => {
      if (err) {
        this.logErrorInfo(err)
      } else {
        attachSuccessCallback(channel)
      }
    })
  }

  subscribeEventMessagesWithHistory(channel, messageType, callback) {
    this.subscribeEventMessages(channel, messageType, callback)
    this.checkMessageHistory(channel, messageType, callback)
  }

  subscribeEventMessages(channel, messageType, callback) {
    channel.subscribe(messageType, callback)
    logger.debug(`subscribed to ${messageType} messages on ${channel.name}`)
  }

  subscribePresenceEventWithHistory(presence, action, callback) {
    presence.subscribe(action, callback)
    presence.history({untilAttach: true}, (err, resultPage) => {
      if (err) {
        logger.error('Unable to get presence history; err = ' + err.message)
      } else {
        logger.info(resultPage.items.length + ' presence events received in page')
        resultPage.items.filter(message => message.action === action).forEach(message => callback(message))
        // TODO: should resultPage.next() in a loop to iterate over all possible missed presence events
      }
    })
  }

  publishEventParticipantsMessage(eventId, message, timeoutMilliseconds=0, callback=null) {
    const channel = this._eventChannels[eventId].participants
    const payload = {content: message}
    if (timeoutMilliseconds > 0) {
      payload.timeout = timeoutMilliseconds
    }

    this.publishChannelMessage(channel, PublicDisplayMessageType, payload, callback)
  }

  publishEventSpectatorsMessage(eventId, message, callback=null) {
    const channel = this._eventChannels[eventId].spectators
    const payload = {content: message}

    this.publishChannelMessage(channel, PublicDisplayMessageType, payload, callback)
  }

  publishEventPrivateMessage(eventId, anearParticipantUserId, message, timeoutMilliseconds=0, callback=null) {
    const channel = this._eventChannels[eventId].privates[anearParticipantUserId]
    if (!channel) throw new Error(`invalid participant id ${anearParticipantUserId}`)

    const payload = {content: message}
    if (timeoutMilliseconds > 0) {
      payload.timeout = timeoutMilliseconds
    }

    this.publishChannelMessage(channel, PrivateDisplayMessageType, payload, callback)
  }

  publishEventTransitionMessage(eventId, newState, callback) {
    const channel = this._eventChannels[eventId].events
    const payload = {content: {state: newState}}

    logger.debug(`publishEventTransitionMessage: event ${eventId} transitioning to ${newState}`)

    this.publishChannelMessage(channel, EventTransitionMessageType, payload, callback)
  }

  publishChannelMessage(channel, messageType, payload, callback) {
    channel.publish(
      messageType,
      payload,
      (err) => {
        if (callback) {
          callback(err)
        } else {
          if (err) this.logErrorInfo(err)
        }
      }
    )
  }

  detachAll(eventId) {
    const eventChannels = this._eventChannels[eventId]
    this.detachChannel(eventChannels.events)
    this.detachChannel(eventChannels.participants)
    this.detachChannel(eventChannels.actions)
    this.detachChannel(eventChannels.spectators)
    Object.values(eventChannels.privates).forEach(channel => {
      this.detachChannel(channel)
    })
  }

  detachChannel (channel) {
    if (!channel || channel.state !== 'attached') return
    channel.detach(this.logErrorInfo)
    logger.info(`detaching channel ${channel.name}`)
  }

  checkMessageHistory (channel, messageType, callback) {
    channel.history({untilAttach: true}, (err, resultPage) => {
      if (err) {
        logger.error('Unable to get channel history; err = ' + err.message)
      } else {
        logger.info(resultPage.items.length + ' history events received in page')
        resultPage.items.filter(message => message.name === messageType).forEach(message => callback(message))
        // TODO: should resultPage.next() in a loop to iterate over all possible missed presence events
      }
    })
  }

  logErrorInfo(errInfo) {
    if (errInfo) {
      logger.error(`Ably ERROR (${errInfo.code}):  ${errInfo.message}`)
    }
  }
}

module.exports = AnearMessaging
