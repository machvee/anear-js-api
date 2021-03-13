"use strict"

const Participants = require('../lib/utils/Participants')
const { ParticipantsFixture: participantsJSON } =  require('./fixtures')

const user1Id = "e053977c-dcb6-40e0-b7b8-e3dbd70ec8fd"
const idleId = "f1056e6c-c393-4617-8a06-67ba9d2f4b8a"
const activeId = user1Id
const hours24 = (24 * 60 * 60 * 1000)

const newActiveParticipants = timestamp => {
  const copy = JSON.parse(JSON.stringify(participantsJSON))
  const keys = Object.keys(copy.participants)
  keys.forEach(
    (k,i) => {
      const p = copy.participants[k]
      p.timestamp = timestamp - (i*2000)
      p.state = 'active'
    }
  )
  return new Participants(copy)
}

const newCurrentParticipants = timestamp => {
  const copy = JSON.parse(JSON.stringify(participantsJSON))
  const keys = Object.keys(copy.participants)
  keys.forEach(
    (k,i) => {
      const p = copy.participants[k]
      if (p.state === 'active') {
        p.timestamp = timestamp - (i*2000)
      } else {
        //. idle since yesterday
        p.timestamp = timestamp - (24 * 60 * 60 * 1000)
      }
    }
  )
  return new Participants(copy)
}

const now = new Date().getTime()

test('constructor', () =>  {
  const p = new Participants(participantsJSON)
  expect(p).toBeDefined()
})

test('getParticipantById', () =>  {
  const p = newActiveParticipants(now)
  expect(p.getParticipantById(user1Id).name).toBe("user1")
})

test('activeContestants', () => {
  const p = newActiveParticipants(now)
  expect(p.activeContestants.length).toBe(10)
})

test('idleContestants', () => {
  const p = newCurrentParticipants(now)
  expect(p.idleContestants.length).toBe(2)
})

test('toJSON', () => {
  const p = new Participants(participantsJSON)
  const j = p.toJSON()
  expect(j).toHaveProperty("participants")
  expect(j).toHaveProperty("idleMsecs")
  expect(j).toHaveProperty("purgeMsecs")
})

test('isIdleContestant', () => {
  const p = newCurrentParticipants(now)
  const c = p.getParticipantById(idleId)
  expect(p.isIdleContestant(c, now)).toBeTruthy()
})

test('isActiveContestant', () => {
  const p = newCurrentParticipants(now)
  const c = p.getParticipantById(activeId)
  expect(p.isActiveContestant(c, now)).toBeTruthy()
})

test('isPurgeContestant', () => {
  const p = newCurrentParticipants(now)
  const c = p.getParticipantById(idleId)
  c.timestamp = c.timestamp - hours24
  expect(p.isPurgeContestant(c, now)).toBeTruthy()
})

