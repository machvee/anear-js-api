"use strict"

const { createMachine, interpret, State } = require('xstate')

const logger = require('../utils/Logger')

// accepts:
//    machineConfig - XState states and event transitions JSON
//    machineFunctions - XState services, actions and guards invoked during receipt of events and state transitions
//    initContext - XState context definition and initial values
//    previousState - optional XState State Object only used when an XState matchine is being restarted
class AnearBaseMachine {
  constructor(machineConfig, machineFunctions, initContext, previousState = null) {
    const expandedConfig = {predictableActionArguments: true, ...machineConfig}
    expandedConfig.context = initContext

    this.machineFunctions = machineFunctions

    this.xStateMachine = createMachine(
      expandedConfig,
      machineFunctions(this)
    )
  }

  startService() {
    logger.debug(`Spawning ${this.constructor.name} interpreter. initial state: `, this.xStateMachine.initialState.value)

    this.xStateService = interpret(this.xStateMachine).
      onTransition(newState => {
        logger.debug(`${this.constructor.name} NEW state: `, newState.value)
      }).start()
    return this
  }

  get context() {
    // THIS DID NOT WORK  FIX ME
    this.xStateService.state.context
  }

  get state() {
    this.xStateService.state
  }

  send(eventName, params = {}) {
    const eventToSend = {
      type: eventName,
      ...params
    }
    logger.debug(`${this.constructor.name} SENDING event ${eventName}`)

    return this.xStateService.send(eventToSend)
  }
}

module.exports = AnearBaseMachine
