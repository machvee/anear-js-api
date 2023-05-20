"use strict"

const { Mutex } = require('async-mutex')

const JsonApiResource = require('./JsonApiResource')
const Participants = require('../utils/Participants')
const logger = require('../utils/Logger')

const UnplayableStates = ['closing', 'closed', 'canceled']

class AnearEvent extends JsonApiResource {

  constructor(json) {
    super(json)
    this.zone = this.findIncluded(this.relationships.zone)
    this.app = this.findIncluded(this.zone.relationships.app)
    this.mutex = new Mutex()
  }

  toJSON() {
    return {
      ...super.toJSON(),
      participants: this.participants.toJSON(),
      context: this.stateMachineContext,
      previousState: this.anearStateMachine.currentState
    }
  }

  get userId() {
    return this.relationships.user.data.id
  }

  get zoneId() {
    return this.relationships.zone.data.id
  }

  getClonedFromEvent() {
    // if the current event was a clone of previous event, fetch if from
    // Peristence and return
    const clonedFromEventData = this.relationships["cloned-from"].data
    if (!clonedFromEventData) return null

    return this.constructor.getFromStorage(clonedFromEventData.id)
  }

  async clonedFromEventContext() {
    const clonedFrom = await this.getClonedFromEvent()

    return clonedFrom ? clonedFrom.context : null
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

  allowsSpectators() {
    return !this.hasFlag("no_spectators")
  }

  isParticipantEventCreator(participant) {
    return participant.userId === this.userId
  }

  publishEventParticipantsMessage(message, timeoutMsecs=0) {
    return this.messaging.publishEventParticipantsMessage(
      this,
      this.participants.active(),
      this.css,
      message,
      timeoutMsecs
    )
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

  publishEventSpectatorsMessage(message, timeoutMsecs = 0) {
    return this.messaging.publishEventSpectatorsMessage(this, this.css, message, timeoutMsecs, timeoutMsecs)
  }

  publishEventPrivateMessage(participant, message, timeoutMsecs=0) {
    return this.messaging.publishEventPrivateMessage(
      this,
      participant,
      this.css,
      message,
      timeoutMsecs
    )
  }

  publishEventTransitionMessage(newState) {
    return this.messaging.publishEventTransitionMessage(
      this,
      newState
    )
  }

  async participantEnter(participant) {
    // Called each time a participant ENTERs (attaches to) the Event's Action Channel.
    // This could be when joining an event for the first time, rejoining, or after a browser
    // refresh/reconnect. If the participant exists in Storage and in this.participants,
    // its probably due to a browser refresh, and we call Refresh. Else, its either a brand
    // new participant or an anearEvent recovery after crash, and so we invoke new participant enter
    //
    if (participant.exists()) { // persisted in storage?
      if (this.participants.exists(participant)) {
        logger.debug(`AnearEvent: participant ${participant.id} exists.  Refreshing...`)

        // Likely here due to participant browser refresh
        // get the existing participant, turn off his timer and send refresh event to StateMachine
        const existingParticipant = this.participants.get(participant)
        existingParticipant.interruptTimer()
        this.anearStateMachine.sendRefreshEvent({participant: existingParticipant})
        await existingParticipant.update()
      } else {
        // Likely here due to prior AnearEvent error and this is a event reload and restart
        // add the participants record back into Participants and update persisted copy
        this.participants.add(participant)
        this.anearStateMachine.sendJoinEvent({ participant })
        await participant.update()
      }
    } else {
      // New Participant first-time join this AnearEvent
      this.participants.add(participant) // add the participants record
      this.anearStateMachine.sendJoinEvent({ participant })
      await participant.persist()
    }
  }

  participantExit(participant) {
    // this informs the state machine that the participant has exited the event
    // and removes that participant completely
    this.anearStateMachine.sendParticipantExitEvent({ participant })
    return this.participantPurge(participant)
  }

  spectatorView(userId) {
    this.anearStateMachine.sendSpectatorViewEvent({userId})
  }

  participantPurge(participant) {
    this.participants.purge(participant)
    return participant.remove()
  }

  participantAction(participant, actionEventName, actionPayload) {
    this.anearStateMachine.sendActionEvent(actionEventName, {participant, payload: actionPayload})
  }

  participantTimedOut(participant) {
    this.anearStateMachine.sendTimeoutEvent({ participant })
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
    // CHANGES FOR XState-driven AnearEvent states
    //
    // transitionEvent changes to do the following:
    //   1. sends an Xstate event ('next', etc.) to the AnearEventMachine (not the Anear API)
    //   2. AnearEventMachine has state callbacks that:
    //     a. notify the AppStateMachine
    //     b. publishes Ably message indicating state transition for the Participants (eventchannel)
    //     c. sends API call to Anear API backend with new state to update Event model state.
    //
    //  Note:  should we remove aasm from app/models/event.rb as the state transition definition,
    //  may need to reside only in the anear-js-api?
    //
    //
    logger.debug(`AnearEvent: transitionEvent(${eventName})`)

    const responseAttributes = await this.messaging.api.transitionEvent(this.id, eventName)
    const newState = responseAttributes.state
    this.attributes.state = newState
    await this.messaging.publishEventTransitionMessage(this, newState)
  }

  isPlayable() {
    return !UnplayableStates.includes(this.eventState)
  }

  async transitionToAnnounce() {
    if (this.eventState === 'created') await this.transitionEvent('announce')
  }

  async transitionNextNext() {
    await this.transitionEvent('next')
    await this.transitionEvent('next')
  }

  transitionLive() {
    return this.transitionNextNext()
  }

  transitionClosed() {
    return this.transitionNextNext()
  }

  transitionCanceled() {
    return this.transitionEvent('cancel')
  }

  closeOutParticipants() {
    // returns a Promise
    // upon exiting the event, this will clean up any participants remaining
    // by closing out their messaging channels and purging them
    return Promise.all(
      this.participants.all.map(
        p => {
          return this.messaging.closeParticipant(
            this,
            p.id,
            async (anearEvent, participant) => {
              await anearEvent.participantPurge(participant)
            }
          )
        }
      )
    )
  }

  purgeParticipants() {
    // returns a Promise
    // remove participants and host from Participants class and from Storage
    const all = this.participants.all
    if (this.participants.host) all.push(this.participants.host)

    return Promise.all(
      all.map(p => this.participantPurge(p))
    )
  }

  resetParticipantTimers() {
    // turns off any active AnearParticipant timer
    this.participants.resetAllTimers()
  }

  destroyParticipantTimers() {
    // turns off any active and removes all other AnearParticipant timer
    this.participants.destroyAllTimers()
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

  async closeEvent() {
    await this.closeOutParticipants()
    await this.closeMessaging()
  }

  closeMessaging () {
    return this.messaging.detachAll(this.id)
  }

  logDebugMessage(...args) {
    logger.debug(...args)
  }

  logError(context, event) {
    logger.error("XState: ERROR: ", event.data)
  }
}

module.exports = AnearEvent
