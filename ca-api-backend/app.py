import asyncio
import aiohttp
import json
import logging
from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import JSONResponse # Use JSONResponse for non-streaming JSON output
from pydantic import BaseModel
from typing import Optional
import os # Import os to potentially use environment variables
from google.auth import default
from google.auth.transport.requests import Request as gRequest
import requests

# --- PLACEHOLDERS ---
# You need to replace these with your actual implementations or values
# WARNING: Hardcoding credentials like this is NOT secure for production.
# Use environment variables or a secrets manager (like Google Secret Manager)
# in a real-world application.


# --- Cortado Setup ---
SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]

# CA API System Instructions
sys_instructions = """
- system_description: >-
    You are an expert data analyst and understand how to answer questions about
    various analytics data.
"""

def get_auth_token():
    """Shows basic usage of the Google Auth library in a Colab environment.
    Returns:
      str: The API token.
    """
    credentials, _ = default(scopes=SCOPES)
    auth_req = gRequest()
    credentials.refresh(auth_req)  # refresh token
    if credentials.valid:
        return credentials.token

# Consider fetching system instructions from environment variables or a config file
CORTADO_SYS_INSTRUCTIONS = sys_instructions

# --- END PLACEHOLDERS ---

# Configure basic logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Define the request body model
class QuestionRequest(BaseModel):
    question: str
    # data_part: Optional[str]

app = FastAPI()

# Your original NLQ function adapted to wait for the full response
async def process_nlq_request(question: str, access_token: str):
    """
    Processes the natural language question, waits for the full response
    from the external API, and returns the complete JSON result.
    """
    try:
        token = get_auth_token() # Get your auth token

        # SECURITY RISK: Hardcoded credentials. Move these to environment variables
        # or a secrets manager in production.
        client_id = os.environ.get("LOOKER_CLIENT_ID", "")
        client_secret = os.environ.get("LOOKER_CLIENT_SECRET", "")
        PROJECT_ID = os.environ.get("PROJECT", "")
        PROJECT = f"projects/{PROJECT_ID}/locations/global"

        payload = {
            "project": PROJECT,
            "messages": [
                {
                    "userMessage": {
                        "text": question
                    }
                }
            ],
            "inlineContext": {
                "systemInstruction": f"""{CORTADO_SYS_INSTRUCTIONS}""",
                "datasourceReferences": {
                    "looker": {
                        "exploreReferences": [
                            {
                                "lookerInstanceUri": os.environ.get("LOOKER_INSTANCE",""),
                                "lookmlModel": os.environ.get("LOOKML_MODEL",""),
                                "explore": os.environ.get("LOOKML_EXPLORE",""),
                            }
                        ],
                        "credentials": {
                            "oauth": {
                                "token": {
                                    "access_token": access_token
                                }
                            }
                        }
                    }
                }
            }
        }
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream" # Still request event-stream from upstream
        }
        url = f"https://geminidataanalytics.googleapis.com/v1alpha/projects/{PROJECT_ID}/locations/global:chat"

        data = []

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, headers=headers) as resp:
                if resp.status == 200:
                    buffer = ''
                    async for chunk in resp.content.iter_any():
                        if not chunk:
                            continue

                        decoded_chunk = chunk.decode('utf-8').strip()
                        buffer += decoded_chunk
                        logging.debug(f"Received chunk: {decoded_chunk}") # Log the chunk

                        # Try to find complete JSON objects
                        while True:
                            try:
                                start_idx = buffer.find('{')
                                if start_idx == -1:
                                    break

                                # Find matching end brace
                                brace_count = 0
                                end_idx = start_idx

                                for i in range(start_idx, len(buffer)):
                                    char = buffer[i]
                                    if char == '{':
                                        brace_count += 1
                                    elif char == '}':
                                        brace_count -= 1

                                    if brace_count == 0:
                                        end_idx = i + 1
                                        break

                                if brace_count != 0:
                                    break

                                # Extract and yield complete JSON
                                json_str = buffer[start_idx:end_idx].strip()
                                json_str = json_str[:-len("]")] if json_str.endswith("]") else json_str
                                try:
                                    json.loads(json_str) #validate json
                                except json.JSONDecodeError as e:
                                    logging.error(f"JSONDecodeError: {e}, for string: {json_str}")
                                    buffer = buffer[end_idx:]
                                    break # Important: Break after error
                                buffer = buffer[end_idx:]
                                yield json.loads(json_str)
                                await asyncio.sleep(0)

                            except Exception as e:
                                logging.error(f"Error processing chunk: {e}, buffer: {buffer}")
                                break # Important: Break on any error

                    # Handle any remaining complete JSON in buffer
                    if buffer.strip() and buffer.strip() != "]":
                       yield json.loads(buffer)
                else:
                    # format json object error message that can be parsed in the frontend
                    error_text = await resp.text()
                    logging.error(f"Error from server: {resp.status} - {error_text}")
                    yield str(json.dumps({"error": error_text, "code": resp.status}))
        
    except:
        logging.error("some Errror")


@app.post("/ask")
async def ask_endpoint(request: QuestionRequest, authorization: Optional[str] = Header(None)):
    """
    FastAPI endpoint to receive a natural language question and return
    the complete analytics response as JSON.
    """
    token = None
    if authorization:
        parts = authorization.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]
        else:
            raise HTTPException(status_code=401, detail="Invalid Authorization header format. Expected 'Bearer <token>'")
    
    if not token:
        raise HTTPException(status_code=401, detail="Authorization token is missing.")

    logger.info(f"Received question: {request.question}")
    # Call the function that waits for the full response
    data = []
    async for chunk in process_nlq_request(request.question,token):
        print(chunk, type(chunk))
        if 'data' in chunk['systemMessage']:
            print(chunk['systemMessage'])
            if 'result' in chunk['systemMessage']['data']:
                print(chunk['systemMessage']['data'])
                data = chunk['systemMessage']['data']['result']['data']
                break
    print("Chunks: ", data)

    return JSONResponse(content=data, status_code=200)


# Optional: Add a root endpoint for health checks
@app.get("/")
async def read_root():
    return {"status": "ok"}
