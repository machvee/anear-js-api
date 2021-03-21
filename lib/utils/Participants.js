"use strict"

const ActiveState = "active"
const IdleState   = "idle"

const MINUTES = (60 * 1000)
const HOURS = (60 * MINUTES)
const DefaultIdleMsecs = (30 * MINUTES)
const DefaultPurgeMsecs = (2 * HOURS)

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

  getById(anearParticipantId) {
    return this._participants[anearParticipantId]
  }

  exists({id}) {
    return this.getById(id) != undefined
  }

  get({id}) {
    return this.getById(id)
  }

  get host() {
    return this._host
  }

  get all() {
    return Object.values(this._participants).
      sort((ca, cb) => ca.timestamp - cb.timestamp)
  }

  active(cached = true) {
    if (!cached) this._actives = null
    this._actives = this._actives || Object.values(this._participants).filter(c => c.state === ActiveState)
    return this._actives 
  }

  idle(cached = true) {
    if (!cached) this._idles = null
    this._idles = this._idles || Object.values(this._participants).filter(c => c.state === IdleState)
    return this._idles 
  }

  get count() {
    return Object.keys(this._participants).length
  }

  numActive(cached = true) {
    return this.active(cached).length
  }

  numIdle(cached = true) {
    return this.idle(cached).length
  }

  isIdle(c, currentTimestamp) {
    return (currentTimestamp - c.timestamp) >= this.idleMsecs
  }

  isActive(c, currentTimestamp) {
    return (currentTimestamp - c.timestamp) < this.idleMsecs
  }

  isPurge(c, currentTimestamp) {
    return (currentTimestamp - c.timestamp) >= this.purgeMsecs
  }

  updateState(currentTimestamp) {
    const sweeper = participant => {
      if (participant.state === ActiveState) {
        if (this.isIdle(participant, currentTimestamp)) {
          participant.state = IdleState
        }
      } else if (participant.state === IdleState) {
        if (this.isPurge(participant, currentTimestamp)) {
          this.purge(participant)
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

  add(anearEvent, anearParticipant) {
    const rec = this.participantRec(anearParticipant)

    if (anearParticipant.isHost() && anearEvent.hosted) {
      // the host is not an eligible participant and isn't active nor idle
      this._host = rec
    } else {
      this._participants[anearParticipant.id] = rec
    }
    return rec
  }

  markActive(anearParticipant) {
    // anearParticipant has shown activity in the event (e.g. Action)
    const participant = this.get(anearParticipant)
    if (participant) {
      participant.timestamp = this.currentTimestamp
      participant.state = ActiveState
    } else {
      this._participants[anearParticipant.id] = this.participantRec(anearParticipant)
    }
  }

  purge({id}) {
    if (id === this.host.id) {
      this._host = JSON.parse(JSON.stringify(DefaultSettings)).host
    } else {
      if (this._participants[id]) delete this._participants[id]
    }
  }

  get currentTimestamp() {
    return new Date().getTime()
  }

  participantRec(anearParticipant, state = ActiveState) {
    return {
      ...anearParticipant.identity,
      state,
      timestamp: this.currentTimestamp
    }
  }
}

module.exports = Participants
