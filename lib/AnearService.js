"use strict"

const AnearApi = require('./api/AnearApi')
const logger = require('./utils/Logger')
const AnearCoreAppMachine = require('./state_machines/AnearCoreAppMachine')

class AnearService {
  // Developer calls AnearService from their index.js, and passes in the AppStateMachine and ParticipantStateMachine 
  // classes used to drive the Game/Event and it's Participants Actions.
  constructor(appId, AppStateMachine, ParticipantStateMachine) {
    const anearApi = new AnearApi(process.env.ANEARAPP_API_KEY, process.env.ANEARAPP_API_VERSION)
    this.coreAppStateMachine = new AnearCoreAppMachine(appId, anearApi, AppStateMachine, ParticipantStateMachine)
    this.coreAppStateMachine.startService()
  }
}
module.exports = AnearService
