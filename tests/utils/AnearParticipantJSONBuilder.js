"use strict";
const AnearParticipantJSONBuilder = ({eventId, id, userId, name, avatarUrl}) => {
  return {
    data: {
      "id": id,
      "type": "participants",
      "attributes": {
        "created-at": "2019-06-22T08:41:34.257Z",
        "name": name,
        "user-type": "participant",
        "private-channel-name": "anear:a:6i4GPGg7YiE81jxE65vpov:e:51nriTFWJYwiZRVfhaTmOM:private:4aih3BnWiRXLHKupFFkKHO"
      },
      "relationships": {
        "event": {
          "data": {
            "id": eventId,
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
        "id": userId,
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
          "self": `/v1/users/${userId}`
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
          "avatar-url": avatarUrl
        },
        "links": {
          "self": "/v1/profiles/b04976a9-1c08-4bc6-b381-7f0d0637b979"
        }
      }
    ]
  }
}

module.exports = AnearParticipantJSONBuilder
