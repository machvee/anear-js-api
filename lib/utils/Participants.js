"use strict"

const ActiveState = "active"
const IdleState   = "idle"

class Participants {

  constructor(json) {
    this._participants = json.participants
    this._host = json.host
    this.idleMsecs = json.idleMsecs // how long Active participants
    this.purgeMsecs = json.purgeMsecs

    this._actives = null    // cached participants who are ActiveState
    this._idles = null      // cached participants who are IdleState
  }

  toJSON() {
    return {
      participants: this._participants,
      host: this._host,
      idleMsecs: this.idleMsecs,
      purgeMsecs: this.purgeMsecs
    }
  }

  getParticipantById(anearParticipantId) {
    return this._participants[anearParticipantId]
  }

  hasParticipant({id}) {
    return this.getParticipantById(id) != undefined
  }

  getParticipant({id}) {
    return this.getParticipantById(id)
  }

  get host() {
    return this._host
  }

  get participants() {
    return Object.values(this._participants).
      sort((ca, cb) => ca.timestamp - cb.timestamp)
  }

  get activeParticipants() {
    this._actives = this._actives || Object.values(this._participants).filter(c => c.state === ActiveState)
    return this._actives 
  }

  get idleParticipants() {
    this._idles = this._idles || Object.values(this._participants).filter(c => c.state === IdleState)
    return this._idles 
  }

  numParticipants() {
    return Object.keys(this._participants).length
  }

  numActiveParticipants() {
    return this.activeParticipants.length
  }

  numIdleParticipants() {
    return this.idleParticipants.length
  }

  isIdleParticipant(c, currentTimestamp) {
    return (currentTimestamp - c.timestamp) >= this.idleMsecs
  }

  isActiveParticipant(c, currentTimestamp) {
    return (currentTimestamp - c.timestamp) < this.idleMsecs
  }

  isPurgeParticipant(c, currentTimestamp) {
    return (currentTimestamp - c.timestamp) >= this.purgeMsecs
  }

  updateState(currentTimestamp) {
    const sweeper = participant => {
      if (participant.state === ActiveState) {
        if (this.isIdleParticipant(participant, currentTimestamp)) {
          participant.state = IdleState
        }
      } else if (participant.state === IdleState) {
        if (this.isPurgeParticipant(participant, currentTimestamp)) {
          this.purgeParticipant(participant)
        }
      }
    }

    const keys = Object.keys(this._participants)
    keys.forEach(
      k => {
        const c = this._participants[k]
        sweeper(c)
      }
    )
  }

  participantRec(presenceMessage, state = ActiveState) {
    return { ...presenceMessage, state }
  }

  addParticipant(presenceMessage) {
    const rec = this.participantRec(presenceMessage)
    if (!presenceMessage.isHost) {
      this._participants[presenceMessage.id] = rec
    } else {
      this._host = rec
    }
    return rec
  }

  markParticipantActive(anearParticipant) {
    // anearParticipant has shown activity in the event (e.g. Action)
    const participant = this.getParticipant(anearParticipant)
    const current = this.currentTimestamp()
    participant.markActive(current)
  }

  purgeParticipant({id}) {
    delete this._participants[id]
  }

  get currentTimestamp() {
    return new Date().getTime()
  }
}

module.exports = Participants
