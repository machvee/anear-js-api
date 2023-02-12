"use strict"
const Ably = require('ably/promises')
const AnearApi = require('../api/AnearApi')
const logger = require('../utils/Logger')

const AppId = process.env.ANEARAPP_APP_ID

const BroadcastMessageType       = 'broadcast'
const PublicDisplayMessageType   = 'public_display'
const PrivateDisplayMessageType  = 'private_display'
const ActionMessageType          = 'client_action'
const CreateEventMessageType     = 'create_event'
const ExitEventMessageType       = 'exit_event'
const EventTransitionMessageType = 'event_transition'

const PRESENCE_ENTER = 'enter'
const PRESENCE_LEAVE = 'leave'
const ALREADY_PRESENT = 'present'

const DEFAULT_MESSAGING_IDLE_TIMEOUT_MSECS = 30000

const ChannelParams = {params: {rewind: "5s"}}


// 0 - no logging, 4 - verbose logging
const AblyLogLevel = process.env.ANEARAPP_ABLY_LOG_LEVEL || 0

const AnearCreateEventChannelName = `anear:${AppId}:e`

class AnearMessaging {
  constructor(AnearEventClass, AnearParticipantClass) {
    this.api = new AnearApi(
      process.env.ANEARAPP_API_KEY,
      process.env.ANEARAPP_API_VERSION
    )
    this.AnearEventClass = AnearEventClass
    this.AnearParticipantClass = AnearParticipantClass
    this.anearEvents = {}
    this.eventChannels = {}
    this.realtime = null

    const baseUrl          = this.api.api_base_url
    const authUrl          = `${baseUrl}/messaging_auth`
    const authParams       = {
      "app-id":AppId
    }
    const anearAuthHeaders = {
      ...this.api.defaultHeaderObject
    }
    const transportParams = {
      heartbeatInterval: (process.env.ANEARAPP_API_HEARTBEAT_INTERVAL_SECONDS*1000) ||
        DEFAULT_MESSAGING_IDLE_TIMEOUT_MSECS
    }

    const clientOptions = {
      authUrl: authUrl,
      authHeaders: anearAuthHeaders,
      authParams,
      transportParams,
      echoMessages: false,
      log: {
        level: AblyLogLevel,
        handler: message => {logger.debug(message)}
      }
    }

    this.initRealtime(clientOptions)
  }

  initRealtime(clientOptions) {
    logger.debug("new Ably.Realtime connection..., log level: ", AblyLogLevel)

    this.realtime = new Ably.Realtime.Promise(clientOptions)

    const connectedCallback = async () => {
      if (!this.realtime) {
        logger.debug("Reconnecting after messaging idle period...")
        return
      }

      await this.getAppInfo(AppId)
      logger.debug("Ably connected!")
      await this.setupCreateEventChannel()
      // await this.reloadAnyEventsInProgress(AppId) WHEN THIS WORKS or IS IMPORTANT...FIX!
    }

    this.realtime.connection.on("connected", connectedCallback)
  }

  async getAppInfo(appId) {
    // fetch the App info from the Anear API
    const anearApp = await this.api.getApp(appId)

    logger.debug("================")
    logger.debug(`STARTING APP ${anearApp.data.attributes['short-name']}`)
    logger.debug("================")
  }

  getChannel(channelName, channelParams = ChannelParams) {
    return this.realtime.channels.get(channelName, channelParams)
  }

  getAnearEventFromStorage(eventId) {
    return this.AnearEventClass.getFromStorage(eventId, this)
  }

  getAnearParticipantFromStorage(participantId) {
    return this.AnearParticipantClass.getFromStorage(participantId, this)
  }

  async initEventRealtimeMessaging(anearEvent) {

    if (this.eventChannels.hasOwnProperty(anearEvent.id)) {
      logger.debug(`initEventRealtimeMessaging(${anearEvent.id}) already initialized.`)
      return
    }

    this.eventChannels[anearEvent.id] = {privates: {}}

    await this.setupSpectatorsChannel(anearEvent)
    this.setupEventsChannel(anearEvent)
    await this.setupParticipantsChannel(anearEvent)
    await this.setupActionsChannel(anearEvent)

    logger.debug(`initEventRealtimeMessaging(${anearEvent.id}) is complete`)

    return anearEvent
  }

