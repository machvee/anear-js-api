const AnearService = require('../lib/AnearService')

const AppId = '5b9d9838-17de-4a80-8a64-744c222ba722'

const MockAppClass = class AppMachine {}
const MockParticipantClass = class ParticipantMachine {}

test('constructor', () =>  {
  const s = new AnearService(AppId, MockAppClass, MockParticipantClass)
})


