"use strict"
const { createMachine, interpret } = require('xstate')

const JoinEvent = 'JOIN'
const RefreshEvent = 'REFRESH'
const CloseEvent = 'CLOSE'
const TimeoutEvent = 'TIMEOUT'

class AnearXstate {
  constructor(context, machineConfig, machineOptions) {
    this.machine = createMachine(machineConfig, machineOptions).withContext(context)
    this.service = interpret(this.machine).start()
    this.currentState = this.machine.initialState
  }

  context() {
    return this.machine.initialState.context
  }
  
  get currentStateName() {
    return this.currentState.value
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
    this.currentState = this.service.send(eventToSend)
  }
}

module.exports = AnearXstate
