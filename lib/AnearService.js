const AnearCoreServiceMachine = require('./state_machines/AnearCoreServiceMachine')

const AnearService = appEventMachineFactory => {
  //
  // developer provides appEventMachineFactory:
  //
  //    appEventMachineFactory = anearEvent => { returns XState Machine }
  //
  AnearCoreServiceMachine(appEventMachineFactory).start()
}
module.exports = AnearService
