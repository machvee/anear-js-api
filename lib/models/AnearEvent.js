"use strict"
const AnearXstate = require('../utils/AnearXstate')
const { DefaultConfigFunc, DefaultOptionsFunc } = require('../utils/AnearXstateDefaults')

const JsonApiResource = require('./JsonApiResource')
const Participants = require('../utils/Participants')
const logger = require('../utils/Logger')

const PrivateDisplayMessageType  = 'private_display'

class AnearEvent extends JsonApiResource {

  constructor(json, messaging, stateMachineConfigFunc, stateMachineOptionsFunc) {
    super(json)

    this.messaging = messaging
    this.zone = this.findIncluded(this.relationships.zone)
    this.app = this.findIncluded(this.zone.relationships.app)
    this.participants = new Participants(json.participants)
    this.anearStateMachine = this.initStateMachine(json.previousStateName)
  }

  toJSON() {
    return {
      ...super.toJSON(),
      participants: this.participants.toJSON(),
      previousStateName: this.anearStateMachine.currentStateName
    }
  }

  stateMachineConfig(previousStateName) {
    // override in subclass with custom Xstate config
    return DefaultConfigFunc(this, previousStateName)
  }

  stateMachineOptions() {
    // override in subclass with custom Xstate options
    return DefaultOptionsFunc(this)
  }

  initStateMachine(previousStateName) {
console.log("initState:", previousStateName)
    return new AnearXstate(
      this.appData,
      this.stateMachineConfig(previousStateName),
      this.stateMachineOptions()
    )
  }

  get userId() {
    return this.relationships.user.data.id
  }

  get zoneId() {
    return this.relationships.zone.data.id
  }

  get clonedEventId() {
    const clonedEventData = this.relationships["cloned-event"].data
    return clonedEventData ? clonedEventData.id : null
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
    // can have its own appropriate timeout duration based on the app/game context.
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

  //
  // this Callbacks are the key overrides to define the behavior of your Anear App
  //
  async createdEventCallback(anearParticipantCreator) {
    // You may implement createdEventCallback() in your AnearEvent sub-class
  }

  async participantEnterEventCallback(anearParticipant) {
    throw new Error('You must implement an async participantEnterEventCallback() in your AnearEvent sub-class');
  }

  async participantRefreshEventCallback(anearParticipant) {
    // You may implement an async participantRefreshEventCallback() in your AnearEvent sub-class
  }

  async spectatorRefreshEventCallback() {
    // You may implement an async spectatorRefreshEventCallback() in your AnearEvent sub-class
  }

  async participantCloseEventCallback(anearParticipant) {
    throw new Error('You must implement an async participantCloseEventCallback() in your AnearEvent sub-class');
  }

  async participantActionEventCallback(anearParticipant, actionEventName, message) {
    throw new Error('You must implement an async participantActionEventCallback() in your AnearEvent sub-class');
  }

  async participantTimedOutEventCallback(anearParticipant) {
    // You may implement participantTimedOutEventCallback() in your AnearEvent sub-class'
  }

  async eventBroadcastEventCallback(message) {
    // You may implement eventBroadcastEventCallback() in your AnearEvent sub-class'
  }

  isParticipantEventCreator(anearParticipant) {
    return anearParticipant.userId === this.userId
  }
  async refreshParticipant(anearParticipant) {
    await this.participantRefreshEventCallback(anearParticipant)
  }

  async refreshSpectator() {
    await this.spectatorRefreshEventCallback()
  }

  async publishEventParticipantsMessage(message, timeoutMilliseconds=0, timeoutCallback=null) {
    await this.messaging.publishEventParticipantsMessage(
      this.id,
      this.activeParticipants,
      this.css,
      message,
      timeoutMilliseconds,
      timeoutCallback
    )
  }

  async publishEventSpectatorsMessage(message) {
    await this.messaging.publishEventSpectatorsMessage(this.id, this.css, message)
  }

  async publishEventPrivateMessage(anearParticipant, message, timeoutMilliseconds=0, timeoutCallback=null) {
    await this.messaging.publishEventPrivateMessage(
      this.id,
      anearParticipant,
      PrivateDisplayMessageType,
      this.css,
      message,
      timeoutMilliseconds,
      timeoutCallback
    )
  }

  async publishEventTransitionMessage(newState) {
    await this.messaging.publishEventTransitionMessage(
      this.id,
      newState
    )
  }

  async participantEnter(anearParticipant) {
    // Called each time a participant ENTERs (attaches to) the Event's Action Channel.
    // This could be when joining an event for the first time, rejoining, or after a browser
    // refresh/reconnect. If the anearParticipant exists in this.participants, we call Refresh,
    // else Enter Invoke Enter/Refresh callbacks
    if (this.participants.exists(anearParticipant)) {
      logger.info(`participant ${anearParticipant.id} exists.  Refreshing...`)

      this.participants.add(this, anearParticipant) // update the participants entry

      this.anearStateMachine.sendRefreshEvent({anearParticipant})

      await anearParticipant.update()
    } else {
      this.participants.add(this, anearParticipant) // add the participants entry

      this.anearStateMachine.sendJoinEvent({anearParticipant})

      await anearParticipant.persist()
    }
  }

  async participantClose(anearParticipant) {
    this.participants.purge(anearParticipant)

    this.anearStateMachine.sendCloseEvent({anearParticipant})

    await anearParticipant.remove()
  }

  participantAction(anearParticipant, actionEventName, actionPayload) {
    this.anearStateMachine.send(actionEventName, {anearParticipant, ...actionPayload})
  }

  participantTimedOut(anearParticipant) {
    this.anearStateMachine.sendTimeoutEvent({anearParticipant})
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
    logger.debug(`transitionEvent(${eventName})`)

    try {
      const responseAttributes = await this.messaging.api.transitionEvent(this.id, eventName)
      const newState = responseAttributes.state
      await this.messaging.publishEventTransitionMessage(this.id, newState)
    } catch(err) {
      logger.error(`transitionEvent error: ${err}`)
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
}

module.exports = AnearEvent