  async createEventMessagingCallback(message) {
    //
    // create the AnearEvent subclass, persist it in storage, and
    // initialize its realtime messaging
    //
    logger.debug(`createEventMessagingCallback(${message.name})`)

    const eventJson = JSON.parse(message.data)
    const anearEvent = new this.AnearEventClass(eventJson, this)

    //
    // if we are getting this event create message from history after a quick restart,
    // we just return if the event already exists
    //
    const eventExists = await anearEvent.exists()

    logger.debug(
      `Event ${anearEvent.id} ${eventExists ? "already exists" : "does not exist"} in Storage`
    )

    let loadedEvent = anearEvent

    if (!eventExists) {
      const messagingInitializedCallback = async () => {
        await anearEvent.persist()
        // start the state machine before initializing Realtime Messaging
        // as REFRESH events come in and the state machine should be ready
        // to handle those XState events
        anearEvent.startStateMachine()
        await this.initEventRealtimeMessaging(anearEvent)
      }

      await anearEvent.runExclusive(
        `createEventCallback ${anearEvent.id}`,
        messagingInitializedCallback
      )
    } else {
      loadedEvent = await this.getAnearEventFromStorage(anearEvent.id)
      await this.initEventRealtimeMessaging(loadedEvent)
      loadedEvent.startStateMachine()
    }

    logger.debug(`New ${loadedEvent.constructor.name} Event: `, loadedEvent.toJSON())

    this.anearEvents[loadedEvent.id] = loadedEvent
  }

  async reloadAnyEventsInProgress(appId) {
    const anearApp = await this.api.getAppZones(appId)

    for (const zone of anearApp.data.relationships.zones.data) {
      const zoneEvents = await this.api.getZoneEvents(zone.id)
      const events = zoneEvents.data.relationships.events.data

      for (const eventData of events) {
        const eventJson = await this.api.getEvent(eventData.id)
        const anearEvent = new this.AnearEventClass(eventJson, this)
        await this.initEventRealtimeMessaging(anearEvent)

        const attachedParticipants = await this.getPresentParticipants(anearEvent)
        // TBD: might want to change the attach and presence logic on
        // the actions channel.   The Ably docs show subscribing to the
        // presence events on the actions channel, and instead of using History,
        // it does a get() to fetch all of the current members.   This behavior
        // is useful for both event start, and event restart within this function
        // anearEvent.startStateMachine()
        //
      }
    }
  }

  async setupCreateEventChannel() {
    logger.debug(`attaching to channel ${AnearCreateEventChannelName}`)

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
      async message => await this.spectatorViewMessagingCallback(anearEvent, message)
    )

