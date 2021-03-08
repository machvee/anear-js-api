"use strict"

const Participants = require('../lib/utils/Participants')
const { ParticipantsFixture: participantsJSON } =  require('./fixtures')

const AnId = "e053977c-dcb6-40e0-b7b8-e3dbd70ec8fd"

test('constructor', () =>  {
  const p = new Participants(participantsJSON)

  expect(p.getParticipantById(AnId).name).toBe("user1")
})
