const AnearCoreServiceMachine = require('./state_machines/AnearCoreServiceMachine')

const AnearService = (appEventMachineFactory, appParticipantMachineFactory = null) => {
  //
  // developer provides appEventMachineFactory:
  //
  //    appEventMachineFactory = anearEvent => { returns XState Machine) }
  //    optional appParticipantMachineFactory = anearParticipant => { returns XState Machine) }
  //
  AnearCoreServiceMachine(appEventMachineFactory, appParticipantMachineFactory)
}
module.exports = AnearService
