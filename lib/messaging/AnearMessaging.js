"use strict"
const Ably = require('ably/promises')
const AnearApi = require('../api/AnearApi')
const ParticipantTimer = require('../utils/ParticipantTimer')
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
const ALREADY_PRESENT = 'present'

const ChannelParams = {params: {rewind: "5s"}}


const AblyLogLevel = process.env.ANEARAPP_ABLY_LOG_LEVEL || 0 // 0 - no logging, 4 - verbose logging
const AnearCreateEventChannelName = `anear:${AppId}:e`

class AnearMessaging {
  constructor(AnearEventClass, AnearParticipantClass) {
    this.api = new AnearApi()
    this.AnearEventClass = AnearEventClass
    this.AnearParticipantClass = AnearParticipantClass
    this.mutex = new Mutex()
    this.anearEvents = {}

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
        handler: message => {logger.debug(message)}
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
        await this.getAppInfo(AppId)
        logger.info("Ably connected!")
        await this.setupCreateEventChannel()
        await this.reloadAnyEventsInProgress(AppId)
      }
    )
  }

  async getAppInfo(appId) {
    const anearApp = await this.api.getApp(appId)
    logger.info("================")
    logger.info(`STARTING APP ${anearApp.data.attributes['short-name']}`)
    logger.info("================")
  }

  getChannel(channelName, channelParams = ChannelParams) {
    return this.realtime.channels.get(channelName, channelParams)
  }

  ensureParticipantTimer(anearEvent, participant, timeoutMsecs) {
    // this is called when a new timer is being started for a privateMessage
    // sent to a participant, or public message to all participants
    // If the timer already exists and is paused, it is resumed with the timeRemaining
    // [a starter function, timeRemaining] is returned 
    let timeRemaining = timeoutMsecs
    let timerStarter = () => {}

    if (timeoutMsecs > 0) {
      const timer = this.participantTimers[participant.id] || this.createTimer(anearEvent, participant, timeoutMsecs)

      if (timer.isRunning) {
        timeRemaining = timer.interrupt()
      } else {
        timerStarter = () => timer.start(timeoutMsecs)
      }
    }
    logger.debug(`ensureParticipant(timeRemaining: ${timeRemaining})`)

    return [timerStarter, timeRemaining]
  }

  createTimer(anearEvent, participant, timeoutMsecs) {
    const timer = new ParticipantTimer(
      participant.id,
      async () => await this.timerExpired(anearEvent, participant, timeoutMsecs)
    )
    this.participantTimers[participant.id] = timer

    return timer
  }

  destroyParticipantTimer(participantId) {
    // participant will not be receiving any more display messages
    // so we close out and delete the ParticipantTimer
    const timer = this.participantTimers[participantId]

    if (timer) {
      timer.reset()
      delete this.participantTimers[participantId]
    }
  }

  interruptParticipantTimer(participantId) {
    const timer = this.participantTimers[participantId]

    if (timer && timer.isRunning) timer.interrupt()
  }

  resetParticipantTimer(participantId) {
    // called after participant takes Action before timer expires
    const timer = this.participantTimers[participantId]
    if (timer) timer.reset()
  }

  async timerExpired(anearEvent, participant, timeoutMsecs) {
    logger.debug(`participant (${anearEvent.id}, ${participant.id}) TIMED OUT after ${timeoutMsecs} msecs`)

    delete this.participantTimers[participant.id]

    await anearEvent.participantTimedOut(participant)
    await anearEvent.update()
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
    logger.info(`createEventMessagingCallback(${message.name})`)

    try {
      const eventJson = JSON.parse(message.data)
      const anearEvent = new this.AnearEventClass(eventJson, this)

      //
      // if we are getting this event create message from history after a quick restart,
      // we just return if the event already exists
      //
      await this.loadOrPersistEventAndInitialize(anearEvent)

    } catch(err) {
      logger.error(err)
    }
  }

  async loadOrPersistEventAndInitialize(anearEvent) {
    const eventExists = await anearEvent.exists()

    logger.info(`Event ${anearEvent.id} ${eventExists ? "already exists" : "does not exist"} in Storage`)

    let loadedEvent = anearEvent

    if (!eventExists) {
      await this.runExclusive("createEventCallback", async () => {
        await anearEvent.createdEventCallback()
        await anearEvent.persist()
        // start the state machine before initialiing Realtime Messaging
        // as REFRESH events come in and the state machine should be ready
        // to handle those XState events
        anearEvent.startStateMachine()
        await this.initEventRealtimeMessaging(anearEvent)
      })
    } else {
      loadedEvent = await this.getAnearEventFromStorage(anearEvent.id)
      await this.initEventRealtimeMessaging(loadedEvent)
      loadedEvent.startStateMachine()
    }

    logger.info(`New ${loadedEvent.constructor.name} Event: `, loadedEvent.toJSON())

    this.anearEvents[loadedEvent.id] = loadedEvent

    return loadedEvent
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
          // THIS does NOT work yet.  This is logic that restarte events in progress
          // if the nodeJS process crahsed during play
          //
          // const loadedEvent = await this.loadOrPersistEventAndInitialize(anearEvent)
          // await this.refreshActiveParticipants(loadedEvent) DOES NOT WORK YET
        }
      }
    } catch (err) {
      logger.error(err)
    }
  }

  async refreshActiveParticipants(anearEvent) {
    const allParticipants = anearEvent.participants.active

    return Promise.all(
      allParticipants.map(
        participant => this.processParticipantEnter(
          anearEvent,
          participant.id,
          participant.geoLocation
        )
      )
    )
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

    this.subscribePresenceEvent(
      actionsChannel,
      PRESENCE_ENTER,
      async message => await this.participantEnterMessagingCallback(anearEvent, message)
    )
    this.subscribePresenceEvent(
      actionsChannel,
      ALREADY_PRESENT,
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

    await this.closeParticipant(
      anearEvent,
      participantId,
      (anearEvent, participant) => anearEvent.participantClose(participant)
    )
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

    await this.processParticipantEnter(anearEvent, participantId, geoLocation)
  }

  async processParticipantEnter(anearEvent, participantId, geoLocation) {

    logger.debug(`processing Participant Enter for event: ${anearEvent.id}, participant: ${participantId}`)
    //
    // get the participant data from the API (this will also validate the participant).
    // check if the participant is already in storage, and if so, instantiate, else
    // instantiate from API response
    //
    try {
      const participantJson = await this.api.getEventParticipantJson(participantId)
      const participant = new this.AnearParticipantClass(participantJson)

      participant.geoLocation = geoLocation

      const persistedAnearParticipant = await this.AnearParticipantClass.getFromStorage(participantId)

      if (persistedAnearParticipant) {
        participant.context = persistedAnearParticipant.context
      }

      await this.runExclusive("participantEnterCallback", async () => {
        await this.setupPrivatePublishingChannel(participant)
        await anearEvent.participantEnter(participant)
        await anearEvent.update()
      })
    } catch(error) {
      // participant not found or is not currently marked active at the API service
      // don't allow participation.  FIX: we need to publish to the private channel
      // with an error message type.
      logger.error(`processParticipanEnter(${anearEvent.id}, ${participantId}) error: `, error)
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
    // this can be just a temporary leave (refresh browser for example), so pause any participant timers
    const userId = message.clientId
    const participantId = message.data.id

    logger.debug(`**** LEAVE PARTICIPANT ****  participantLeaveMessagingCallback(participant: ${participantId})`)

    this.interruptParticipantTimer(participantId)
  }

  async closeParticipant(anearEvent, participantId, callback) {
    logger.debug(`closeParticipant(${participantId})`)

    this.destroyParticipantTimer(participantId)

    const participant = await this.getAnearParticipantFromStorage(participantId)

    if (participant) {
      await this.detachParticipantPrivateChannel(anearEvent.id, participant)

      await this.runExclusive("closeParticipant", async () => {
        await callback(anearEvent, participant)
        await anearEvent.update()
      })
    }
  }

  async detachParticipantPrivateChannel(eventId, participant) {
    const userId = participant.userId
    const channel = this.eventChannels[eventId].privates[userId]

    if (channel) {
      await this.detachChannel(this.eventChannels[eventId].privates[userId])
      delete this.eventChannels[eventId].privates[userId]
    }
  }

  async participantActionMessagingCallback(anearEvent, message) {
    // e.g. message.data
    //   {
    //     participantId: "93387343489",
    //     payload: "{"reviewResponse":{"questionId": "ab88373ccf", "decision":"approved"}}"
    //   }
    //
    //   actionEventName => "reviewResponse"
    //   actionPayload => {questionId: "ab88373ccf", decision:"approved"}
    //
    const participantId = message.data.participantId
    const payload = message.data.payload

    this.resetParticipantTimer(participantId) // participant responded in time, reset any running timer

    logger.debug(`participantActionMessagingCallback(${anearEvent.id}, ${participantId})`)

    const actionJSON = JSON.parse(payload)
    const [actionEventName, actionPayload] = Object.entries(actionJSON)[0]

    const participant = await this.getAnearParticipantFromStorage(participantId)

    await this.runExclusive("participantActionCallback", async () => {
      await anearEvent.participantAction(participant, actionEventName, actionPayload)
      await anearEvent.update()
      await participant.update()
    })
  }

  async eventBroadcastMessagingCallback(anearEvent, message) {
    logger.debug(`eventBroadcaseMessagingCallback(${anearEvent.id}`)

    await anearEvent.eventBroadcast(message)
    await anearEvent.update()
  }

  async setupPrivatePublishingChannel(participant) {
    const privateChannel = this.getChannel(participant.privateChannelName, {})
    this.eventChannels[participant.eventId].privates[participant.userId] = privateChannel
    await this.attachChannel(privateChannel)

    logger.debug(`setupPrivatePublishingChannel(${participant.privateChannelName}) state ${privateChannel.state}`)
  }

  async attachChannel(channel) {
    try {
      return await channel.attach()
    } catch(err) {
      this.logErrorInfo(err)
    }
  }

  async runExclusive(name, callback) {
    logger.debug(`waiting for ${name} mutex`)

    await this.mutex.runExclusive(
      async () => {
        logger.debug(`mutex ${name} locked!`)
        await callback()
      }
    )
    logger.debug(`mutex ${name} released!`)
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

  async publishEventSpectatorsMessage(anearEvent, css, message, messageType = PublicDisplayMessageType) {
    const channel = this.eventChannels[anearEvent.id].spectators
    const payload = {
      css: css,
      content: message
    }

    await this.publishChannelMessage(channel, messageType, payload)
  }

  setMultipleParticipantTimers(anearEvent, participants, timeoutMsecs) {
    if (timeoutMsecs === 0) return [() => {}, 0]

    const participantTimers = []

    participants.forEach(
      participant => {
        const [startTimer, _timeRemaining] = this.ensureParticipantTimer(anearEvent, participant, timeoutMsecs)
        participantTimers.push(startTimer)
      }
    )
    const startTimers = () => participantTimers.forEach(startTimer => startTimer())
    return [startTimers, timeoutMsecs]
  }

  async publishEventParticipantsMessage(anearEvent, participants, css, message, timeoutMsecs=0) {
    const eventId = anearEvent.id
    const channel = this.eventChannels[eventId].participants

    const [startTimers, timeRemaining] = this.setMultipleParticipantTimers(eventId, participants, timeoutMsecs)

    await this.publishMessage(
      channel,
      PublicDisplayMessageType,
      css,
      message,
      timeoutMsecs,
      timeRemaining
    )
    startTimers()
  }

  async publishEventPrivateMessage(
          anearEvent,
          participant,
          messageType,
          css,
          message,
          timeoutMsecs=0) {

    const userId = participant.userId
    const channel = this.eventChannels[anearEvent.id].privates[userId]
    if (!channel) throw new Error(`private channel not found.  invalid user id ${userId}`)

    const [startTimer, timeRemaining] = this.ensureParticipantTimer(anearEvent, participant, timeoutMsecs)

    await this.publishMessage(
      channel,
      messageType,
      css,
      message,
      timeoutMsecs,
      timeRemaining
    )
    startTimer()
  }

  async publishMessage(
          channel,
          messageType,
          css,
          message,
          timeoutMsecs,
          timeRemaining) {

    const payload = {
      css: css,
      content: message,
      timeout: { timeoutMsecs, timeRemaining }
    }

    logger.debug(`publishMessage(timeoutMsecs=${timeoutMsecs}}, timeRemaining=${timeRemaining})`)

    await this.publishChannelMessage(
      channel,
      messageType,
      payload
    )
  }

  async publishEventTransitionMessage(anearEvent, newState) {
    const channel = this.eventChannels[anearEvent.id].events
    const payload = {content: {state: newState}}

    logger.debug(`publishEventTransitionMessage: event ${anearEvent.id} transitioning to ${newState}`)

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

    delete this.anearEvents[eventId]
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
