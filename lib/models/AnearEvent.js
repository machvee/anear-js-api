"use strict"

const AnearXstate = require('../utils/AnearXstate')
const { DefaultConfigFunc, DefaultOptionsFunc } = require('../utils/AnearXstateDefaults')

const JsonApiResource = require('./JsonApiResource')
const Participants = require('../utils/Participants')
const logger = require('../utils/Logger')

const PrivateDisplayMessageType  = 'private_display'

class AnearEvent extends JsonApiResource {

  constructor(json, messaging) {
    super(json)

    this.messaging = messaging
    this.zone = this.findIncluded(this.relationships.zone)
    this.app = this.findIncluded(this.zone.relationships.app)
    this.participants = new Participants(json.participants)
    this.anearStateMachine = this.initStateMachine(json.previousState)
  }

  toJSON() {
    return {
      ...super.toJSON(),
      context: this.stateMachineContext,
      participants: this.participants.toJSON(),
      previousState: this.anearStateMachine.currentState
    }
  }

  startStateMachine() {
    this.anearStateMachine.startService()
  }

  stateMachineConfig() {
    // override in subclass with custom Xstate config
    return DefaultConfigFunc(this)
  }

  stateMachineOptions() {
    // override in subclass with custom Xstate options
    return DefaultOptionsFunc(this)
  }

  initStateMachine(previousState) {
    return new AnearXstate(
      this.stateMachineConfig(),
      this.stateMachineOptions(),
      previousState,
      this.context
    )
  }

  get userId() {
    return this.relationships.user.data.id
  }

  get zoneId() {
    return this.relationships.zone.data.id
  }

  async getClonedEvent() {
    // if the current event was a clone of previous event, try to fetch if from
    // Peristence and return
    const clonedEventData = this.relationships["cloned-event"].data
    if (!clonedEventData) return null

    const clonedEvent = await this.constructor.getFromStorage(clonedEventData.id)
    return clonedEvent
  }

  async clonedEventContext() {
    const clonedEvent = await this.getClonedEvent()

    return clonedEvent ? clonedEvent.context : null
  }

  get stateMachineContext() {
    // active XState context
    return this.anearStateMachine.context
  }

  get eventState() {
    return this.attributes.state
  }

  get hosted() {
    return this.attributes.hosted
  }

  get participantTimeout() {
    // TODO: This probably should be set for each publishEventPrivateMessage
    // and then referenceable as an anear-data attribute in the html.  That way
    // the App has explicit control over each interaction.  Each user game prompt
    // can have its own appropriate timeout duration based on the app/game
    // xStateContext/context.
    //
    // In the React Anear Browser, there is no local setTimer that calls back and
    // transitions the participant.  That will now be driven by the app and private
    // display messages.  For example, "Hey, wake up!!  Rejoin? (countdown 3...2....1)"
    // This allows on-premise game participants having a momentary distraction to rejoin
    // the game after a first timeout.
    return this.app.attributes["participant-timeout"]
  }

  hasFlag(flagName) {
    return this.attributes.flags.includes(flagName)
  }

  get css() {
    // override with a String of CSS to be sent with each publishEvent*Message
    // this will be compressed out of the initial publishEvent*Message
    // and will only be received by the client when the CSS changes.
    return null;
  }

  allowsSpectators() {
    return !this.hasFlag("no_spectators")
  }

  async createdEventCallback(participantCreator) {
    // You may implement createdEventCallback() in your AnearEvent sub-class
  }

  async participantEnterEventCallback(participant) {
    throw new Error('You must implement an async participantEnterEventCallback() in your AnearEvent sub-class');
  }

  async participantRefreshEventCallback(participant, remainingTimeout = null) {
    // You may implement an async participantRefreshEventCallback() in your AnearEvent sub-class
  }

  async spectatorRefreshEventCallback() {
    // You may implement an async spectatorRefreshEventCallback() in your AnearEvent sub-class
  }

  async participantCloseEventCallback(participant) {
    throw new Error('You must implement an async participantCloseEventCallback() in your AnearEvent sub-class');
  }

  async participantActionEventCallback(participant, actionEventName, message) {
    throw new Error('You must implement an async participantActionEventCallback() in your AnearEvent sub-class');
  }

  async participantTimedOutEventCallback(participant) {
    // You may implement participantTimedOutEventCallback() in your AnearEvent sub-class'
  }

  async eventBroadcastEventCallback(message) {
    // You may implement eventBroadcastEventCallback() in your AnearEvent sub-class'
  }

