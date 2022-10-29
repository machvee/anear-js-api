"use strict"

const ActiveState = "active"
const IdleState   = "idle"

const MINUTES = (60 * 1000)
const HOURS = (60 * MINUTES)
const DefaultIdleMsecs = (30 * MINUTES)
const DefaultPurgeMsecs = (2 * HOURS) // after Idle

class Participants {

  constructor(anearEvent, idleMsecs = DefaultIdleMsecs, purgeMsecs = DefaultPurgeMsecs, ids = []) {
    this.anearEvent = anearEvent
    this.idleMsecs = idleMsecs
    this.purgeMsecs = purgeMsecs
    this._participants = {}
    for (const id of ids) {
      // app restart logic ...
      // seeds from ids with empty objects awaiting full
      // anearParticipant rehydration from redis
      this._participants[id] = {}
    }
    this._host = {}
  }

  toJSON() {
    return {
      // only output the active participant ids.  Participants records
      // are stored in redis for later rehydration
      ids: this.active.map(p => p.id),
      idleMsecs: this.idleMsecs,
      purgeMsecs: this.purgeMsecs
    }
  }

  get ids() {
    return Object.keys(this._participants)
  }

  reloadFromStorage(callback) {
    // rehydrate the anearEvent participants and host from storage
    return Promise.all(
      ids.map(async p => callback(await this.fromStorage(participantId)))
    )
  }

  fromStorage(participantId) {
    // load from storage and return AnearParticipant instance to caller
    return this.anearEvent.anearParticipantClass.getFromStorage(participantId, this.anearEvent)
  }

  indexedById() {
    // returns an object that has AnearParticipant.id as key
    return this._participants
  }

  getById(participantId) {
    return this._participants[participantId]
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

  set host(h) {
    this._host = h
  }

  get all() {
    return Object.values(this._participants).
      sort((ca, cb) => ca.timestamp - cb.timestamp)
  }

  get active() {
    return Object.values(this._participants).filter(c => c.state === ActiveState)
  }

  get idle() {
    return Object.values(this._participants).filter(c => c.state === IdleState)
  }

  get count() {
    return this.ids.length
  }

  numActive() {
    return this.active.length
  }

  numIdle() {
    return this.idle.length
  }

  isIdle(c, currentTimestamp) {
    if (!this.idleMsecs) return false
    return (currentTimestamp - c.timestamp) >= this.idleMsecs
  }

  isActive(c, currentTimestamp) {
    if (!this.idleMsecs) return true
    return (currentTimestamp - c.timestamp) < this.idleMsecs
  }

  isPurge(c, currentTimestamp) {
    if (!this.purgeMsecs) return false
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

    this.ids.forEach(
      k => {
        const c = this._participants[k]
        sweeper(c)
      }
    )
  }

  add(anearParticipant, withTimestamp = null) {
    if (anearParticipant.isHost() && this.anearEvent.hosted) {
      // the host is not an eligible participant and isn't active nor idle
      this.host = anearParticipant
    } else {
      this._participants[anearParticipant.id] = anearParticipant
      this.markActive(anearParticipant, withTimestamp)
    }
    return anearParticipant
  }

  markActive(anearParticipant, withTimestamp = this.currentTimestamp) {
    anearParticipant.timestamp = withTimestamp
    anearParticipant.state = ActiveState
  }

  purge({id}) {
    if (id === this.host.id) {
      this._host = {}
    } else {
      if (this._participants[id]) delete this._participants[id]
    }
  }

  get currentTimestamp() {
    return new Date().getTime()
  }

  load(anearParticipants) {
    // used for tests only
    anearParticipants.forEach(
      p => this._participants[p.id] = p
    )
  }
}

module.exports = Participants
