"use strict"

const ActiveState = "active"
const IdleState   = "idle"

class Participants {

  constructor(json) {
    this.participants = json.participants
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

  sweepContestant(contestant, current) {
    if (contestant.isActiveState) {
      if (this.isIdleContestant(contestant, current)) {
        contestant.state = IdleState
      }
    } else if (contestant.isIdleState) {
      if (this.isPurgeContestant(contestant, current)) {
        this.purgeParticipant(contestant)
      }
    }
  }

  updateState(currentTimestamp) {
    //
    // the timestamps of all contestants.
    // if they show recent activity, make sure they have the
    // activeState.   If the activity is not recent, mark them idle
    //
    this._contestants.forEach(c => this.sweepContestant(c, currentTimestamp))
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

  purgeParticipant({id}) {
    delete this.participants[id]
  }

  participantRec(anearParticipant, presenceMessage, state = ActiveState) {
    return {
      ...anearParticipant.identity,
      timestamp: presenceMessage.timestamp,
      state: state
    }
  }

  addParticipant(anearParticipant, presenceMessage) {
    const rec = this.participantRec(anearParticipant, presenceMessage)
    this.participants[anearParticipant.id] = rec
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
    this._actives = this._actives || this._contestants.filter(c => c.state === ActiveState)
    return this._actives 
  }

  get idleContestants() {
    this._idles = this._idles || this._contestants.filter(c => c.state === IdleState)
    return this._idles 
  }
}

module.exports = Participants
