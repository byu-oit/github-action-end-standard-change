const { getInput, setFailed, warning } = require('@actions/core')
const wso2 = require('byu-wso2-request')
const { DateTime } = require('luxon')

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
    // Some setup required to make calls through Tyk
    // We don't know if creds passed in for sandbox or production. Trying sandbox first.
    let host = 'api-sandbox.byu.edu'
    try {
      await wso2.setOauthSettings(clientKey, clientSecret, { host })
      await requestWithRetry({ url: `https://${host}/echo/v1/echo/test` })
    } catch {
      // Try production if that didn't work
      host = 'api.byu.edu'
      await wso2.setOauthSettings(clientKey, clientSecret, { host })
      await requestWithRetry({ url: `https://${host}/echo/v1/echo/test` })
    }

    // UTC, in ServiceNow's format
    const currentDateTime = DateTime.utc().toFormat('yyyy-LL-dd HH:mm:ss')

    // End the RFC
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
    const { result } = await requestWithRetry(optionsToEndRfc)

    console.log(`${result.number} closed`)
    if (success === 'true') {
      console.log('The change was a success! 🎉')
    } else {
      warning('The change failed! 💥')
    }
    console.log(`Link to RFC: https://${host === 'api.byu.edu' ? 'support' : 'support-test'}.byu.edu/change_request.do?sysparm_query=number=${result.number}`)

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

run()
