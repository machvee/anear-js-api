"use strict"
const { createMachine, interpret, State, assign } = require('xstate')

const JoinEvent = 'JOIN'
const RefreshEvent = 'REFRESH'
const CloseEvent = 'CLOSE'
const TimeoutEvent = 'TIMEOUT'

class AnearXstate {
  constructor(machineConfig, machineOptions, previousState, anearEventContext) {
    this.machine = createMachine(machineConfig, machineOptions).withContext(anearEventContext)

    this._currentState = previousState ? State.create(previousState) : this.machine.initialState
    this._currentContext = anearEventContext

    this.service = interpret(this.machine).
      onTransition(newState => {
        this._currentState = newState
        this._currentContext = newState.context
      }).
      start(this._currentState)
  }

  get context() {
    // to reference appContext when using it as the xState context, use this method
    return this._currentContext
  }

  get currentState() {
    return this._currentState
  }

  updateContext(assignFunc) {
    // e.g. updateContext((context, event) => ({someField: someValue}))
    assign(assignFunc)
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