    this.subscribePresenceEvent(
      spectatorsChannel,
      PRESENCE_LEAVE,
      async message => await this.spectatorLeaveMessagingCallback(anearEvent, message)
    )
  }

  async getSpectatorCount(anearEvent) {
    if (!anearEvent.allowsSpectators()) return 0

    const channel = this.eventChannels[anearEvent.id].spectators
    const members = await channel.presence.get()
    return members.length
  }

  getPresentParticipants(anearEvent) {
    // returns the participant presence data for each member who is present on
    // the event's actions channel
    const channel = this.eventChannels[anearEvent.id].actions
    return channel.presence.get() // returns Promise
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
      async (anearEvent, participant) => {
        await anearEvent.participantExit(participant)
      }
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

  async processParticipantEnter(anearEvent, participantId, geoLocation = null) {

    logger.debug(`processing Participant Enter for event: ${anearEvent.id}, participant: ${participantId}`)
    //
    // get the participant data from the API (this will also validate the participant).
    // check if the participant is already in storage, and if so, instantiate, else
    // instantiate from API response
    //
    const participantJson = await this.api.getEventParticipantJson(participantId)
    const participant = new this.AnearParticipantClass(participantJson, anearEvent)

    const persistedAnearParticipant = await this.AnearParticipantClass.getFromStorage(participantId, anearEvent)

    if (persistedAnearParticipant) {
      participant.context = persistedAnearParticipant.context
    }

    await anearEvent.runExclusive(`participantEnterCallback ${participant.id}`, async () => {
      participant.geoLocation = geoLocation

      await this.setupPrivatePublishingChannel(participant)
      await anearEvent.participantEnter(participant)
      await anearEvent.update()
    })
  }

  spectatorViewMessagingCallback(anearEvent, message) {
    const userId = message.clientId
    logger.debug(`**** ENTER SPECTATOR FOR VIEWING ****  event: ${anearEvent.id}, user: ${userId}`)

    anearEvent.spectatorView(userId)
  }

  async spectatorLeaveMessagingCallback(anearEvent, message) {
    const userId = message.clientId
    logger.debug(`**** LEAVE SPECTATOR ****  event: ${anearEvent.id}, user: ${userId}`)
  }

  async participantLeaveMessagingCallback(anearEvent, message) {
    // this can be just a temporary leave from a participant refreshing their browser.
    // currently, no action taken
    const userId = message.clientId
    const participantId = message.data.id

    logger.debug(`**** LEAVE PARTICIPANT ****  participantLeaveMessagingCallback(participant: ${participantId})`)
  }

  async closeParticipant(anearEvent, participantId, callback = null) {
    // closes out a single Participant.   This is invoked when a single
    // participant leaves an event, and the event may possibly continue,
    // or possibly exit.  Or this may be called by the event when exiting
    // and cleaning out any remaining participants.  Note: The participant
    // can will no longer be able to have their display updated
    logger.debug(`closeParticipant(${participantId})`)

    const participant = anearEvent.participants.getById(participantId)

    if (participant) {
      participant.destroyTimer()

      await this.detachParticipantPrivateChannel(anearEvent.id, participant)

      await anearEvent.runExclusive(`closeParticipant ${participant.id}`, async () => {
        if (callback) {
          await callback(anearEvent, participant)
        }
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

    const participant = anearEvent.participants.getById(participantId)

    participant.resetTimer() // participant responded in time, reset any running timer

    logger.debug(`participantActionMessagingCallback(${anearEvent.id}, ${participantId})`)

    const actionJSON = JSON.parse(payload)
    const [actionEventName, actionPayload] = Object.entries(actionJSON)[0]

    await anearEvent.runExclusive(`participantActionCallback ${participant.id}`, async () => {
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

  attachChannel(channel) {
    return channel.attach()
  }

  subscribeEventMessages(channel, messageType, callback) {
    channel.subscribe(messageType, callback)
    logger.debug(`subscribed to ${messageType} messages on ${channel.name}`)
  }

  subscribePresenceEvent(channel, action, callback) {
    channel.presence.subscribe(action, callback)
  }

  async subscribePresenceEventWithHistory(channel, action, callback) {
    logger.debug(`subscribePresenceEvents(${action}) for channel ${channel.name}`)

    this.subscribePresenceEvent(channel, action, callback)

    const history = await channel.presence.history({limit: 25})

    history.items.filter(message => message.action === action).forEach(
      async message => {
        logger.debug(`presence history ${action} event received`, message)
        await callback(message)
      }
    )
  }

  // you can pass in timeout params if you want the spectator display
  // to show current anear-timer status
  publishEventSpectatorsMessage(anearEvent, css, message, timeoutMsecs = 0, timeRemaining = 0) {

    const channel = this.eventChannels[anearEvent.id].spectators

    return this.publishMessage(
      channel,
      PublicDisplayMessageType,
      css,
      message,
      timeoutMsecs,
      timeRemaining
    )
  }

  setMultipleParticipantTimers(participants, timeoutMsecs) {
    if (timeoutMsecs === 0) return [() => {}, 0]

    const participantTimers = []

    participants.forEach(
      participant => {
        const [startTimer, _timeRemaining] = participant.ensureTimer(timeoutMsecs)
        participantTimers.push(startTimer)
      }
    )
    const startTimers = () => participantTimers.forEach(startTimer => startTimer())
    return [startTimers, timeoutMsecs]
  }

  publishEventParticipantsMessage(anearEvent, participants, css, message, timeoutMsecs=0) {
    const eventId = anearEvent.id
    const channel = this.eventChannels[eventId].participants

    const [startTimers, timeRemaining] = this.setMultipleParticipantTimers(participants, timeoutMsecs)

    const promise = this.publishMessage(
      channel,
      PublicDisplayMessageType,
      css,
      message,
      timeoutMsecs,
      timeRemaining
    )

    startTimers()

    return promise
  }

  publishEventPrivateMessage(
          anearEvent,
          participant,
          css,
          message,
          timeoutMsecs=0) {

    const userId = participant.userId
    const channel = this.eventChannels[anearEvent.id].privates[userId]
    if (!channel) throw new Error(`private channel not found.  invalid user id ${userId}`)

    const [startTimer, timeRemaining] = participant.ensureTimer(timeoutMsecs)

    const promise = this.publishMessage(
      channel,
      PrivateDisplayMessageType,
      css,
      message,
      timeoutMsecs,
      timeRemaining
    )

    startTimer()

    return promise
  }

  publishMessage(
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

    return this.publishChannelMessage(
      channel,
      messageType,
      payload
    )
  }

  publishEventTransitionMessage(anearEvent, newState) {
    const channel = this.eventChannels[anearEvent.id].events
    const payload = {content: {state: newState}}

    logger.debug(`publishEventTransitionMessage: event ${anearEvent.id} transitioning to ${newState}`)

    return this.publishChannelMessage(channel, EventTransitionMessageType, payload)
  }

  publishChannelMessage(channel, messageType, payload) {
    return channel.publish(
      messageType,
      payload
    )
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

    await channel.detach(this.logErrorInfo)
    logger.debug(`channel ${channel.name} detached`)
  }

  logErrorInfo(errInfo) {
    if (errInfo) {
      logger.error("Ably ERROR:", errInfo)
    }
  }
}

module.exports = AnearMessaging
