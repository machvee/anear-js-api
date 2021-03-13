"use strict"

const Participants = require('../lib/utils/Participants')
const { ParticipantsFixture: participantsJSON,
        AnearParticipantFixture2: visitor2JSON } = require('./fixtures')
const AnearParticipant = require('../lib/models/AnearParticipant')

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
        //. idle since last 30 minutes yesterday
        p.timestamp = timestamp - (30 * 60 * 1000)
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

test('hasParticipant success', () =>  {
  const p = newActiveParticipants(now)
  expect(p.hasParticipant({id: user1Id})).toBeTruthy()
})

test('hasParticipant fail', () =>  {
  const p = newActiveParticipants(now)
  expect(p.hasParticipant({id: "abcd"})).toBeFalsy()
})

test('getParticipant fail', () =>  {
  const p = newActiveParticipants(now)
  expect(p.getParticipant({id: "abcd"})).toBeUndefined()
})

test('getHost', () =>  {
  const p = newActiveParticipants(now)
  expect(p.getHost().name).toBe("the_host")
})

test('getParticipant success', () =>  {
  const p = newActiveParticipants(now)
  expect(p.getParticipant({id: user1Id}).name).toBe("user1")
})

test('addParticipant()', async () => {
  const p = newCurrentParticipants(now)
  const participant = new AnearParticipant(visitor2JSON)
  const presenceMessage = {...participant.identity, isHost: false}

  p.addParticipant(presenceMessage)
  expect(p.getParticipant(participant).name).toBe("bbondfl93")

  await AnearParticipant.close()
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

test('updateState will leave state unchanged when timeout criteria not met', () => {
  const p = newCurrentParticipants(now)
  p.updateState(now)
  expect(p.activeContestants.length).toBe(8)
  expect(p.idleContestants.length).toBe(2)
})

test('updateState will leave state unchanged when timeout criteria not met', () => {
  const p = newCurrentParticipants(now)
  p.updateState(now)
  expect(p.activeContestants.length).toBe(8)
  expect(p.idleContestants.length).toBe(2)
})

test('updateState will mark active to idle when timeout reached', () => {
  const current = now
  const p = newCurrentParticipants(current)
  expect(p.activeContestants.length).toBe(8)
  p.updateState(current + p.idleMsecs + 1000)
  expect(Object.values(p.participants).
    filter(p => p.state === 'active').
    filter(p => !p.isHost).length).toBe(0)
})

test('updateState will purge idle contestants', () => {
  const current = now
  const p = newCurrentParticipants(current)
  const idlers = p.idleContestants
  expect(idlers.length).toBe(2)
  p.updateState(current + p.purgeMsecs + 1000)
  idlers.forEach(c => expect(p.getParticipantById(c.id)).toBeUndefined())
})
