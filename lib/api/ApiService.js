"use strict"
const ErrorResponse = require('./ErrorResponse')
const qs = require('qs')
const fetch = require('node-fetch')

const DeveloperApiURL = "https://api.anearapp.com/developer/v1"

class ApiService {

  constructor() {
    this.api_base_url = DeveloperApiURL
    this.defaultHeaderObject = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Api-Key': process.env.ANEARAPP_API_KEY
    }
    this.default_headers = new fetch.Headers(this.defaultHeaderObject)
  }

  idParamUrlString (resource, params) {
    let idParam = ''
    if (params.id) {
      idParam = `/${params.id}`
      delete params.id
    }
    const paramString = qs.stringify(params)
    let queryParams = ''
    if (paramString) queryParams = `?${paramString}`
    return `${this.api_base_url}/${resource}${idParam}${queryParams}`
  }

  prepareGetRequest (resource, params={}) {
    const urlString = this.idParamUrlString(resource, params) 
    return new fetch.Request(
      urlString, {
        method: 'GET',
        headers: this.default_headers
      }
    )
  }

  get (resource, params={}) {
    const request = this.prepareGetRequest(resource, params)
    return this.issueRequest(request)
  }

  post (resource, attributes, relationships={}) {
    const payload = this.formatPayload(resource, attributes, relationships)
    const request = new fetch.Request(
      `${this.api_base_url}/${resource}`, {
        method: 'POST',
        headers: this.default_headers,
        body: JSON.stringify(payload)
      }
    )
    return this.issueRequest(request)
  }

  put (resource, id, attributes, relationships={}) {
    const payload = this.formatPayload(resource, attributes, relationships)
    const urlString = `${this.api_base_url}/${resource}/${id}`
    const request = new fetch.Request(
      urlString, {
        method: 'PUT',
        headers: this.default_headers,
        body: JSON.stringify(payload)
      }
    )
    return this.issueRequest(request)
  }

  httpDelete (resource, id=null) {
    const idStr = (id ? `/${id}` : '')
    const urlString = `${this.api_base_url}/${resource}${idStr}`
    const request = new fetch.Request(
      urlString, {
        method: 'DELETE',
        headers: this.default_headers
      }
    )
    return this.issueRequest(request)
  }

  issueRequest (request) {
    return fetch(request)
             .then(this.checkStatus)
  }

  formatPayload (resource, attributes, relationships) {
    return {
      data: {
        type: resource,
        attributes,
        relationships: this.formatRelationships(relationships)
      }
    }
  }

  formatRelationships (relationships) {
    //
    // e.g. formatRelationships({event: eventId, user: userId})
    //
    const output = {}

    Object.entries(relationships).forEach(rel => {
      const resource = rel[0]
      const id = rel[1]

      output[resource] = {
        data: {
          type: resource + 's',
          id: id
        }
      }
    })
    return output
  }

  checkStatus (response) {
    if (response.status === 204) {
      return Promise.resolve({})
    } else {
      return response.json().then(json => {
        return response.ok ? json : Promise.reject(new ErrorResponse(json))
      })
    }
  }
}

module.exports = ApiService
