// Global Constants for Looker OAuth
// !!! IMPORTANT: Replace these placeholders with your actual Looker instance details !!!
const LOOKER_UI_HOST = PropertiesService.getScriptProperties().getProperty('LOOKER_BASE_URL'); 
const LOOKER_API_HOST = PropertiesService.getScriptProperties().getProperty('LOOKER_BASE_URL'); 
const LOOKER_CLIENT_ID = PropertiesService.getScriptProperties().getProperty('LOOKER_OAUTH_APP_CLIENT_ID'); // This is the 'client_guid' you registered in Looker
// The REDIRECT_URI will be dynamically determined by the OAuth2 library based on your web app deployment URL.
// Ensure this URL is registered EXACTLY as is with your Looker OAuth client application.
const AGENT_API_URL = `${PropertiesService.getScriptProperties().getProperty('AGENT_BASE_URL')}/ask`

// New Constant for the Logging Sheet
const LOG_SHEET_NAME = 'Question Log'; 

/**
 * Helper function to generate a cryptographically secure random string suitable for PKCE code_verifier.
 * Apps Script's Utilities.computeHmacSha256Signature is used for generating random bytes,
 * which are then converted to a Base64Url-encoded string.
 * @param {number} length The desired byte length of the random string (e.g., 32 for a 43-character base64url verifier).
 * @returns {string} A Base64Url-encoded random string.
 */
function generateCodeVerifier(length = 32) {
  // Generate random bytes using a simple hash of a UUID (Apps Script lacks direct SecureRandom)
  // For production scenarios requiring higher cryptographic strength for verifier,
  // consider a different environment or a more robust random string generation method.
  const randomBytes = Utilities.computeHmacSha256Signature(Utilities.getUuid(), Utilities.getUuid());
  
  // Take a portion of the bytes to match the requested length
  const verifierBytes = randomBytes.slice(0, length);
  
  // Encode to Base64Url and remove padding
  return Utilities.base64EncodeWebSafe(verifierBytes).replace(/=+$/, '');
}

/**
 * Computes the SHA256 hash of a string and then Base64Url encodes it.
 * This result is the PKCE code_challenge.
 * @param {string} message The string to hash (the code_verifier).
 * @returns {string} The Base64Url encoded SHA256 hash.
 */
function sha256HashAndBase64UrlEncode(message) {
  const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, message);
  return Utilities.base64EncodeWebSafe(hash).replace(/=+$/, ''); // Remove padding characters
}

/**
 * Stores key-value pairs in UserProperties, converting objects to JSON strings.
 * @param {string} key The key under which to store the data.
 * @param {Object} value The value to store.
 */
function setStoredData(key, value) {
  PropertiesService.getUserProperties().setProperty(key, JSON.stringify(value));
}

/**
 * Retrieves data from UserProperties, parsing JSON strings back into objects.
 * @param {string} key The key of the data to retrieve.
 * @returns {Object|null} The retrieved data, or null if not found.
 */
function getStoredData(key) {
  const data = PropertiesService.getUserProperties().getProperty(key);
  return data ? JSON.parse(data) : null;
}

/**
 * Deletes data from UserProperties.
 * @param {string} key The key of the data to delete.
 */
function deleteStoredData(key) {
  PropertiesService.getUserProperties().deleteProperty(key);
}

/**
 * Clears ALL User properties for OAuth testing and debugging.
 */
function deleteStoredDataAll() {
  PropertiesService.getUserProperties().deleteAllProperties();
  Browser.msgBox("Properties Cleared", "All stored user properties (tokens, verifiers) have been deleted.", Browser.Buttons.OK);
}

/**
 * Checks if the stored access token is still valid.
 * It considers a token expired if it's within 5 minutes of its expiry time.
 * @returns {boolean} True if the access token is valid and not expired, false otherwise.
 */
function isAccessTokenValid() {
  const accessInfo = getStoredData('looker_access_info');
  if (!accessInfo || !accessInfo.access_token || !accessInfo.expires_at) {
    return false;
  }
  // Check if token is expired (give a buffer of a few minutes to initiate refresh proactively)
  const expiresAt = new Date(accessInfo.expires_at).getTime();
  return (expiresAt > Date.now() + (5 * 60 * 1000)); // Valid for at least 5 more minutes
}

/**
 * Attempts to refresh the access token using the stored refresh token.
 * This is called automatically by getValidAccessToken if the current token is expired.
 * @returns {boolean} True if refresh was successful, false otherwise.
 */
