const { getInput, setFailed, warning } = require('@actions/core')
const wso2 = require('byu-wso2-request')
const { DateTime } = require('luxon')
const jsonWebToken = require('jsonwebtoken')

async function run () {
// Grab some inputs from GitHub Actions
  const clientKey = getInput('client-key')
  const clientSecret = getInput('client-secret')
  const changeSysId = getInput('change-sys-id')
  const workStart = getInput('work-start')
  const success = getInput('success')
  if (!clientKey || !clientSecret || !changeSysId || !workStart || (success !== 'true' && success !== 'false')) {
    setFailed('Missing an expected input')
    return
  }

  try {
    // Some setup required to make calls through WSO2
    await wso2.setOauthSettings(clientKey, clientSecret)

    // UTC, in ServiceNow's format
    const currentDateTime = DateTime.utc().toFormat('yyyy-LL-dd HH:mm:ss')

    // End the RFC (and figure out if we're doing it in sandbox or production)
    const optionsToEndRfc = {
      method: 'PUT',
      uri: `https://api.byu.edu:443/domains/servicenow/changerequest/v1/change_request/${changeSysId}`,
      body: {
        state: 'Finished',
        work_start: workStart,
        work_end: currentDateTime,
        u_task_work_log: 'Closed via GitHub Action',
        u_completion_rating: success === 'true' ? 1 : 5, // 1 = Successful, 5 = Failed
        ...(success === 'false' && { // Conditionally add these properties
          u_failure_start: currentDateTime,
          u_failure_end: currentDateTime
        })
      }
    }
    let errorOccurredWhileGettingCredentialsType = false
    const [bodyWithResultsOfEndingRfc, credentialsType] = await Promise.all([
      requestWithRetry(optionsToEndRfc),
      getTypeOfCredentials().catch(() => { errorOccurredWhileGettingCredentialsType = true; return 'PRODUCTION' })
    ])
    if (errorOccurredWhileGettingCredentialsType) {
      console.log('⚠️ An error occurred while trying to determine if production or sandbox credentials were used for ServiceNow. ⚠️')
      console.log('The standard change was still ended in the correct environment.')
      console.log('So the link provided below will be for the production environment, even though you may have used sandbox credentials. 🤷')
    }
    const result = bodyWithResultsOfEndingRfc.result

    console.log(`${result.number} closed`)
    if (success === 'true') {
      console.log('The change was a success! 🎉')
    } else {
      warning('The change failed! 💥')
    }
    console.log(`Link to RFC: https://${credentialsType === 'PRODUCTION' ? 'support' : 'support-test'}.byu.edu/change_request.do?sysparm_query=number=${result.number}`)

    process.exit(0)
  } catch (err) {
    const wso2TokenRegex = /[0-9a-f]{32}/g
    setFailed(err.message.replace(wso2TokenRegex, 'REDACTED'))
    process.exit(1)
  }
}

function requestWithRetry (options) {
  return wso2.request(options).catch(() => wso2.request(options))
}

async function getTypeOfCredentials () {
  const options = { uri: 'https://api.byu.edu:443/echo/v1/echo/test', simple: true }
  const { Headers: { 'X-Jwt-Assertion': [jwt] } } = await requestWithRetry(options)
  const decoded = jsonWebToken.decode(jwt)
  return decoded['http://wso2.org/claims/keytype'] // 'PRODUCTION' | 'SANDBOX'
}

run()
