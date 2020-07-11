"use strict"
const EventEmitter = require('events').EventEmitter
const JsonApiResource = require('./JsonApiResource')
const logger = require('../utils/Logger')

const Refresh = 'refresh' // refresh participant event
const Spectator = 'spectators' // refresh the spectators display.  new spectator viewing

class AnearEvent extends JsonApiResource {

  constructor(json, messaging)  {
    super(json)

    this.emitter = new EventEmitter()
    this.messaging = messaging
    this.zone = this.findIncluded(this.relationships.zone)
    this.app = this.findIncluded(this.zone.relationships.app)
    this.participants = json.participants || {}
  }

  toJSON() {
    return {
      ...super.toJSON(),
      participants: this.participants,
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

  formatDisplayPayload(html, css=null) {
    const payload = { html }
    if (css) {
      payload["css"] = css
    }
    return payload
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

  hasParticipant(anearParticipant) {
    return this.participants.hasOwnProperty(anearParticipant.id)
  }

  getEventParticipantById(anearParticipantId) {
    return this.participants[anearParticipantId]
  }

  getEventParticipant(anearParticipant) {
    return this.getEventParticipantById(anearParticipant.id)
  }

  removeParticipant(anearParticipant) {
    delete this.participants[anearParticipant.id]
  }

  addParticipant(anearParticipant) {
    this.participants[anearParticipant.id] = anearParticipant.identity
  }

  numParticipants() {
    return Object.keys(this.participants).length
  }

  async refreshParticipant(anearParticipant) {
    await this.participantRefreshEventCallback(anearParticipant)
  }

  async refreshSpectator() {
    await this.spectatorRefreshEventCallback()
  }

  publishEventParticipantsMessage(message, timeoutMilliseconds=0, callback=null) {
    return this.messaging.publishEventParticipantsMessage(
      this.id,
      message,
      timeoutMilliseconds,
      callback
    )
  }

  publishEventSpectatorsMessage(message, callback=null) {
    return this.messaging.publishEventSpectatorsMessage(
      this.id,
      message,
      callback
    )
  }

  publishEventPrivateMessage(anearParticipant, message, timeoutMilliseconds=0, callback=null) {
    return this.messaging.publishEventPrivateMessage(
      this.id,
      anearParticipant.userId,
      message,
      timeoutMilliseconds,
      callback
    )
  }

  publishEventTransitionMessage(newState, callback) {
    return this.messaging.publishEventTransitionMessage(
      this.id,
      newState,
      callback
    )
  }

  async participantEnter(anearParticipant) {
    // Called each time a participant ENTERs the ActionChannel.  This could be when joining
    // an event for the first time, rejoining, or after a browser refresh/reconnect
    // If the anearParticipant exists in this.participants, we call Refresh, else Enter

    if (this.hasParticipant(anearParticipant)) {
      logger.info(`participant ${anearParticipant.id} exists.  Refreshing...`)

      this.addParticipant(anearParticipant) // update the participants entry
      await this.participantRefreshEventCallback(anearParticipant)
      await anearParticipant.update()
    } else {
      this.addParticipant(anearParticipant)
      await this.participantEnterEventCallback(anearParticipant)
      await anearParticipant.persist()
    }
  }

  async participantClose(anearParticipant) {
    //
    // this is invoked when a participant explicitly exits the event because
    // he no longer wants to participate
    //
    await this.participantCloseEventCallback(anearParticipant)
    this.removeParticipant(anearParticipant)
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

  async transitionEvent(eventName='next', callback) {
    //
    // 1. send the transition event to the Anear API
    // 2. get back the event newState from Anear API response
    // 3. publish the new Event State to all subscribers (e.g. participants)
    //
    logger.debug(`transitionEvent(${eventName})`)
    try {
      const responseAttributes = await this.messaging.api.transitionEvent(this.id, eventName)
      const newState = responseAttributes.state
      this.messaging.publishEventTransitionMessage(this.id, newState, callback)
    } catch(err) {
      logger.error(`transitionEvent error: ${err}`)
      if (callback) callback(err)
    }
  }

  isPlayable() {
    return !['closing', 'closed', 'canceled'].includes(this.state)
  }

  async transitionToAnnounce(callback) {
    if (this.state === 'created') {
      await this.transitionEvent('announce', callback)
    }
  }

  async transitionNextNext(callback) {
    await this.transitionEvent('next')
    await this.transitionEvent('next', callback)
  }

  transitionLive(callback) {
    this.transitionNextNext(callback)
  }

  transitionClosed(callback) {
    this.transitionNextNext(callback)
  }

  async transitionCanceled(callback) {
    await this.transitionEvent('cancel', callback)
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

  closeMessaging () {
    this.messaging.detachAll(this.id)
    this.emitter.removeAllListeners()
  }
}

module.exports = AnearEvent
