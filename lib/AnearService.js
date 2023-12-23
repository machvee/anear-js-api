const logger = require('./utils/Logger')
const AnearCoreServiceMachine = require('./state_machines/AnearCoreServiceMachine')

class AnearService {
  // Developer calls AnearService from their index.js, and passes in the AppStateMachineClass
  // constant used to drive the Game/Event and it's Participant's Actions.
  constructor(AppEventMachineClass) {
    const appId = process.env.ANEARAPP_APP_ID
    this.coreServiceStateMachine = new AnearCoreServiceMachine(appId, AppEventMachineClass)
    this.coreServiceStateMachine.startService()
  }
}
module.exports = AnearService
