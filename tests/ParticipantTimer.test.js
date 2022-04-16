"use strict"

const ParticipantTimer = require('../lib/utils/ParticipantTimer')
const ParticipantId = "machvee"
const Now = Date.now()

jest.useFakeTimers();

afterEach(() => jest.clearAllTimers)

test('constructor with callback basic usage', () => {
  const callback = jest.fn()
  const t = new ParticipantTimer(ParticipantId, callback)
  expect(t).toBeDefined()
  expect(t.isRunning).toBe(false)
  expect(t.isPaused).toBe(false)
  t.start(500, Now)
  expect(t.isRunning).toBe(true)
  jest.runAllTimers()
  expect(callback).toHaveBeenCalledTimes(1)
  expect(t.isExpired).toBe(true)
})

test('start and then pause does not invoke callback', () => {
  const callback = jest.fn()
  const t = new ParticipantTimer(ParticipantId, callback)
  t.start(1000, Now)
  jest.advanceTimersByTime(500);
  t.pause(Now + 500)
  expect(t.isPaused).toBe(true)
  expect(t.timeRemaining).toEqual(500)
  jest.advanceTimersByTime(501);
  expect(callback).toHaveBeenCalledTimes(0)
  expect(t.isPaused).toBe(true)
})

test('start, pause, then resume', () => {
  const callback = jest.fn()
  const t = new ParticipantTimer(ParticipantId, callback)
  t.start(1000, Now)
  jest.advanceTimersByTime(500);
  t.pause(Now + 500)
  expect(t.isPaused).toBe(true)
  expect(t.timeRemaining).toEqual(500)

  t.resume(Now + 1001)
  jest.advanceTimersByTime(501);
  expect(callback).toHaveBeenCalledTimes(1)
})

test('start and interrupt multiple times', () => {
  const callback = jest.fn()
  const t = new ParticipantTimer(ParticipantId, callback)

  t.start(1000, Now)
  jest.advanceTimersByTime(500);
  t.interrupt(Now + 500)
  expect(t.timeRemaining).toEqual(500)
  expect(t.isRunning).toBe(true)
  jest.advanceTimersByTime(250);
  t.interrupt(Now + 750)
  expect(t.timeRemaining).toEqual(250)
  expect(t.isRunning).toBe(true)
  jest.advanceTimersByTime(501);
  expect(callback).toHaveBeenCalledTimes(1)
})
