"use strict"

const { TriviaQuestionsFixture1: json1 } = require("./fixtures")
const { TriviaQuestionsFixture2: json2 } = require("./fixtures")
const JsonApiArrayResource = require('../lib/models/JsonApiArrayResource')


class TriviaQuestions extends JsonApiArrayResource {
}

class MoreTriviaQuestions extends JsonApiArrayResource {
}

test('constructor', () => {
  const tq = new TriviaQuestions(json1)
  expect(tq.data.length).toBe(2)
})

test('attributes by index', () => {
  const tq = new TriviaQuestions(json1)
  let attr = tq.attributes(0)
  
  expect(attr['question-text']).toBe("How much is 1 + 15?")
  expect(attr.category).toBe("math")

  attr = tq.attributes(1)

  expect(attr['question-text']).toBe("How much is 1 + 62?")
  expect(attr.category).toBe("math")
})

test('id by index', () => {
  const tq = new TriviaQuestions(json1)
  const id = tq.id(0)

  expect(id).toBe("e9e45ca3-0569-4999-adbe-e7f4e04447bb")

})

test('relationships by index', () => {
  const tq = new TriviaQuestions(json1)
  const rel = tq.relationships(1)
  expect(rel['trivia-answers'].data.length).toBe(4)
  expect(rel['trivia-answers'].data[3].id).toBe("7dab1931-b77a-4a8e-a394-1bd5224a17ac")
})

test('find data by id', () => {
  const tq = new TriviaQuestions(json1)

  const d = tq.find("e9e45ca3-0569-4999-adbe-e7f4e04447bb")
  expect(d.id).toBe("e9e45ca3-0569-4999-adbe-e7f4e04447bb")

  const nd = tq.find("bogus")
  expect(nd).toBeNull
})

test('find attributes by id', () => {
  const tq = new TriviaQuestions(json1)

  const attr = tq.findAttributes("f427754a-24f7-48fb-b8b0-1ffd94fde44a")
  expect(attr['question-text']).toBe("How much is 1 + 62?")

  const na = tq.findAttributes("bogus")
  expect(na).toBeNull
})

test('find included', () => {
  const tq = new TriviaQuestions(json1)
  const rel = tq.relationships(1)
  const incData = tq.findIncluded(rel['trivia-answers'].data[3])

  expect(incData.attributes['answer-text']).toBe("63")
  expect(incData.attributes.correct).toBeTrue
})

test('append', () => {
  const tq1 = new TriviaQuestions(json1)
  const tq2 = new TriviaQuestions(json2)

  expect(tq1.data.length).toBe(2)
  expect(tq2.data.length).toBe(1)
  expect(tq1.included.length).toBe(8)
  expect(tq2.included.length).toBe(2)

  tq1.append(tq2)

  expect(tq1.data.length).toBe(2+1)
  expect(tq1.included.length).toBe(8+2)

  const attr = tq1.attributes(4)
  expect(attr).toBe(tq2.attributes(1))

})
