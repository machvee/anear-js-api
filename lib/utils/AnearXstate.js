"use strict"
const { createMachine, interpret, State } = require('xstate')

const JoinEvent = 'JOIN'
const RefreshEvent = 'REFRESH'
const CloseEvent = 'CLOSE'
const TimeoutEvent = 'TIMEOUT'

class AnearXstate {
  constructor(machineConfig, machineOptions, previousState = null, initialContext = null) {
    this.machine = createMachine(machineConfig, machineOptions)
    if (initialContext) {
      this.machine = this.machine.withContext(initialContext)
    }

    this._currentState = previousState ? State.create(previousState) : this.machine.initialState
    this._currentContext = initialContext || this.machine.initialState.context

    this.service = interpret(this.machine).
      onTransition(newState => {
        this._currentState = newState
        this._currentContext = newState.context
      }).
      start(this._currentState)
  }

  get context() {
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
    this.service.send(eventToSend)
  }
}

module.exports = AnearXstate
