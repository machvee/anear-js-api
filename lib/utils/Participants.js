"use strict"

const ActiveState = "active"
const IdleState   = "idle"

const DefaultIdleMsecs = (30 * 60 * 1000)
const DefaultPurgeMsecs = (2 * 60 * 60 * 1000)

const DefaultSettings = {
  participants: {},
  host: {},
  idleMsecs: DefaultIdleMsecs,
  purgeMsecs: DefaultPurgeMsecs
}

class Participants {

  constructor(json) {
    const init = json || JSON.parse(JSON.stringify(DefaultSettings))
    this._participants = init.participants
    this._host = init.host
    this.idleMsecs = init.idleMsecs // how long Active participants
    this.purgeMsecs = init.purgeMsecs

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

  activeParticipants(cached = true) {
    if (!cached) this._actives = null
    this._actives = this._actives || Object.values(this._participants).filter(c => c.state === ActiveState)
    return this._actives 
  }

  idleParticipants(cached = true) {
    if (!cached) this._idles = null
    this._idles = this._idles || Object.values(this._participants).filter(c => c.state === IdleState)
    return this._idles 
  }

  numParticipants() {
    return Object.keys(this._participants).length
  }

  numActiveParticipants(cached = true) {
    return this.activeParticipants(cached).length
  }

  numIdleParticipants(cached = true) {
    return this.idleParticipants(cached).length
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

  participantRec(anearParticipant, state = ActiveState) {
    return {
      ...anearParticipant.identity,
      state,
      timestamp: this.currentTimestamp
    }
  }

  addParticipant(anearEvent, anearParticipant) {
    const rec = this.participantRec(anearParticipant)

    if (anearParticipant.isHost() && anearEvent.hosted) {
      // the host is not an eligible participant and isn't active nor idle
      this._host = rec
    } else {
      this._participants[anearParticipant.id] = rec
    }
    return rec
  }

  markParticipantActive(anearParticipant) {
    // anearParticipant has shown activity in the event (e.g. Action)
    const participant = this.getParticipant(anearParticipant)
    const current = this.currentTimestamp
    participant.markActive(current)
  }

  purgeParticipant({id}) {
    if (id === this.host.id) {
      this._host = DefaultSettings.host
    } else {
      delete this._participants[id]
    }
  }

  get currentTimestamp() {
    return new Date().getTime()
  }
}

module.exports = Participants
