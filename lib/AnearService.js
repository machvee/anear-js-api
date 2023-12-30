const AnearCoreServiceMachine = require('./state_machines/AnearCoreServiceMachine')

const AnearService = appEventMachineFactory => {
  //
  // developer provides appEventMachineFactory:
  //
  //    appEventMachineFactory = anearEvent => { returns XState Machine) }
  // 
  // appEventMachine should keep anearEvent in its context and leverage its
  // API
  //
  AnearCoreServiceMachine(appEventMachineFactory)
}
module.exports = AnearService
