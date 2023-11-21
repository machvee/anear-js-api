const AnearService = require('../lib/AnearService')
const logger = require('../lib/utils/Logger')

const AppId = '5b9d9838-17de-4a80-8a64-744c222ba722'

const MockAppClass = class AppMachine {}
const MockParticipantClass = class ParticipantMachine {}

test('test happy path', () =>  {
  const service = new AnearService(AppId, MockAppClass, MockParticipantClass)
})
