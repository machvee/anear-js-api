"use strict"
module.exports = {
  "data": [
    {"id":"f11a7547-94f7-48fb-b8b0-1ffd94fde44a","type":"trivia-questions",
     "attributes":{"question-text":"How much is 1 + 41?","category":"math"},
     "relationships":{"trivia-answers":{"data":[
       {"id":"81c48038-57ec-4ca1-9456-e68e1978997c","type":"trivia-answers"},
       {"id":"d5830036-4ff7-4efa-bda9-22fb078e9c10","type":"trivia-answers"},
     ]}},
     "links":{"self":{"href":"http://api.localhost.com/developer/v1/trivia_questions/f11a7547-94f7-48fb-b8b0-1ffd94fde44a"}}}
 ],
 "included":[
   {"id":"81c48038-57ec-4ca1-9456-e68e1978997c","type":"trivia-answers",
    "attributes":{"answer-text":"40","correct":false}},
   {"id":"d5830036-4ff7-4efa-bda9-22fb078e9c10","type":"trivia-answers",
    "attributes":{"answer-text":"42","correct":true}},
 ]
}
