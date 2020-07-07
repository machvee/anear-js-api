"use strict"
module.exports = {
  "data": [
    {"id":"e9e45ca3-0569-4999-adbe-e7f4e04447bb","type":"trivia-questions",
     "attributes":{"question-text":"How much is 1 + 15?","category":"math"},
     "relationships":{"trivia-answers":{"data":[
       {"id":"7da911c0-3876-42fc-939e-b0835cf9be43","type":"trivia-answers"},
       {"id":"43f73b79-9f94-4e03-9060-a19ea1792489","type":"trivia-answers"},
       {"id":"928711e3-242c-436d-9dbe-ca35e8f4b339","type":"trivia-answers"},
       {"id":"1e6d34e5-002f-4701-8a34-afba7f301b88","type":"trivia-answers"}
     ]}},
     "links":{"self":{"href":"http://api.localhost.com/developer/v1/trivia_questions/e9e45ca3-0569-4999-adbe-e7f4e04447bb"}}},
    {"id":"f427754a-24f7-48fb-b8b0-1ffd94fde44a","type":"trivia-questions",
     "attributes":{"question-text":"How much is 1 + 62?","category":"math"},
     "relationships":{"trivia-answers":{"data":[
       {"id":"29b48038-57ec-4ca1-9456-e68e1978997c","type":"trivia-answers"},
       {"id":"b6b30036-4ff7-4efa-bda9-22fb078e9c10","type":"trivia-answers"},
       {"id":"9966ab89-149c-4f2f-8a20-0af2705a00a7","type":"trivia-answers"},
       {"id":"7dab1931-b77a-4a8e-a394-1bd5224a17ac","type":"trivia-answers"}
     ]}},
     "links":{"self":{"href":"http://api.localhost.com/developer/v1/trivia_questions/f427754a-24f7-48fb-b8b0-1ffd94fde44a"}}}
 ],
 "included":[
   {"id":"7da911c0-3876-42fc-939e-b0835cf9be43","type":"trivia-answers",
    "attributes":{"answer-text":"17","correct":false}},
   {"id":"43f73b79-9f94-4e03-9060-a19ea1792489","type":"trivia-answers",
    "attributes":{"answer-text":"18","correct":false}},
   {"id":"928711e3-242c-436d-9dbe-ca35e8f4b339","type":"trivia-answers",
    "attributes":{"answer-text":"59","correct":false}},
   {"id":"1e6d34e5-002f-4701-8a34-afba7f301b88","type":"trivia-answers",
    "attributes":{"answer-text":"16","correct":true}},
   {"id":"29b48038-57ec-4ca1-9456-e68e1978997c","type":"trivia-answers",
    "attributes":{"answer-text":"64","correct":false}},
   {"id":"b6b30036-4ff7-4efa-bda9-22fb078e9c10","type":"trivia-answers",
    "attributes":{"answer-text":"65","correct":false}},
   {"id":"9966ab89-149c-4f2f-8a20-0af2705a00a7","type":"trivia-answers",
    "attributes":{"answer-text":"106","correct":false}},
   {"id":"7dab1931-b77a-4a8e-a394-1bd5224a17ac","type":"trivia-answers",
    "attributes":{"answer-text":"63","correct":true}}
 ]
}
