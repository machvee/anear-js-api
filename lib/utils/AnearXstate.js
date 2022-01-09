"use strict"
const { createMachine, State } = require('xstate')

const JoinEvent = 'JOIN'
const RefreshEvent = 'REFRESH'
const CloseEvent = 'CLOSE'
const TimeoutEvent = 'TIMEOUT'

class AnearXstate {
  constructor(initState, machineConfig, machineOptions) {
    this.machine = createMachine(machineConfig, machineOptions)

    const startingState = initState || this.machine.initialState
    this._currentState = State.create(startingState)
  }

  context() {
    return this.machine.context
  }
  
  get currentState() {
    return this._currentState.toJSON()
  }

  sendJoinEvent(params) {
    return this.send(JoinEvent, params)
  }

  sendRefreshEvent(params) {
    return this.send(RefreshEvent, params)
  }

  sendCloseEvent(params) {
    return this.send(CloseEvent, params)
  }

  sendTimeoutEvent(params) {
    return this.send(TimeoutEvent, params)
  }

  send(eventName, params) {
    const eventToSend = {
      type: eventName,
      ...params
    }
    this._currentState = this.machine.transition(this._currentState, eventToSend)
    this.execActions(eventToSend)
  }

  execActions(eventToSend) {
    this._currentState.actions.forEach((action) => {
      typeof action.exec === 'function' && action.exec(this.machine.context, eventToSend)
    })
  }
}

module.exports = AnearXstate
