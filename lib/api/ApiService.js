"use strict"

const ErrorResponse = require('./ErrorResponse')
const qs = require('qs')
const fetch = require('cross-fetch')

const DeveloperApiURL = 'https://api.anear.me/developer/'

class ApiService {
  constructor(apiKey, apiVersion) {
    this.api_base_url = DeveloperApiURL + apiVersion
    this.defaultHeaderObject = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey
    }
    this.default_headers = new fetch.Headers(this.defaultHeaderObject)
  }

  idParamUrlString(resource, params) {
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

  prepareGetRequest(resource, params={}) {
    const urlString = this.idParamUrlString(resource, params) 
    return new fetch.Request(
      urlString, {
        method: 'GET',
        headers: this.default_headers
      }
    )
  }

  get(resource, params={}) {
    const request = this.prepareGetRequest(resource, params)
    return this.issueRequest(request)
  }

  post(resource, attributes, relationships={}) {
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

  postRaw(path, body={}) {
    const urlString = `${this.api_base_url}/${path}`
    const request = new fetch.Request(
      urlString, {
        method: 'POST',
        headers: this.default_headers,
        body: JSON.stringify(body)
      }
    )
    return this.issueRequest(request)
  }

  put(resource, id, attributes, relationships={}) {
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

  httpDelete(resource, id=null) {
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

  async issueRequest(request) {
    const resp = await fetch(request)
    return this.checkStatus(resp)
  }

  formatPayload(resource, attributes, relationships) {
    return {
      data: {
        type: resource,
        attributes,
        relationships: this.formatRelationships(relationships)
      }
    }
  }

  formatRelationships(relationships) {
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

  async checkStatus(response) {
    if (response.status === 204) {
      return {}
    } else {
      const json = await response.json()
      if (response.ok ) return json
      throw new ErrorResponse(json)
    }
  }
}

module.exports = ApiService
