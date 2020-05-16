const { getInput, setFailed } = require('@actions/core')
const wso2 = require('byu-wso2-request')
const { DateTime } = require('luxon')

const localTimezoneIsAmericaDenver = (Intl.DateTimeFormat().resolvedOptions().timeZone === 'America/Denver')

// In ServiceNow format, which goes by Denver (Utah) time
// 2020-05-14 17:17:39 (5:17pm in Utah)
function getCurrentDateTime () {
  return (localTimezoneIsAmericaDenver) // We get a fairly big performance win from not having to specify the zone
    ? DateTime.local().toFormat('yyyy-LL-dd HH:mm:ss')
    : DateTime.local().setZone('America/Denver').toFormat('yyyy-LL-dd HH:mm:ss')
}

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

    const currentDateTime = getCurrentDateTime()

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
    const bodyWithResultsOfEndingRfc = await wso2.request(optionsToEndRfc).catch(() => wso2.request(optionsToEndRfc)) // Retry once
    const result = bodyWithResultsOfEndingRfc.result

    console.log(`${result.number} closed`)
    console.log(`Link to RFC: https://it.byu.edu/change_request.do?sysparm_query=number=${result.number}`)

    process.exit(0)
  } catch (err) {
    const wso2TokenRegex = /[0-9a-f]{32}/g
    setFailed(err.message.replace(wso2TokenRegex, 'REDACTED'))
    process.exit(1)
  }
}

run()
