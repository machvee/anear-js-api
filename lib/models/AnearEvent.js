"use strict"
const logger = require('../utils/Logger')

const JsonApiResource = require('./JsonApiResource')

const UnplayableStates = ['closing', 'closed', 'canceled']

class AnearEvent extends JsonApiResource {

  constructor(json) {
    super(json)
    this.zone = this.findIncluded(this.relationships.zone)
    this.app = this.findIncluded(this.zone.relationships.app)
    this.send = () => {} // until initialized with setActor
  }

  get userId() {
    return this.relationships.user.data.id
  }

  get zoneId() {
    return this.relationships.zone.data.id
  }

  setMachine(service) {
    this.send = service.send.bind(service)
  }

  announceEvent() {
    this.send("ANNOUNCE")
  }

  startEvent() {
    this.send("START")
  }

  cancelEvent() {
    this.send("CANCEL")
  }

  closeEvent() {
    this.send("CLOSE")
  }

  pauseEvent() {
    this.send("PAUSE")
  }

  resumeEvent() {
    this.send("RESUME")
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

  isPlayable() {
    return !UnplayableStates.includes(this.eventState)
  }

  get eventChannelName() {
    return this.getChannelName('event')
  }

  get participantsChannelName () {
    return this.getChannelName('participants')
  }

  get actionsChannelName () {
    return this.getChannelName('actions')
  }

  get spectatorsChannelName () {
    return this.getChannelName('spectators')
  }

  getChannelName (key) {
    return this.attributes[`${key}-channel-name`]
  }
}

module.exports = AnearEvent
