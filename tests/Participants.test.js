"use strict"

const Participants = require('../lib/utils/Participants')
const { ParticipantsFixture: participantsJSON,
        AnearParticipantFixture2: visitor2JSON,
        AnearHostFixture: hostJSON } = require('./fixtures')
const AnearParticipant = require('../lib/models/AnearParticipant')

const user1Id = "e053977c-dcb6-40e0-b7b8-e3dbd70ec8fd"
const idleId = "f1056e6c-c393-4617-8a06-67ba9d2f4b8a"
const activeId = user1Id
const hours24 = (24 * 60 * 60 * 1000)
const GeoLocation = {lat: 25.8348343, lng: -80.38438434}

const MockHostedEvent = {hosted: true}
const MockNonHostedEvent = {hosted: false}

const newActiveParticipants = (timestamp, anearEvent = MockHostedEvent) => {
  const activeParticipants = JSON.parse(JSON.stringify(participantsJSON))
  const participants = new Participants()
  const aps = Object.values(activeParticipants)
  aps.forEach((p, i) => participants.add(anearEvent, p, timestamp - (i*2000)))
  return participants
}

const newCurrentParticipants = (timestamp, jsonArgs = {}, anearEvent = MockHostedEvent) => {
  const currentParticipants = JSON.parse(JSON.stringify(participantsJSON))
  const participants = new Participants(jsonArgs)
  let withTimestamp
  const cps = Object.values(currentParticipants)
  cps.forEach(
    (p,i) => {
      if (p.state === 'active') {
        withTimestamp = timestamp - (i*2000)
      } else {
        // idle in the last 30 minutes
        withTimestamp = timestamp - participants.idleMsecs
      }
      participants.add(anearEvent, p, withTimestamp)
    }
  )
  return participants
}

const now = new Date().getTime()

test('constructor with JSON provided', () =>  {
  const p = new Participants({idleMsecs: 23400, purgeMsecs: 678900})
  expect(p).toBeDefined()
  expect(p.idleMsecs).toBe(23400)
  expect(p.purgeMsecs).toBe(678900)
})

test('constructor with NO JSON provided has default idle and purge Msecs', () => {
  const p = new Participants()
  expect(p).toBeDefined()
  expect(p.idleMsecs).toBe(1800000)
  expect(p.purgeMsecs).toBe(7200000)
  expect(p.all).toHaveLength(0)
})

test('constructor with null idle and purge msecs avoids idle purge', () => {
  const p = newActiveParticipants(now, {idleMsecs: null, purgeMsecs: null})
  expect(p.idleMsecs).toBe(null)
  expect(p.purgeMsecs).toBe(null)
  expect(p.idle).toHaveLength(0)
  expect(p.active).toHaveLength(10)

  const c = p.getById(idleId)
  expect(p.isIdle(c, now)).toBeFalsy()
  c.timestamp = c.timestamp - hours24
  expect(p.isPurge(c, now)).toBeFalsy()
})

test('getById', () =>  {
  const p = newActiveParticipants(now)
  expect(p.getById(user1Id)).toHaveProperty("name", "user1")
})

test('exists success', () =>  {
  const p = newActiveParticipants(now)
  expect(p.exists({id: user1Id})).toBeTruthy()
})

test('exists fail', () =>  {
  const p = newActiveParticipants(now)
  expect(p.exists({id: "abcd"})).toBeFalsy()
})

test('get success', () =>  {
  const p = newActiveParticipants(now)
  expect(p.get({id: user1Id})).toHaveProperty("name", "user1")
})

test('getParticipant fail', () =>  {
  const p = newActiveParticipants(now)
  expect(p.get({id: "abcd"})).toBeUndefined()
})

test('host', () =>  {
  const p = newActiveParticipants(now)
  const host = p.host
  expect(host.name).toBe("the_host")
})

test('getParticipant success', () =>  {
  const p = newActiveParticipants(now)
  expect(p.get({id: user1Id}).name).toBe("user1")
})

test('add() participant user', async () => {
  const p = newCurrentParticipants(now, {}, MockNonHostedEvent)
  const participant = new AnearParticipant(visitor2JSON, MockNonHostedEvent)
  participant.geoLocation = GeoLocation

  p.add(participant)
  const part = p.get(participant)
  expect(part.name).toBe("bbondfl93")
  expect(part.avatarUrl).toBe("https://s3.amazonaws.com/anearassets/barbara_bond.png")
  expect(part.userId).toBe("d280da7c-1baf-4607-a286-4b5faa03eaa7")

  await AnearParticipant.close()
})

test('add() host user', async () => {
  const p = newCurrentParticipants(now)
  const host = new AnearParticipant(hostJSON, MockNonHostedEvent)
  host.geoLocation = GeoLocation

  p.add(host)
  expect(p.get(host)).toBeUndefined()
  expect(p.host.name).toBe('foxhole_host')
  expect(p.host.avatarUrl).toBe("https://s3.amazonaws.com/anearassets/foxhole.png")

  await AnearParticipant.close()
})

test('active', () => {
  const p = newActiveParticipants(now)
  expect(p.active).toHaveLength(10)
})

test('idle', () => {
  const p = newCurrentParticipants(now)
  expect(p.idle).toHaveLength(2)
})

test('toJSON', () => {
  const p = new Participants(participantsJSON)
  const j = p.toJSON()
  expect(j).toHaveProperty("participants")
  expect(j).toHaveProperty("idleMsecs")
  expect(j).toHaveProperty("purgeMsecs")
})

test('isIdle', () => {
  const p = newCurrentParticipants(now)
  const c = p.getById(idleId)
  expect(p.isIdle(c, now)).toBeTruthy()
})

test('isActive', () => {
  const p = newCurrentParticipants(now)
  const c = p.getById(activeId)
  expect(p.isActive(c, now)).toBeTruthy()
})

test('isPurge', () => {
  const p = newCurrentParticipants(now)
  const c = p.getById(idleId)
  c.timestamp = c.timestamp - hours24
  expect(p.isPurge(c, now)).toBeTruthy()
})

test('purgeParticipant participant user-type', () => {
  const p = newCurrentParticipants(now)
  const c = p.getById(idleId)
  p.purge(c)
  expect(p.exists(c)).toBeFalsy()
})

test('purge host user-type', () => {
  const p = newActiveParticipants(now)
  const c = p.host
  p.purge(c)
  expect(p.host).toStrictEqual({})
})

test('updateState will leave state unchanged when timeout criteria not met', () => {
  const p = newCurrentParticipants(now)
  p.updateState(now)
  expect(p.active).toHaveLength(8)
  expect(p.idle).toHaveLength(2)
  expect(p.numActive()).toBe(8)
  expect(p.numIdle()).toBe(2)
})

test('updateState will mark active to idle when timeout reached', () => {
  const current = now
  const p = newCurrentParticipants(current)
  expect(p.active).toHaveLength(8)
  p.updateState(current + p.idleMsecs + 1000)
  expect(Object.values(p.all).
    filter(p => p.state === 'active')).toHaveLength(0)
})

test('updateState will purge idle participants', () => {
  const current = now
  const p = newCurrentParticipants(current)
  const idlers = p.idle
  expect(idlers).toHaveLength(2)
  p.updateState(current + p.purgeMsecs + 1000)
  idlers.forEach(c => expect(p.getById(c.id)).toBeUndefined())
})