function refreshAccessToken() {
  const accessInfo = getStoredData('looker_access_info');
  if (!accessInfo || !accessInfo.refresh_token) {
    Logger.log("No refresh token available to refresh.");
    return false;
  }

  const payload = {
    grant_type: 'refresh_token',
    client_id: LOOKER_CLIENT_ID,
    refresh_token: accessInfo.refresh_token,
  };

  const options = {
    method: 'post',
    contentType: 'application/json;charset=UTF-8',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(LOOKER_API_HOST + '/api/token', options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode === 200) {
      const newAccessInfo = JSON.parse(responseText);
      const expires_at = new Date(Date.now() + (newAccessInfo.expires_in * 1000));
      newAccessInfo.expires_at = expires_at;
      // Preserve the existing refresh token if a new one is not provided in the refresh response
      if (!newAccessInfo.refresh_token) {
        newAccessInfo.refresh_token = accessInfo.refresh_token;
      }
      setStoredData('looker_access_info', newAccessInfo);
      Logger.log("Access token refreshed successfully.");
      return true;
    } else {
      Logger.log(`Failed to refresh token. Code: ${responseCode}, Response: ${responseText}`);
      // Clear all tokens if refresh fails to force full re-authorization
      deleteStoredData('looker_access_info');
      return false;
    }
  } catch (e) {
    Logger.log(`Error during token refresh: ${e.message}`);
    deleteStoredData('looker_access_info'); // Clear tokens on error
    return false;
  }
}

/**
 * Retrieves the current valid access token, refreshing it if it's expired.
 * If no valid token is available and cannot be refreshed, it returns null.
 * @returns {string|null} The valid access token string, or null if authorization is required/failed.
 */
function getValidAccessToken() {
  if (isAccessTokenValid()) {
    const accessInfo = getStoredData('looker_access_info');
    return accessInfo.access_token;
  } else {
    // If token is invalid or near expiration, try to refresh it
    if (refreshAccessToken()) {
      const accessInfo = getStoredData('looker_access_info');
      return accessInfo.access_token;
    } else {
      // If refresh failed, authorization is truly needed
      return null;
    }
  }
}

/**
 * Logs the current redirect URI of the deployed web app.
 * Useful for debugging redirect_uri mismatches.
 * @returns {string} The redirect URI.
 */
function logRedirectUri() {
  const url = ScriptApp.getService().getUrl();
  Logger.log("Current Redirect URI: " + url);
  return url;
}

/**
 * Configures and returns the OAuth2 service for Looker.
 * NOTE: This service is now primarily used for generating the base authorization URL
 * and managing the callback function's association with the web app deployment.
 * The actual token exchange is manually handled in handleLookerCallback.
 */
function getLookerService() {
  const service = OAuth2.createService('Looker')
    // Set the authorization base URL (Looker UI host + /auth endpoint)
    .setAuthorizationBaseUrl(LOOKER_UI_HOST + '/auth')
    // The token URL is still needed by the library for internal mechanisms,
    // but we will manually perform the token exchange.
    .setTokenUrl(LOOKER_API_HOST + '/api/token') 
    // Set the client ID (which is your registered client_guid from Looker)
    .setClientId(LOOKER_CLIENT_ID)
    // The redirect URI is automatically set by the library when deployed as a web app.
    // The 'handleLookerCallback' function will be invoked when Looker redirects back.
    .setCallbackFunction('handleLookerCallback')
    // Use the user's properties service. While we manually store tokens,
    // the OAuth2 library might still use this for its own internal state management.
    .setPropertyStore(PropertiesService.getUserProperties()) 
    // Set the required scope for Looker API access. 'cors_api' is commonly used for browser-based access.
    .setScope('cors_api')
    // The response type for authorization code flow.
    .setParam('response_type', 'code');
    // Removed setParam('code_challenge_method', 'S256') as we're generating this manually
    // for the authorization URL and handling the verifier in the manual token exchange.
    // Removed setTokenUrlFetchOptions as it's not a valid function.

  return service;
}

/**
 * Initiates the OAuth2 authorization flow.
 * If the script doesn't have a valid access token for Looker, it generates
 * an authorization URL (including PKCE parameters) and displays it to the user.
 */
