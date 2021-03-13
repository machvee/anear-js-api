"use strict"

const ActiveState = "active"
const IdleState   = "idle"

class Participants {

  constructor(json) {
    this.participants = json.participants
    this.host = json.host
    this.idleMsecs = json.idleMsecs // how long Active participants
    this.purgeMsecs = json.purgeMsecs

    this._contestants = null // everyone except the event Host
    this._actives = null    // cached contestants who are ActiveState
    this._idles = null      // cached contestants who are IdleState
  }

  toJSON() {
    return {
      participants: this.participants,
      idleMsecs: this.idleMsecs,
      purgeMsecs: this.purgeMsecs
    }
  }

  get currentTimestamp() {
    return new Date().getTime()
  }

  isIdleContestant(c, currentTimestamp) {
    return (currentTimestamp - c.timestamp) >= this.idleMsecs
  }

  isActiveContestant(c, currentTimestamp) {
    return (currentTimestamp - c.timestamp) < this.idleMsecs
  }

  isPurgeContestant(c, currentTimestamp) {
    return (currentTimestamp - c.timestamp) >= this.purgeMsecs
  }

  updateState(currentTimestamp) {
    const sweeper = contestant => {
      if (contestant.state === ActiveState) {
        if (this.isIdleContestant(contestant, currentTimestamp)) {
          contestant.state = IdleState
        }
      } else if (contestant.state === IdleState) {
        if (this.isPurgeContestant(contestant, currentTimestamp)) {
          this.purgeParticipant(contestant)
        }
      }
    }

    const keys = Object.keys(this.participants)
    keys.forEach(
      k => {
        const c = this.participants[k]
        if (!c.isHost) sweeper(c)
      }
    )
  }

  hasParticipant({id}) {
    return this.participants.hasOwnProperty(id)
  }

  getParticipantById(anearParticipantId) {
    return this.participants[anearParticipantId]
  }

  getParticipant({id}) {
    return this.getParticipantById(id)
  }

  getHost() {
    const keys = Object.keys(this.participants)
    const hostKey = keys.find(k => this.participants[k].isHost)
    return hostKey ? this.participants[hostKey] : null
  }

  purgeParticipant({id}) {
    delete this.participants[id]
  }

  participantRec(presenceMessage, state = ActiveState) {
    return { ...presenceMessage, state }
  }

  addParticipant(presenceMessage) {
    this.participants[presenceMessage.id] = this.participantRec(presenceMessage)
  }

  markParticipantActive(anearParticipant) {
    const participant = this.getParticipantById(anearParticipant)
    const current = this.currentTimestamp()
    participant.markActive(current)
    this.updateState(current)
  }

  numActiveParticipants() {
    return this.activeParticipants.length
  }

  get contestants() {
    // All participants except the Host
    this._contestants = this._contestants || 
      Object.values(this.participants).filter(p => !p.isHost).
      sort((ca, cb) => ca.timestamp - cb.timestamp)
    return this._contestants
  }

  get activeContestants() {
    this._actives = this._actives || this.contestants.filter(c => c.state === ActiveState)
    return this._actives 
  }

  get idleContestants() {
    this._idles = this._idles || this.contestants.filter(c => c.state === IdleState)
    return this._idles 
  }
}

module.exports = Participants