  isParticipantEventCreator(RParticipant) {
    return participant.userId === this.userId
  }
  async refreshParticipant(participant) {
    await this.participantRefreshEventCallback(participant)
  }

  async refreshSpectator() {
    await this.spectatorRefreshEventCallback()
  }

  async publishEventParticipantsMessage(message, timeoutMsecs=0) {
    await this.messaging.publishEventParticipantsMessage(
      this,
      this.participants.active(),
      this.css,
      message,
      timeoutMsecs
    )
  }

  async publishEventSpectatorsMessage(message) {
    await this.messaging.publishEventSpectatorsMessage(this, this.css, message)
  }

  async publishEventPrivateMessage(participant, message, timeoutMsecs=0) {
    await this.messaging.publishEventPrivateMessage(
      this,
      participant,
      PrivateDisplayMessageType,
      this.css,
      message,
      timeoutMsecs
    )
  }

  async publishEventTransitionMessage(newState) {
    await this.messaging.publishEventTransitionMessage(
      this,
      newState
    )
  }

  async participantEnter(participant) {
    // Called each time a participant ENTERs (attaches to) the Event's Action Channel.
    // This could be when joining an event for the first time, rejoining, or after a browser
    // refresh/reconnect. If the participant exists in this.participants, we call Refresh,
    // else Enter Invoke Enter/Refresh callbacks
    if (this.participants.exists(participant)) {
      logger.info(`AnearEvent: participant ${participant.id} exists.  Refreshing...`)

      this.participants.add(this, participant) // update the participants entry

      this.anearStateMachine.sendRefreshEvent({ participant })

      await participant.update()
    } else {
      this.participants.add(this, participant) // add the participants entry

      this.anearStateMachine.sendJoinEvent({ participant })

      await participant.persist()
    }
  }

  async participantClose(participant) {
    this.participants.purge(participant)

    this.anearStateMachine.sendCloseEvent({ participant })

    await participant.remove()
  }

  participantAction(participant, actionEventName, actionPayload) {
    this.anearStateMachine.sendActionEvent(actionEventName, {participant, payload: actionPayload})
  }

  participantTimedOut(participant) {
    this.anearStateMachine.sendTimeoutEvent({ participant })
  }

  cancelParticipantTimers() {
    this.messaging.resetAllParticipantTimers()
  }

  async eventBroadcast(message) {
    await this.eventBroadcastEventCallback(message)
  }

  async transitionEvent(eventName='next') {
    //
    // Allows the app/game to transition the remote AnearEvent which can un/hide and event
    // and change its discoverability by mobile web users.  Apps can also determine when
    // and how many mobile-app users can join and event.
    //
    // 1. send the transition event to the Anear API
    // 2. get back the event newState from Anear API response
    // 3. publish the new Event State to all subscribers (e.g. participants)
    //
    logger.debug(`AnearEvent: transitionEvent(${eventName})`)

    try {
      const responseAttributes = await this.messaging.api.transitionEvent(this.id, eventName)
      const newState = responseAttributes.state
      this.attributes.state = newState
      await this.messaging.publishEventTransitionMessage(this, newState)
    } catch(err) {
      logger.error(`AnearEvent: transitionEvent error: ${err}`)
    }
  }

  isPlayable() {
    return !['closing', 'closed', 'canceled'].includes(this.eventState)
  }

  async transitionToAnnounce() {
    if (this.eventState === 'created') await this.transitionEvent('announce')
  }

  async transitionNextNext() {
    await this.transitionEvent('next')
    await this.transitionEvent('next')
  }

  async transitionLive() {
    await this.transitionNextNext()
  }

  async transitionClosed() {
    await this.transitionNextNext()
  }

  async transitionCanceled() {
    await this.transitionEvent('cancel')
  }

  eventChannelName () {
    return this.getChannelName('event')
  }

  participantsChannelName () {
    return this.getChannelName('participants')
  }

  actionsChannelName () {
    return this.getChannelName('actions')
  }

  spectatorsChannelName () {
    return this.getChannelName('spectators')
  }

  getChannelName (key) {
    return this.attributes[`${key}-channel-name`]
  }

  async closeMessaging () {
    await this.messaging.detachAll(this.id)
  }

  logMessage(...args) {
    logger.info(...args)
  }

  logError(context, event) {
    logger.error("XState: ERROR: ", event.data)
  }
}

module.exports = {
  AnearEvent,
  logger
}
