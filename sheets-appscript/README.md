# Apps Script Looker Integration with OAuth

This guide provides instructions for setting up your Google Apps Script project to integrate with Looker using OAuth 2.0. The setup involves registering your application with Looker, deploying your Apps Script as a web app, and configuring the necessary constants within your script.

---

## Looker OAuth Setup

Before your Apps Script can authenticate with Looker, you need to register your application as an OAuth client within your Looker instance. This registration tells Looker about your application and the authorized `redirect_uri` it will use.

1.  **Access Looker API Explorer:**
    * Navigate to your Looker instance's API Explorer (can be installed from the Looker Marketplace).
    * Select **API 4.0 - stable** from the version dropdown.

2.  **Register Your OAuth Client Application:**
    * Find the `Auth` method and locate the `register_oauth_client_app()` API endpoint. You can use the search bar for "oauth app".
    * Click "Run It" and fill in the following parameters. You'll need to obtain the `redirect_uri` from your Apps Script deployment first (see the Apps Script Setup section below).

    ```json
    {
      "client_guid": "YOUR_UNIQUE_CLIENT_ID",
      "redirect_uri": "YOUR_APPS_SCRIPT_WEB_APP_URL",
      "display_name": "Apps Script Looker Analytics Agent",
      "description": "Allows an Apps Script to query Looker data and log questions."
    }
    ```
    * **`client_guid`**: This is a globally unique ID for your application. Choose something descriptive and unique (e.g., `ca-api-appscript` or a UUID). This value will also be used as `LOOKER_CLIENT_ID` in your Apps Script code.
    * **`redirect_uri`**: This is the most crucial part. It **must** exactly match the "Web app URL" you obtain after deploying your Apps Script project (as described in the next section). Any mismatch will cause an `Invalid redirect_uri` error.
    * **`display_name`**: A user-friendly name that will be shown to users when they authorize your app.
    * **`description`**: A brief explanation of what your application does, displayed to users on the authorization consent screen.

    After filling in the parameters, click "Run It" to register your application. If you need to update an existing registration, you'll run this endpoint again with the same `client_guid` and updated `redirect_uri` or other details.

---

## Apps Script Setup

Your Apps Script project needs to be configured correctly to handle the OAuth flow and interact with Looker.

1.  **Add OAuth2 for Apps Script Library:**
    * Open your Apps Script project.
    * In the left sidebar, click `+` next to "Libraries".
    * In the "Add a library" field, paste the Script ID: `1B7XdJpDtYx_pLzYI_g7P_S_pYxU_D-D41_Jc7U_Jc7_D41_pYxU`.
    * Click "Look up", select the latest version, and set the Identifier to `OAuth2`. Click "Add".

2.  **Configure Global Constants:**
    * Update the following global properites in the `Project Settings` -> `Script Properties` section with your specific Looker instance details, API URL and the `client_guid` you registered:

    ```
    LOOKER_BASE_URL=<This is your Looker instance url with no backslash>
    LOOKER_OAUTH_APP_CLIENT_ID=<This is the Unique Client ID you filled in for the prior Looker OAuth setup step>
    AGENT_BASE_URL=<This is the base url for the Deployed Cloud Run service>
    ```

3.  **Include HTML Template Files:**
    * Your script uses `SuccessPage.html` and `ErrorPage.html` for the OAuth callback success/error messages.
    * **Ensure these HTML files are present in your Apps Script project.** If they are in your repository, you'll need to manually copy and paste their contents into new HTML files within your Apps Script project.
    * In your Apps Script project, go to `File` > `New` > `HTML file`.
    * Create a file named `SuccessPage` and paste the content from your `SuccessPage.html` repo file.
    * Create another file named `ErrorPage` and paste the content from your `ErrorPage.html` repo file.

4.  **Deploy as Web App and Get `redirect_uri`:**
    * In your Apps Script project, go to `Deploy` > `New deployment`.
    * Click the "Select type" icon (gear) and choose "Web app".
    * Set "Execute as" to `Me` (your Google account).
    * Set "Who has access" to `Anyone` (even anonymous) - this is crucial for the OAuth callback to work.
    * Click "Deploy".
    * **Copy the entire "Web app URL"** provided. This is your `redirect_uri`. **This is the URL you must use when registering or updating your OAuth client in Looker.**

5.  **Execution and Usage:**
    * Once your script is deployed and your Looker OAuth client is registered with the correct `redirect_uri`:
        1.  Open your Google Sheet.
        2.  You should see a new custom menu item: `Custom Actions`.
        3.  Select `Custom Actions` > `Ask Analytics Question (Prompt)`.
        4.  **First Run (Authorization):** The first time you run this, a dialog will appear with a link to authorize your script. Click this link, complete the authorization in the new browser tab, and then close that tab.
        5.  **Subsequent Runs:** After authorization, you can re-run `Ask Analytics Question (Prompt)`. The script will use the stored token to make API calls.
        6.  **Question Log:** A new sheet named "Question Log" will be created (if it doesn't exist) to keep a running history of all submitted questions. Each successful API call will also create a new tab with the detailed response.

6.  **Debugging / Clearing Tokens:**
    * If you encounter issues with authentication (e.g., "state token invalid" or "missing code verifier"), you might need to clear the stored OAuth tokens.
    * From the `Custom Actions` menu, select `Clear OAuth Tokens (for Debugging)`. This will remove all stored token information, forcing a full re-authorization on the next attempt.