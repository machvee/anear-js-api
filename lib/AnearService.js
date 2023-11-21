const AnearApi = require('./api/AnearApi')
const logger = require('./utils/Logger')
const AnearCoreServiceMachine = require('./state_machines/AnearCoreServiceMachine')

class AnearService {
  // Developer calls AnearService from their index.js, and passes in the AppStateMachineClass and ParticipantStateMachineClass
  // constants used to drive the Game/Event and it's Participant's Actions.
  constructor(appId, AppStateMachineClass, ParticipantStateMachineClass) {
    const anearApi = new AnearApi(process.env.ANEARAPP_API_KEY, process.env.ANEARAPP_API_VERSION)
    this.coreServiceStateMachine = new AnearCoreServiceMachine(
      appId,
      anearApi,
      AppStateMachineClass,
      ParticipantStateMachineClass
    )
    this.coreServiceStateMachine.startService()
  }
}
module.exports = AnearService
