"use strict"
const EventEmitter = require('events').EventEmitter
const JsonApiResource = require('./JsonApiResource')
const logger = require('../utils/Logger')
const Participants = require('../utils/Participants')

const Refresh = 'refresh' // refresh participant event
const Spectator = 'spectators' // refresh the spectators display.  new spectator viewing
const PrivateDisplayMessageType  = 'private_display'

class AnearEvent extends JsonApiResource {

  constructor(json, messaging)  {
    super(json)

    this.emitter = new EventEmitter()
    this.messaging = messaging
    this.zone = this.findIncluded(this.relationships.zone)
    this.app = this.findIncluded(this.zone.relationships.app)

    this.participants = new Participants(json.participants)
  }

  toJSON() {
    return {
      ...super.toJSON(),
      participants: this.participants.toJSON(),
    }
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

  get state() {
    return this.attributes.state
  }

  get hosted() {
    return this.attributes.hosted
  }

  get participantTimeout() {
    return this.app.attributes["participant-timeout"]
  }

  on(eventName, listener) {
    this.emitter.on(eventName, listener)
  }

  emit(eventName, ...params) {
    this.emitter.emit(eventName, params)
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
    throw new Error('You must implement participantEnterEventCallback() in your AnearEvent sub-class');
  }

  async participantRefreshEventCallback(anearParticipant) {
    // You may implement participantRefreshEventCallback() in your AnearEvent sub-class
  }

  async spectatorRefreshEventCallback() {
    // You may implement spectatorRefreshEventCallback() in your AnearEvent sub-class
  }

  async participantCloseEventCallback(anearParticipant) {
    throw new Error('You must implement participantCloseEventCallback() in your AnearEvent sub-class');
  }

  async participantActionEventCallback(anearParticipant, actionEventName, message) {
    throw new Error('You must implement participantActionEventCallback() in your AnearEvent sub-class');
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
    // Called each time a participant ENTERs the ActionChannel.  This could be when joining
    // an event for the first time, rejoining, or after a browser refresh/reconnect
    // If the anearParticipant exists in this.participants, we call Refresh, else Enter
    // Invoke Enter/Refresh callbacks

    if (this.participants.exists(anearParticipant)) {
      logger.info(`participant ${anearParticipant.id} exists.  Refreshing...`)

      this.participants.add(this, anearParticipant) // update the participants entry
      await this.participantRefreshEventCallback(anearParticipant)
      await anearParticipant.update()
    } else {
      this.participants.add(this, anearParticipant) // add the participants entry
      await this.participantEnterEventCallback(anearParticipant)
      await anearParticipant.persist()
    }
  }

  async participantClose(anearParticipant) {
    //
    // this is invoked when a participant explicitly exits the event because
    // he no longer wants to participate
    //
    this.participants.purge(anearParticipant)
    await this.participantCloseEventCallback(anearParticipant)
    await anearParticipant.remove()
  }

  async participantAction(anearParticipant, actionEventName, actionPayload) {
    await this.participantActionEventCallback(anearParticipant, actionEventName, actionPayload)
  }

  async participantTimedOut(anearParticipant) {
    await this.participantTimedOutEventCallback(anearParticipant)
  }

  async eventBroadcast(message) {
    await this.eventBroadcastEventCallback(message)
  }

  async transitionEvent(eventName='next') {
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
    return !['closing', 'closed', 'canceled'].includes(this.state)
  }

  async transitionToAnnounce() {
    if (this.state === 'created') await this.transitionEvent('announce')
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
    this.emitter.removeAllListeners()
  }
}

module.exports = AnearEvent
