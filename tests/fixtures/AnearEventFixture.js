"use strict";

module.exports = {
  data: {
    id: 'b2aa5a28-2aa1-4ba7-8e2f-fe11dfe1b971',
    type: 'events',
    attributes: {
      name: 'tic-tac-toe test',
      description: 'Dave\'s tic tac toe test',
      'created-at': '2019-06-02T13:38:17.808Z',
      'participation-radius': 25,
      'qr-image-url':
       'http://api.example.com/rails/active_storage/disk/eyJfcm...vYfX0=--7cf1d8...ca2bc8/qr_c436aedb6137c9a6.png\
          ?content_type=image%2Fpng&disposition=inline%3B+filename%3D\
          %22qr_c436aedb6137c9a6.png%22%3B+filename%2A%3DUTF-8%27%27qr_c436aedb6137c9a6.png',
      lat: '40.758895',
      lng: '-73.985131',
      altitude: '10',
      state: 'announce',
      flags: [],
      'spectators-channel-name': 'anear:z:mQesUKL2ROyfuDWWkUVZB:e:zKie83NNGfTy110eeEQy4:spectators',
      'event-channel-name': 'anear:z:mQesUKL2ROyfuDWWkUVZB:e:zKie83NNGfTy110eeEQy4:event',
      'participants-channel-name': 'anear:z:mQesUKL2ROyfuDWWkUVZB:e:zKie83NNGfTy110eeEQy4:participants',
      'actions-channel-name': 'anear:z:mQesUKL2ROyfuDWWkUVZB:e:zKie83NNGfTy110eeEQy4:actions' },
   relationships: {
     zone: {
       data: {
         id: '08dbf4ce-18b2-4d5a-a7d1-0c090b16251d',
         type: 'zones'
       }
     },
     user: {
       data: {
         id: "2d08adc7-b1af-4607-2a86-b45faa03eaa7", // from player1.js data.id
         type: 'users'
       }
     },
     'cloned-event': {
       data: null
     },
   },
   links: { self: '/v1/events/19aa5a28-2aa1-4ba7-8e2f-fe11dfe1b971' }
  },
  included: [
    {"id":"08dbf4ce-18b2-4d5a-a7d1-0c090b16251d",
      "type":"zones",
      "attributes":{"name":"bar messaging", "description":"Come chat it up with your pals or new friends", "max-participation-radius":2,
          "state":"active", "lat":null, "lng":null, "altitude":null, "zone-type":"global"},
      "relationships":{"app":{"data":{"id":"5b9d9838-17de-4a80-8a64-744c222ba722", "type":"apps"}}},
      "links":{"self":"/v1/zones/5b90d8e7-2577-4299-b791-562308fa53d2"}},
    {"id":"5b9d9838-17de-4a80-8a64-744c222ba722", "type":"apps",
      "attributes":{"short-name":"Schaden, Oberbrunner and Nicolas", "long-name":"Well, this is certainly.",
          "description":"though he was later discovered to be lying.",
          "image-url":null, "icon-url":null,
          "participant-timeout":32000},
        "relationships":{"developer":{"data":{"id":"dbc39b82-91db-43d8-9a2a-04d2ca2d6fd9", "type":"users"}}},
      "links":{"self":"/v1/apps/5b9d9838-17de-4a80-8a64-744c222ba722"}}
  ]
}
