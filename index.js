const { getInput, setFailed, warning, info, debug } = require('@actions/core')
const wso2 = require('byu-wso2-request')
const { DateTime } = require('luxon')

const SANDBOX_API_HOST = 'api-sandbox.byu.edu'
const PRODUCTION_API_HOST = 'api.byu.edu'

async function run () {
// Grab some inputs from GitHub Actions
  const clientKey = getInput('client-key')
  const clientSecret = getInput('client-secret')
  const changeSysId = getInput('change-sys-id')
  const workStart = getInput('work-start')
  const success = getInput('success')
  const runInNonProduction = parseBooleanInput(getInput('run-in-non-production') || 'false')

  if (!clientKey || !clientSecret || (success !== 'true' && success !== 'false')) {
    setFailed('Missing an expected input')
    return
  }
  if (!changeSysId) {
    warning('No change-sys-id was provided. Skipping end-standard-change because start-standard-change likely no-oped.')
    return
  }
  if (!workStart) {
    setFailed('Missing an expected input')
    return
  }

  try {
    const host = await resolveApiHost(clientKey, clientSecret)

    if (host !== PRODUCTION_API_HOST && !runInNonProduction) {
      warning('Skipping Standard Change RFC end because this appears to be a non-production deployment. Set run-in-non-production to true if you want to end RFCs in sandbox.')
      process.exit(0)
    }

    // UTC, in ServiceNow's format
    const currentDateTime = DateTime.utc().toFormat('yyyy-LL-dd HH:mm:ss')

    // End the RFC
    const optionsToEndRfc = {
      method: 'PUT',
      uri: changeRequestUri(host, changeSysId),
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

    info(`${result.number} closed`)
    if (success === 'true') {
      info('The change was a success! 🎉')
    } else {
      warning('The change failed! 💥')
    }
    info(`Link to RFC: https://${host === 'api.byu.edu' ? 'support' : 'support-test'}.byu.edu/change_request.do?sysparm_query=number=${result.number}`)

    process.exit(0)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    const wso2TokenRegex = /[0-9a-f]{32}/g
    setFailed(errorMessage.replace(wso2TokenRegex, 'REDACTED'))
    process.exit(1)
  }
}

function requestWithRetry (options) {
  return wso2.request(options).catch(() => wso2.request(options))
}

function changeRequestUri (host, changeSysId) {
  return `https://${host}/domains/servicenow/changerequest/v1/change_request/${changeSysId}`
}

async function resolveApiHost (clientKey, clientSecret) {
  const hostsToTry = [SANDBOX_API_HOST, PRODUCTION_API_HOST]
  for (const candidateHost of hostsToTry) {
    try {
      await wso2.setOauthSettings(clientKey, clientSecret, { host: candidateHost })
      await requestWithRetry({
        method: 'GET',
        uri: `https://${candidateHost}/domains/servicenow/tableapi/v1/table/sys_user?sysparm_fields=sys_id&sysparm_limit=1`
      })
      return candidateHost
    } catch {
      debug(`Could not authenticate against ${candidateHost}`)
    }
  }

  throw new Error('Unable to authenticate with BYU sandbox or production API hosts.')
}

function parseBooleanInput (inputValue) {
  const normalizedValue = String(inputValue).trim().toLowerCase()
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalizedValue)
}

run()
