"use strict"
const ErrorResponse = require('./ErrorResponse')
const qs = require('qs')
const fetch = require('cross-fetch')

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

  async get(resource, params={}) {
    const request = this.prepareGetRequest(resource, params)
    return await this.issueRequest(request)
  }

  async post(resource, attributes, relationships={}) {
    const payload = this.formatPayload(resource, attributes, relationships)
    const request = new fetch.Request(
      `${this.api_base_url}/${resource}`, {
        method: 'POST',
        headers: this.default_headers,
        body: JSON.stringify(payload)
      }
    )
    return await this.issueRequest(request)
  }

  async put(resource, id, attributes, relationships={}) {
    const payload = this.formatPayload(resource, attributes, relationships)
    const urlString = `${this.api_base_url}/${resource}/${id}`
    const request = new fetch.Request(
      urlString, {
        method: 'PUT',
        headers: this.default_headers,
        body: JSON.stringify(payload)
      }
    )
    return await this.issueRequest(request)
  }

  async httpDelete(resource, id=null) {
    const idStr = (id ? `/${id}` : '')
    const urlString = `${this.api_base_url}/${resource}${idStr}`
    const request = new fetch.Request(
      urlString, {
        method: 'DELETE',
        headers: this.default_headers
      }
    )
    return await this.issueRequest(request)
  }

  async issueRequest(request) {
    const resp = await fetch(request)
    return await this.checkStatus(resp)
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
