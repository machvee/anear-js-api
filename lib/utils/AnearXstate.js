"use strict"
const { createMachine, interpret, State } = require('xstate')

const logger = require('../utils/Logger')

const JoinEvent = 'JOIN'
const RefreshEvent = 'REFRESH'
const CloseEvent = 'CLOSE'
const TimeoutEvent = 'TIMEOUT'

class AnearXstate {
  constructor(machineConfig, machineOptions, previousState, anearEventContext) {
    this.machine = createMachine(machineConfig, machineOptions).withContext(anearEventContext)

    this._currentState = previousState ? State.create(previousState) : this.machine.initialState
    this._currentContext = anearEventContext
  }

  startService() {
    logger.debug("XState: spawning interpreter. initial state: ", this.currentState.value)

    this.service = interpret(this.machine).
      onTransition(newState => {
        logger.debug("XState: NEW state: ", newState.value)

        this._currentState = newState
        this._currentContext = newState.context
      }).
      start(this.currentState)
  }

  get context() {
    // to reference appContext when using it as the xState context, use this method
    return this._currentContext
  }

  get currentState() {
    return this._currentState
  }

  sendJoinEvent(params) {
    this.send(JoinEvent, params)
  }

  sendRefreshEvent(params) {
    this.send(RefreshEvent, params)
  }

  sendCloseEvent(params) {
    this.send(CloseEvent, params)
  }

  sendTimeoutEvent(params) {
    this.send(TimeoutEvent, params)
  }

  sendActionEvent(eventName, params) {
    this.send(eventName, params)
  }

  send(eventName, params) {
    const eventToSend = {
      type: eventName,
      ...params
    }
    logger.debug(`XState: SENDING event ${eventName}`)
    this.service.send(eventToSend)
  }
}

module.exports = AnearXstate
