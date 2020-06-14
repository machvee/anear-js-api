"use strict";

module.exports = {
  "AnearParticipantFixture1": {
    data: {
      "id": "96e33b66-a8c1-4548-9c55-1da3a6c8bae6",
      "type": "participants",
      "attributes": {
        "created-at": "2019-06-22T08:41:34.257Z",
        "name": "machvee",
        "private-channel-name": "anear:a:6i4GPGg7YiE81jxE65vpov:e:51nriTFWJYwiZRVfhaTmOM:private:4aih3BnWiRXLHKupFFkKHO"
      },
      "relationships": {
        "event": {
          "data": {
            "id": "b2aa5a28-2aa1-4ba7-8e2f-fe11dfe1b971",
            "type": "events"
          }
        },
        "user": {
          "data": {
            "id": "2d08adc7-b1af-4607-2a86-b45faa03eaa7",
          "type": "users"
          }
        }
      }
    },
    included: [
      {
        "id": "2d08adc7-b1af-4607-2a86-b45faa03eaa7",
        "type": "users",
        "attributes": {
          "name": "dave_mcvicar",
          "created-at": "2019-06-22T08:41:33.877Z"
        },
        "relationships": {
          "profile": {
            "data": {
              "id": "a04976a9-1c08-4bc6-b381-7f0d0637b919",
              "type": "profiles"
            }
          }
        },
        "links": {
          "self": "/v1/users/d280da7c-1baf-4607-a286-4b5faa03eaa7"
        }
      },
      {
        "id": "a04976a9-1c08-4bc6-b381-7f0d0637b919",
        "type": "profiles",
        "attributes": {
          "first-name": "Dave",
          "last-name": "McVicar",
          "bio": "Repellendus ut neque. Est autem cupiditate. In omnis dolore.",
          "homepage": "http://hodkiewicz.name/frankie",
          "avatar-url": "https://s3.amazonaws.com/anearassets/anon_user.png"
        },
        "links": {
          "self": "/v1/profiles/b04976a9-1c08-4bc6-b381-7f0d0637b979"
        }
      }
    ]
  }
}
