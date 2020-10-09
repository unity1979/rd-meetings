const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');
const _ = require('underscore')
const moment = require('moment')
const cached = require('./redis/basicCache').cached
const isUrl = require("is-valid-http-url");

let auth;

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';

// Load client secrets from a local file.
fs.readFile('credentials.json', (err, content) => {
  console.log(JSON.parse(content))
  if (err) return console.log('Error loading client secret file:', err);
  // Authorize a client with credentials, then call the Google Sheets API.
  authorize(JSON.parse(content));
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials) {
  const {client_secret, client_id, redirect_uris} = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
      client_id, client_secret, redirect_uris[0]);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client);
    oAuth2Client.setCredentials(JSON.parse(token));
    auth = oAuth2Client
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  console.log('Authorize this app by visiting this url:', authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question('Enter the code from that page here: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('Error while trying to retrieve access token', err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('Token stored to', TOKEN_PATH);
      });
      auth = oAuth2Client;
    });
  });
}

/**
 * Prints the names and majors of students in a sample spreadsheet:
 * @see https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
 * @param {google.auth.OAuth2} auth The authenticated Google OAuth client.
 */
const maximumRows = 1000
// onlyGender could be 'men' or 'women'
async function getMeetings(onlyGender = '') {
  const sheets = google.sheets({version: 'v4', auth});

  /*
  const res = await cached('googleSheet', '', 3600, async () => await sheets.spreadsheets.values.get({
    spreadsheetId: '13sb_3p0pX-WLMnQP9kOszR1WE5LeeeamycD_carKn0g',
    range: `(unsorted)!C3:K${maximumRows}`,
  }))
  */
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: '13sb_3p0pX-WLMnQP9kOszR1WE5LeeeamycD_carKn0g',
    range: `(unsorted)!D3:L${maximumRows}`,
  })

  const rows = res.data.values;
  const dateformat = 'dddd h:mm A'
  const dateregex = /(\w+) (\d+):(\d+) (\w+)/
  if (rows.length) {
    const now = moment.utc()
    console.log('now', now)

    const meetings = rows.map((row) => {
      const date = row[0]
      const description = row[1].toLowerCase()
      const openColumn = (row[row.length - 1]).toLowerCase()
      const genderSpecific =
        (openColumn.includes('men') || description.includes('men'))
        ? 'men'
        : (openColumn.includes('women') || description.includes('women'))
          ? 'women'
          : ''

      const isOpen = openColumn.includes("yes") && !genderSpecific
      const password = row[row.length - 2]
      const url = row[row.length - 3].trim()

      try {
        const [all, dayOfWeek, hour, minute, AMPM] = row[0].match(dateregex)
        const datetime = moment.utc()
        datetime.set('day', dayOfWeek)
        const hourToSet = AMPM == 'PM'
          ? parseInt(hour) + 12
          : hour == 12
            ? 0
            : parseInt(hour)
        datetime.set('hour', hourToSet)
        datetime.set('minute', minute)
        return { genderSpecific, url, password, isOpen, hourToSet,  datetime, dayOfWeek, hour, minute, AMPM }
      } catch(e) {
        return null
      }
    })
    .filter((m) => m)
    .filter((m) => {
      // if we're only doing one gender make sure its not gender specific or specific to a gender
      if (onlyGender) {
        return m.genderSpecific == onlyGender || !m.genderSpecific
      }
      return m.isOpen
    })
    .filter((m) => {
      return isUrl(m.url) && m.url.includes('zoom')
    })
    .map((m) => {
      m.minutesUntilMeeting = m.datetime.diff(moment(), 'minutes')
      m.minutesSinceMeeting = moment().diff(m.datetime, 'minutes')
      return m
    })
    // only get ones that are < 10 minutes from starting
    // OR are less than 30 minutes since starting
    .filter((m) => {
      return (m.minutesSinceMeeting > 0 && m.minutesSinceMeeting < 45)
        || (m.minutesUntilMeeting > 0 && m.minutesUntilMeeting < 15)
    })
    // weight meetings that are upcoming higher than those that are already started (hence 4x)
    const sortedMeetings = _.sortBy(meetings, (m) => m.minutesUntilMeeting > 0 ? -4 * m.minutesUntilMeeting : -m.minutesSinceMeeting)

    const firstFew = sortedMeetings.slice(0, 4)

    return firstFew;
  } else {
    return []
  }
}
module.exports = {
  getMeetings
}
