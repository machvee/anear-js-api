"use strict"
const Ably = require('ably')
const AnearApi = require('../api/AnearApi')
const logger = require('../utils/Logger')

const BroadcastMessageType       = 'broadcast'
const PublicDisplayMessageType   = 'public_display'
const PrivateDisplayMessageType  = 'private_display'
const CssDisplayMessageType      = 'css_display'
const ActionMessageType          = 'client_action'
const CreateEventMessageType     = 'create_event'
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
    this._participantTimers = {}

    this.initRealtime(clientOptions)

    this.setupCreateEventChannel()
  }

  initRealtime(clientOptions) {
    logger.debug("new Ably.Realtime connection..., log level: ", AblyLogLevel)

    this._realtime = new Ably.Realtime(clientOptions)

    this._realtime.connection.on("connected", () => {
      logger.info("Ably connected!")
    })
  }

  getChannel(channelName) {
    return this._realtime.channels.get(channelName)
  }

  clearParticipantTimer(participantId) {
    const timerId = this._participantTimers[participantId]
    if (timerId) {
      clearTimeout(timerId)
      this._participantTimers[participantId] = null
    }
  }

  setParticipantTimer(eventId, anearParticipant, timeoutMilliseconds) {
    const participantId = anearParticipant.id

    this.clearParticipantTimer(participantId)

    if (timeoutMilliseconds === 0) return

    logger.debug(`setting ${timeoutMilliseconds} msec timer for event ${eventId}, participant ${anearParticipant.id}`)

    this._participantTimers[participantId] = setTimeout(
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

      // if we are getting this event create message from history after a quick restart,
      // we just return if the event already exists
      //
      if (await anearEvent.exists()) {
        logger.info(`Event ${anearEvent.id} already exists.  skip create`)
        return
      }

      await anearEvent.createdEventCallback()
      await anearEvent.persist()

      logger.info(`New ${anearEvent.constructor.name} Event: `, anearEvent.toJSON())

      await this.initEventRealTimeMessaging(anearEvent)
    } catch(err) {
      logger.error(err)
    }
  }

  setupCreateEventChannel() {
    logger.info(`attaching to channel ${AnearCreateEventChannelName}`)


    const createEventsChannel = this.getChannel(AnearCreateEventChannelName)

    this.attachChannel(createEventsChannel, channel => {
      this.subscribeEventMessagesWithHistory(
        channel,
        CreateEventMessageType,
        message => this.createEventMessagingCallback(message)
      )
    })
  }

  setupSpectatorsChannel(anearEvent) {
    const spectatorsChannel = this.getChannel(anearEvent.spectatorsChannelName())

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
    const actionsChannel = this.getChannel(anearEvent.actionsChannelName())

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
    })
    return actionsChannel
  }

  setupEventsChannel(anearEvent) {
    // no explicit attach needed.  We just publish to it which auto-attaches
    return this.getChannel(anearEvent.eventChannelName())
  }

  setupParticipantsChannel(anearEvent) {
    const participantsChannel = this.getChannel(anearEvent.participantsChannelName())

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
    const participantId = message.data.participantId

    logger.debug(`ExitEventMessage received from ${participantId} for event ${eventId}`)

    await this.closeParticipant(eventId, participantId,
      (anearEvent, anearParticipant) => anearEvent.participantClose(anearParticipant)
    )
  }

  async participantEnterMessagingCallback(eventId, message) {
    // message.clientId is the participant's user_id
    // message.data = {
    //   participantId: participantId,
    //   geoLocation: {...}
    // }
    //
    const participantId = message.data.participantId

    logger.debug(`**** ENTER PARTICIPANT ****  event: ${eventId}, participant: ${participantId}`)

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

      await this.setPrivatePublishingChannel(anearParticipant)

      await this.getAnearEventWithLockFromStorage(
        anearParticipant.eventId,
        async (anearEvent) => {
          await anearEvent.publishCss(anearParticipant)
          await anearEvent.participantEnter(anearParticipant)
          await anearEvent.update()
        },
      )
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
    logger.debug(`**** LEAVE PARTICIPANT ****  participantLeaveMessagingCallback(user: ${userId})`)
  }

  async closeParticipant(eventId, participantId, callback) {
    logger.debug(`closeParticipant(${participantId})`)

    this.clearParticipantTimer(participantId)

    await this.getAnearEventWithLockFromStorage(
      eventId,
      async (anearEvent) => {
        const anearParticipant = await this.getAnearParticipantFromStorage(participantId)

        this.detachParticipantPrivateChannel(eventId, anearParticipant)

        await callback(anearEvent, anearParticipant)
        await anearEvent.update()
      }
    )
  }

  detachParticipantPrivateChannel(eventId, anearParticipant) {
    const userId = anearParticipant.userId
    const channel = this._eventChannels[eventId].privates[userId]

    if (channel) {
      this.detachChannel(this._eventChannels[eventId].privates[userId])
      delete this._eventChannels[eventId].privates[userId]
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

  async setPrivatePublishingChannel(anearParticipant) {
    const privateChannel = this.getChannel(anearParticipant.privateChannelName)
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
        if (resultPage.items.length > 0) logger.info(resultPage.items.length + ` ${action} presence events received in page`)
        resultPage.items.filter(message => message.action === action).forEach(message => callback(message))
        // TODO: should resultPage.next() in a loop to iterate over all possible missed presence events
      }
    })
  }

  publishEventParticipantsMessage(eventId, message, timeoutMilliseconds=0, callback=null) {
    const channel = this._eventChannels[eventId].participants
    const payload = {content: message}
    let   timerCallback = null

    if (timeoutMilliseconds > 0) {
      payload.timeout = timeoutMilliseconds
      timerCallback = () => {
        this.setAllParticipantTimers(eventId, timeoutMilliseconds)
        if (callback) callback()
      }
    }

    this.publishChannelMessage(
      channel,
      PublicDisplayMessageType,
      payload,
      timerCallback
    )
  }

  publishEventSpectatorsMessage(eventId, message, callback=null) {
    const channel = this._eventChannels[eventId].spectators
    const payload = {content: message}

    this.publishChannelMessage(channel, PublicDisplayMessageType, payload, callback)
  }

  publishEventCssMessage(eventId, anearParticipant, message, callback) {
    logger.debug(`publishEventCssMessage(${eventId})`)
    this.publishEventPrivateMessage(eventId, anearParticipant, message, 0, callback, CssDisplayMessageType)
  }

  publishEventPrivateMessage(eventId, anearParticipant, message, timeoutMilliseconds=0, callback=null, messageType=PrivateDisplayMessageType) {
    const userId = anearParticipant.userId
    const channel = this._eventChannels[eventId].privates[userId]
    let timerCallback = null
    if (!channel) throw new Error(`private channel not found.  invalid user id ${userId}`)

    const payload = {content: message}

    if (timeoutMilliseconds > 0) {
      payload.timeout = timeoutMilliseconds
      timerCallback = () => {
        this.setParticipantTimer(eventId, anearParticipant, timeoutMilliseconds)
        if (callback) callback()
      }
    }

    this.publishChannelMessage(
      channel,
      messageType,
      payload,
      timerCallback
    )
  }

  publishEventTransitionMessage(eventId, newState, callback) {
    const channel = this._eventChannels[eventId].events
    const payload = {content: {state: newState}}

    logger.debug(`publishEventTransitionMessage: event ${eventId} transitioning to ${newState}`)

    this.publishChannelMessage(channel, EventTransitionMessageType, payload, callback)
  }

  async publishChannelMessage(channel, messageType, payload, callback) {
    channel.publish(
      messageType,
      payload,
      async err => {
        if (err) {
          this.logErrorInfo(err)
        } else if (callback) {
          await callback()
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
        if (resultPage.items.length > 0) {
          const messages = resultPage.items.filter(message => message.name === messageType)
          if (messages.length > 0) {
            logger.info(`${messages.length} ${messageType} history events received in page`)
            messages.forEach(message => callback(message))
          }
        }
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