function showAuthorizationDialog() {
  // If no valid token, prepare for authorization.
  if (!getValidAccessToken()) { 
    const service = getLookerService();

    // Manually generate and store the code_verifier for PKCE.
    const code_verifier = generateCodeVerifier();
    const code_challenge = sha256HashAndBase64UrlEncode(code_verifier);
    
    // Store the verifier in user properties, which persists across requests.
    setStoredData('looker_code_verifier', code_verifier); 

    // Construct the full authorization URL including PKCE parameters.
    // The OAuth2 library's getAuthorizationUrl() provides the base URL and adds client_id, scope, redirect_uri.
    const authorizationUrl = service.getAuthorizationUrl() +
      '&code_challenge_method=S256' +
      '&code_challenge=' + encodeURIComponent(code_challenge);

    const ui = SpreadsheetApp.getUi();
    const htmlOutput = HtmlService.createHtmlOutput(
      '<p>This script needs your permission to access Looker. Please click the link below to authorize:</p>' +
      '<a href="' + authorizationUrl + '" target="_blank">Click here to Authorize Looker Access</a>' +
      '<p>After successfully authorizing, you can close the new browser tab and re-run your analytics question.</p>'
    )
      .setWidth(500)
      .setHeight(180);
    ui.showModalDialog(htmlOutput, 'Authorize Looker Integration');
  }
}

/**
 * This is the callback function that Looker redirects to after the user
 * has granted or denied authorization.
 * This function now manually handles the token exchange with Looker's /api/token endpoint,
 * ensuring the 'code_verifier' is sent as part of a JSON payload.
 *
 * This function MUST be part of an Apps Script project deployed as a Web App
 * with "Execute as: Me" and "Access: Anyone, even anonymous" to have a callable URL.
 * @param {GoogleAppsScript.Events.DoGet} request The event object from the HTTP GET request.
 * @returns {GoogleAppsScript.HTML.HtmlOutput} A simple HTML page indicating success or failure.
 */
function handleLookerCallback(request) {
  // Use HTML templates for success/error messages to the user in the browser tab.
  const successPage = HtmlService.createTemplateFromFile('SuccessPage');
  const errorPage = HtmlService.createTemplateFromFile('ErrorPage');

  try {
    const auth_code = request.parameter.code; // Extract authorization code from URL parameters
    // const state = request.parameter.state; // If you manually manage state, retrieve and verify it here

    if (!auth_code) {
      Logger.log("No authorization code in response from Looker.");
      errorPage.message = 'Authorization code not received from Looker.';
      return errorPage.evaluate().setSandboxMode(HtmlService.SandboxMode.IFRAME);
    }

    const code_verifier = getStoredData('looker_code_verifier');
    if (!code_verifier) {
      Logger.log("ERROR: Missing code_verifier in PropertiesService for token exchange.");
      errorPage.message = 'Missing code verifier. Please clear script properties and try authorizing again.';
      return errorPage.evaluate().setSandboxMode(HtmlService.SandboxMode.IFRAME);
    }
    deleteStoredData('looker_code_verifier'); // Clean up the verifier after use, as it's single-use

    // Get the exact redirect URI of this deployed web app.
    // This MUST match the redirect_uri registered with your Looker OAuth client exactly.
    const redirect_uri = logRedirectUri(); 

    // Construct the payload for the /api/token endpoint as application/json.
    const payload = {
      grant_type: 'authorization_code',
      client_id: LOOKER_CLIENT_ID,
      redirect_uri: redirect_uri, 
      code: auth_code,
      code_verifier: code_verifier,
    };

    const options = {
      method: 'post',
      contentType: 'application/json;charset=UTF-8', // Crucial for Looker's /token endpoint
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      headers: {
        'x-looker-appid': 'Apps Script Looker Agent', // Optional header
      },
    };

    Logger.log(`Attempting token exchange with Looker API: ${LOOKER_API_HOST}/api/token`);
    const response = UrlFetchApp.fetch(LOOKER_API_HOST + '/api/token', options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    Logger.log(`Looker /token response code: ${responseCode}`);
    Logger.log(`Looker /token response text: ${responseText}`);

    if (responseCode === 200) {
      const accessInfo = JSON.parse(responseText);
      const expires_at = new Date(Date.now() + (accessInfo.expires_in * 1000));
      accessInfo.expires_at = expires_at;
      setStoredData('looker_access_info', accessInfo); // Store the access and refresh token

      successPage.message = 'You have successfully authorized the script.';
      return successPage.evaluate().setSandboxMode(HtmlService.SandboxMode.IFRAME);
    } else {
      let errorMessage = `Failed to get access token (Code: ${responseCode}).`;
      try {
        const errorResponse = JSON.parse(responseText);
        errorMessage += `: ${errorResponse.error_description || errorResponse.error || 'Unknown error'}`;
      } catch (e) {
        errorMessage += ` Raw response: ${responseText}`;
      }
      Logger.log(errorMessage);
      errorPage.message = errorMessage;
      return errorPage.evaluate().setSandboxMode(HtmlService.SandboxMode.IFRAME);
    }

  } catch (e) {
    Logger.log(`Critical error in handleLookerCallback: ${e.message}`);
    errorPage.message = 'An unexpected error occurred during authorization. ' + e.message;
    return errorPage.evaluate().setSandboxMode(HtmlService.SandboxMode.IFRAME);
  }
}

/**
 * Gets the existing "Question Log" sheet or creates it if it doesn't exist.
 * Sets headers if the sheet is newly created.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet} The log sheet.
 */
function getOrCreateLogSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let logSheet = spreadsheet.getSheetByName(LOG_SHEET_NAME);

  if (!logSheet) {
    // If the sheet doesn't exist, create it.
    // Inserting at position 0 typically makes it the first tab.
    logSheet = spreadsheet.insertSheet(LOG_SHEET_NAME, 0); 
    
    // Set headers
    logSheet.getRange(1, 1, 1, 3).setValues([["Timestamp", "Question", "Query URL"]]);
    
    // Optional: Format headers and columns for better readability
    logSheet.getRange(1, 1, 1, 3).setFontWeight("bold").setBackground("#cfe2f3").setHorizontalAlignment("center");
    logSheet.setColumnWidth(1, 180); // Timestamp
    logSheet.setColumnWidth(2, 400); // Question
    logSheet.setColumnWidth(3, 250); // Query URL
  }
  return logSheet;
}


