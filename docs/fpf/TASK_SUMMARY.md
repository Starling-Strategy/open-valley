# Task Summary: Front Porch Forum Email Extraction

## Goal
We are building a data extraction pipeline to download all emails labeled **"Front Porch Forum"** from your personal Gmail (`macon.phillips@gmail.com`) and save them as a structured JSON file. This data will be used to analyze community intelligence for the **Open Valley** project.

## Technical Approach
*   **Script:** `scripts/fetch_fpf_emails.py`
*   **API:** Google Gmail API (Read-only scope)
*   **Authentication:** OAuth 2.0 with a local server flow.
*   **Output:** `data/fpf_emails.json`

## Status (Current)
We have successfully resolved the Authentication (OAuth) handshake issues that were blocking progress.

### Fixes Implemented
1.  **Redirect URI Mismatch:** Configured the script and Google Cloud Console to explicitly use `http://localhost:8088/`.
2.  **Account Selection:** Updated the script to force the browser to default to `macon.phillips@gmail.com` using `login_hint`.
3.  **Unverified App Error:** You manually added your email to the "Test Users" list in the Google Cloud Console, allowing you to bypass the verification warning.
4.  **Environment:** The script is set up to run via `uv` to handle dependencies (`google-auth`, `google-api-python-client`).

## How to Run
Since authentication is now complete (or will be upon the next successful run), you can execute the script from the terminal:

```bash
cd open-valley
uv run scripts/fetch_fpf_emails.py
```

## Next Steps
1.  **Verify Data:** Confirm that `data/fpf_emails.json` is created and contains the expected email data.
2.  **Parse Content:** The current script saves the raw email body. We may need to write a parser to extract specific fields (e.g., "Neighbor Name", "Topic", "Neighborhood") from the Front Porch Forum email format.
3.  **Database Import:** Load the structured data into the project's database for analysis.