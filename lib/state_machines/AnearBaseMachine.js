"use strict"

const { createMachine, interpret, State } = require('xstate')

const logger = require('../utils/Logger')

class AnearBaseMachine {
  constructor(machineConfig, machineFunctions, initContext, previousState = null) {
    super()

    const expandedConfig = {predictableActionArguments: true, ...machineConfig}

    this.machineFunctions = machineFunctions
    this.xStateMachine = createMachine(
      expandedConfig,
      machineFunctions(this)
    ).withContext(initContext)

    this._currentState = previousState ? State.create(previousState) : this.xStateMachine.initialState
    this._currentContext = initContext
  }

  startService() {
    logger.debug(`Spawning ${this.constructor.name} interpreter. initial state: `, this.currentState.value)

    this.xStateService = interpret(this.xStateMachine).
      onTransition(newState => {
        logger.debug(`${this.constructor.name} NEW state: `, newState.value)

        this._currentState = newState
        this._currentContext = newState.context
      }).start(this.currentState)
  }

  get context() {
    // to reference appContext when using it as the xState context, use this method
    return this._currentContext
  }

  get currentState() {
    return this._currentState
  }

  send(eventName, params) {
    const eventToSend = {
      type: eventName,
      ...params
    }
    logger.debug(`${this.constuctor.name} SENDING event ${eventName}`)

    return this.xStateService.send(eventToSend)
  }
}

module.exports = AnearBaseMachine