/**
 * Function to prompt the user for an analytics question and initiate the API call.
 */
function postQuestionFromPrompt() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt(
      'Enter your analytics question',
      'e.g., "What are the total sales by product category for the last quarter?"',
      ui.ButtonSet.OK_CANCEL
  );

  const button = result.getSelectedButton();
  const question = result.getResponseText();

  if (button === ui.Button.OK && question) {
    makeApiCallAndWriteResponse(question);
  } else if (button === ui.Button.CANCEL) {
    Browser.msgBox("Canceled", "Question submission canceled.", Browser.Buttons.OK);
  } else {
    Browser.msgBox("Error", "No question entered.", Browser.Buttons.OK);
  }
}

/**
 * Makes an API call to the Looker conversational agent, adding an OAuth bearer token,
 * and writes the structured response to a new sheet. It also logs the question
 * to a dedicated "Question Log" sheet.
 * @param {string} question The analytics question asked by the user.
 */
function makeApiCallAndWriteResponse(question) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const currentTimestamp = new Date(); // Get timestamp once for consistency

  // --- Display Loading Toast ---
  SpreadsheetApp.getActiveSpreadsheet().toast('Processing your request...', 'Please Wait', -1);

  const accessToken = getValidAccessToken(); // Use our new function to get a valid token

  // Check if an access token is available and valid.
  if (!accessToken) {
    // If no access, prompt the user for authorization.
    SpreadsheetApp.getActiveSpreadsheet().toast('', 'Authorization Required', 5); // Clear current toast
    showAuthorizationDialog(); // Show the authorization link.
    Browser.msgBox("Authorization Required", "Please authorize the script to access Looker in the new dialog. After authorization, close the tab and re-run your question.", Browser.Buttons.OK);
    return; // Exit the function, as authorization is pending.
  }

  const apiUrl = AGENT_API_URL;
  const payload = JSON.stringify({ question: question });

  const options = {
    method: "post",
    contentType: "application/json",
    payload: payload,
    muteHttpExceptions: true, // Prevents Apps Script from throwing an exception on HTTP errors (e.g., 4xx, 5xx)
    headers: {
      Authorization: `Bearer ${accessToken}`, // Add the obtained bearer token to the Authorization header
      'x-looker-appid': 'Apps Script Looker Agent' // Optional, as per Looker's example, for identifying your app
    }
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    Logger.log(responseText) // Keep this for debugging API response

    if (responseCode === 200) {
      const jsonResponseArray = JSON.parse(responseText);
      Logger.log(jsonResponseArray) // Keep this for debugging API response

      if (!Array.isArray(jsonResponseArray)) {
        Browser.msgBox("API Response Error", "Expected a JSON array from API but received a different structure. Please check the API response.", Browser.Buttons.OK);
        Logger.log("API returned non-array: " + responseText);
        return;
      }

      // --- Append to the dedicated Question Log tab ---
      const logSheet = getOrCreateLogSheet();
      logSheet.appendRow([
        Utilities.formatDate(currentTimestamp, spreadsheet.getSpreadsheetTimeZone(), "MM/dd/yyyy HH:mm:ss"), // Formatted Timestamp
        question,                          // The submitted question
        ""                                 // Empty column for Query URL (to be filled later)
      ]);
      logSheet.autoResizeColumn(1); // Auto-resize timestamp column for better fit

      // --- Create a NEW Sheet for each question (existing logic) ---
      // Generate a sheet name using a sanitized question and timestamp.
      const timestampForSheetName = Utilities.formatDate(currentTimestamp, spreadsheet.getSpreadsheetTimeZone(), "MMdd_HHmm");
      const sanitizedQuestion = question.replace(/[\[\]\/\?\\\*:]/g, '').substring(0, 40); 
      const newSheetName = `Query_${sanitizedQuestion}_${timestampForSheetName}`;

      // Insert the new sheet. It becomes the active sheet immediately.
      const outputSheet = spreadsheet.insertSheet(newSheetName);

      // --- Write the Question and Timestamp ---
      let currentRow = 1; 

      outputSheet.getRange(currentRow, 1).setValue("Question Asked:");
      outputSheet.getRange(currentRow, 2).setValue(question);
      currentRow++; 

      outputSheet.getRange(currentRow, 1).setValue("Timestamp:");
      outputSheet.getRange(currentRow, 2).setValue(currentTimestamp.toLocaleString());
      currentRow++; 

      // --- Add a blank row for separation ---
      currentRow++;

      // --- Write the JSON data as a table ---
      if (jsonResponseArray.length > 0) {
        // Dynamically get headers from the keys of the first object in the array.
        const dataHeaders = Object.keys(jsonResponseArray[0]);

        // Prepare the data rows for the table.
        const dataRows = [];
        jsonResponseArray.forEach(obj => {
          const row = [];
          dataHeaders.forEach(header => {
            row.push(obj[header] !== undefined ? obj[header] : ""); // Handle missing keys with empty strings.
          });
          dataRows.push(row);
        });

        // Write data headers to the sheet.
        outputSheet.getRange(currentRow, 1, 1, dataHeaders.length).setValues([dataHeaders]);
        currentRow++; 

        // Write the data rows.
        outputSheet.getRange(currentRow, 1, dataRows.length, dataRows[0].length).setValues(dataRows);
      } else {
        outputSheet.getRange(currentRow, 1).setValue("No structured data returned for this question.");
      }

      Browser.msgBox("Success", `API response (structured table) written to new tab: '${newSheetName}'. Question logged to '${LOG_SHEET_NAME}'.`, Browser.Buttons.OK);

    } else if (responseCode === 401) {
        // Specifically handle Unauthorized errors.
        // If the token is invalid or expired, reset the service to force re-authorization.
        Browser.msgBox("Authorization Error", "Access token expired or invalid. Please re-authorize the script by re-running your question.", Browser.Buttons.OK);
        // We manually clear properties now that we're managing tokens
        deleteStoredData('looker_access_info'); 
        deleteStoredData('looker_code_verifier');
    } else if (responseCode === 400 || responseCode === 500) {
      // Handle other common API errors (Bad Request, Internal Server Error).
      try {
        const errorResponse = JSON.parse(responseText);
        const errorMessage = errorResponse.detail || "Unknown error details.";
        Browser.msgBox("API Error", `Error ${responseCode}: ${errorMessage}`, Browser.Buttons.OK);
      } catch (e) {
        Browser.msgBox("API Error", `API call failed with code ${responseCode}: Could not parse error response. Raw text: ${responseText}`, Browser.Buttons.OK);
      }
    } else {
      // Handle any other unexpected HTTP response codes.
      Browser.msgBox("API Error", `API call failed with unexpected code ${responseCode}: ${responseText}`, Browser.Buttons.OK);
    }

  } catch (e) {
    // Catch any script-level errors during the UrlFetchApp call.
    Browser.msgBox("Script Error", "An error occurred during API call: " + e.message, Browser.Buttons.OK);
  } finally {
    // Always clear the loading toast when the operation completes or fails.
    SpreadsheetApp.getActiveSpreadsheet().toast('', 'Complete', 5);
  }
}

/**
 * Adds a custom menu to the spreadsheet when it's opened.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Custom Actions')
      .addItem('Ask Analytics Question (Prompt)', 'postQuestionFromPrompt')
      .addSeparator() // Separator for better organization
      .addItem('Clear OAuth Tokens (for Debugging)', 'deleteStoredDataAll') // New menu item for debugging
      .addToUi();
}
