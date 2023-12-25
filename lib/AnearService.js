const logger = require('./utils/Logger')
const AnearCoreServiceMachine = require('./state_machines/AnearCoreServiceMachine')

class AnearService {
  // Developer calls AnearService from their index.js, and passes in their custom appEventMachine function.
  // appEventMachine is invoked with the AnearEvent model instance and must return an XState Machine
  constructor(appEventMachine) {
    const appId = process.env.ANEARAPP_APP_ID
    this.coreServiceStateMachine = new AnearCoreServiceMachine(appId, appEventMachine)
    this.coreServiceStateMachine.startService()
  }
}
module.exports = AnearService
