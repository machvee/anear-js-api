"use strict";

module.exports = {
  data: {
    "id": "6e33b669-a8c1-4548-9c55-1da3a6c8bae6",
    "type": "participants",
    "attributes": {
      "created-at": "2019-06-22T08:41:34.257Z",
      "name": "bbondfl93",
      "user-type": "participant",
      "private-channel-name": "anear:a:6i4GGPgY7i8E1jxE65vpov:e:15nirTFJWYwiZRVfhaTmOM:private:4aih3BnWiRXLHKupFFkKHO"
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
          "id": "d280da7c-1baf-4607-a286-4b5faa03eaa7",
        "type": "users"
        }
      }
    }
  },
  included: [
    {
      "id": "d280da7c-1baf-4607-a286-4b5faa03eaa7",
      "type": "users",
      "attributes": {
        "name": "bbondyo",
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
        "first-name": "Barbara",
        "last-name": "Bond",
        "bio": "Repellendus ut neque. Est autem cupiditate. In omnis dolore.",
        "homepage": "http://hodkiewicz.name/frankie",
        "avatar-url": "https://s3.amazonaws.com/anearassets/anon_user.png"
      },
      "links": {
        "self": "/v1/profiles/a04976a9-1c08-4bc6-b381-7f0d0637b919"
      }
    }
  ]
}
