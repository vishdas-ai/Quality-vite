from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
import json
import logging
from google.cloud import bigquery
import vertexai
from vertexai.generative_models import GenerativeModel
import os
from dotenv import load_dotenv
import re
from itertools import groupby
from operator import itemgetter
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os

# Load environment variables
load_dotenv()

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
PROJECT_ID = os.getenv("PROJECT_ID")
LOCATION = os.getenv("LOCATION")
DATASET_NAME = os.getenv("DATASET_NAME")
MODEL_NAME = os.getenv("MODEL_NAME")

client = bigquery.Client()

app = FastAPI()
origins = [
    "http://localhost:5173",  # Replace with your Vite frontend URL
    # Add other origins as needed
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Update this with your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    query: str

class MoreInfoRequest(BaseModel):
    table_name: str
    codes: list[str] = []
    cust_conc_cds: list[str] = []
    ccc_codes: list[str] = []

def get_table_schema_and_description(dataset_name):
    dataset_ref = client.dataset(dataset_name)
    table_names = ['qnps_embedding', 'warranty_embedding']
    table_schemas = {}

    def get_fields(schema):
        return [(field.name, field.field_type, field.mode, field.description) for field in schema]

    for table_name in table_names:
        table_ref = dataset_ref.table(table_name)
        table = client.get_table(table_ref)
        table_schemas[table.table_id] = {
            'description': table.description,
            'schema': get_fields(table.schema)
        }
    
    return table_schemas

def determine_search_method(query):
    table_schema = get_table_schema_and_description(DATASET_NAME)
    
    vertexai.init(project=PROJECT_ID, location=LOCATION)
    model = GenerativeModel(MODEL_NAME)
    
    prompt = f"""
    Given the following user question and table schemas, determine which table to use and whether to use vector search or text2sql. Analyze the question carefully and consider the available columns and their descriptions in each table.

    User question: {query}
    Table schemas: {table_schema}

    Table schemas:
    1. qnps_embedding:
       - Description: Stores customer feedback and sentiment analysis data on various aspects of vehicles.
       - Key columns: verbatim (customer feedback text), verbatim_embedding (vector representation of feedback), sentiment, polarity, ccc_code (Customer Concern Category), vfg_code (Vehicle Functional Group), function_code
       - Important note: The verbatim column contains customer feedback text, which can be used for semantic search.
       - If user asks about customer feedback or sentiment, choose qnps_embedding table.
       - Dont Choose the qnps_embedding table if the question is about repair costs, frequent issues, specific feature-related issues or specific diagnostic codes.

    2. warranty_embedding:
       - Description: Stores comprehensive data related to warranty claims, including claim details, vehicle information, repair process, and associated costs.
       - Key columns: combined_issue_details (customer and technician descriptions), combined_issue_details_embedding (vector representation of issue details), dtc_code (Diagnostic Trouble Code), cust_conc_cd (Customer Concern Code), lbr_cost, mtrl_cost, tot_cost_gross
       - Important note: The combined_issue_details column contains both customer and technician descriptions of the issue, which can be used for semantic search.
       
       
    IMPORTANT GUIDELINES WHEN CHOOSING THE TABLE:
    - Use qnps_embedding table if the question is about customer feedback or sentiment analysis.
    - Use warranty_embedding table if the question is about warranty claims, repair costs, or specific diagnostic codes.
    - If user aks about any particular issues choose warranty_embedding table.
    - Dont Choose the qnps_embedding table if the question is about repair costs, frequent issues, specific feature-related issues or specific diagnostic codes.
    - If user asks any particular issue like what are the issues with sunroof leakage, What are the issues with braking, any isses choose warranty_embedding table.
    
    Respond with the following information in JSON format:
    1. table_name: The name of the table to use (either "qnps_embedding" or "warranty_embedding")
    2. search_method: Either "vector_search" or "text2sql"
    3. reason: A detailed explanation for your choice, referencing specific columns and aspects of the question

    Guidelines for selection:
    - Use vector_search if:
      a) The question asks for similar or related items
      b) The question requires semantic understanding or natural language processing
      c) The question is about finding patterns or trends in customer feedback or issue descriptions
      d) The relevant information is likely contained within text fields (verbatim or combined_issue_details)
      e) The question is about customer sentiment, feedback trends, all general issues

    - Use text2sql if:
      a) The question can be answered directly using specific columns in the table
      b) The question involves precise numerical calculations or aggregations
      c) The question requires filtering or grouping based on specific criteria
      d) The relevant information is stored in structured fields rather than text descriptions

    Consider the nature of the data in each table:
    - qnps_embedding is better for questions about customer sentiment, feedback trends.
    - warranty_embedding is better for questions about repair costs, frequent issues, specific feature-related issues or specific diagnostic codes

    Provide only the JSON object without any additional formatting or explanation.
    """
    with open("prompt.txt", "w") as f:
        f.write(prompt)
    response = model.generate_content(
        prompt,
        generation_config={"temperature": 0.2, "top_p": 0.8},
    )
    
 
    cleaned_response = response.text.strip().replace('```json', '').replace('```', '').strip()

    try:
        return json.loads(cleaned_response)
    except json.JSONDecodeError:
        logger.error(f"Failed to parse response as JSON. Raw response: {cleaned_response}")
        raise ValueError("Invalid JSON response from determine_search_method function")

async def vector_search(query_text, table_name):
    table_id = f"{PROJECT_ID}.{DATASET_NAME}.{table_name}"
    try:
        if table_name == "warranty_embedding":
            query = f"""
            SELECT base.dtc_code, base.cust_conc_cd, base.combined_issue_details
            FROM VECTOR_SEARCH(
                TABLE `{table_id}`, 'combined_issue_details_embedding',
                (SELECT ml_generate_embedding_result, content AS query
                 FROM ML.GENERATE_EMBEDDING(
                     MODEL `{PROJECT_ID}.{DATASET_NAME}.textembedding`,
                     (SELECT '{query_text}' AS content))
                ),
                top_k => 5, options => '{{"fraction_lists_to_search": 0.01}}')
            """
        elif table_name == "qnps_embedding":
            query = f"""
            SELECT base.ccc_code, base.verbatim
            FROM VECTOR_SEARCH(
                TABLE `{table_id}`, 'verbatim_embedding',
                (SELECT ml_generate_embedding_result, content AS query
                 FROM ML.GENERATE_EMBEDDING(
                     MODEL `{PROJECT_ID}.{DATASET_NAME}.textembedding`,
                     (SELECT '{query_text}' AS content))
                ),
                top_k => 5, options => '{{"fraction_lists_to_search": 0.01}}')
            """
        else:
            raise ValueError(f"Unsupported table_name: {table_name}")

        query_job = await asyncio.to_thread(client.query, query)
        results = await asyncio.to_thread(query_job.result)
        logger.info(f"Performed vector search on table {table_id}")
        return [dict(row) for row in results]
    except Exception as e:
        logger.error(f"Error performing vector search on table {table_id}: {str(e)}")
        raise

async def generate_and_execute_sql(query, table_name):
    table_schema = get_table_schema_and_description(DATASET_NAME)
    
    vertexai.init(project=PROJECT_ID, location=LOCATION)
    model = GenerativeModel(MODEL_NAME)
    
    sql_query_prompt = f"""
    Given the table schema: {table_schema[table_name]}, generate a SQL query to answer the user question: {query}
    Use the following table id: {PROJECT_ID}.{DATASET_NAME}.{table_name}
    
    Provide only the SQL query without any additional formatting or explanation.
    """
    
    sql_query_response = model.generate_content(
        sql_query_prompt,
        generation_config={"temperature": 0.2, "top_p": 0.8},
    )
    
    sql_query = sql_query_response.text.strip()
    cleaned_query = (
            sql_query
            .replace("\\n", " ")
            .replace("\n", " ")
            .replace("\\", "")
            .replace("```sql", "")
            .replace("```", "")
            .strip()
        )
    
    try:
        query_job = client.query(cleaned_query)
        results = query_job.result()
        return [dict(row) for row in results]
    except Exception as e:
        logger.error(f"Error executing SQL query: {str(e)}")
        raise

async def generate_natural_language_answer(query, results):
    vertexai.init(project=PROJECT_ID, location=LOCATION)
    model = GenerativeModel(MODEL_NAME)
    
    prompt = f"""
    Given the following user question and query results, provide a concise natural language answer:

    User question: {query}
    Query results: {results}

    Please summarize the results and directly answer the user's question in a clear and concise manner. Don't miss any information from the results.And also dont explain what is not there in the results.
    And also If there is any customer concern code or diagnostic trouble code in the results, please provide the description of the code.
    Make Sure to answer in bullet points.
    """
    
    response = model.generate_content(
        prompt,
        generation_config={"temperature": 0.2, "top_p": 0.8},
    )
    
    return response.text.strip()

async def generate_additional_sql_query(table_name, codes):
    vertexai.init(project=PROJECT_ID, location=LOCATION)
    model = GenerativeModel(MODEL_NAME)
    
    # Get the table schema
    table_schemas = get_table_schema_and_description(DATASET_NAME)
    table_schema = table_schemas.get(table_name, {})
    
    if not codes:
        logger.error("No codes provided for additional query")
        return None

    code_list = ', '.join([f"'{code}'" for code in codes])
    
    # Determine the correct column name based on the table
    if table_name == 'qnps_embedding':
        code_column = 'ccc_code'
    elif table_name == 'warranty_embedding':
        code_column = 'cust_conc_cd'
    else:
        logger.error(f"Unsupported table name: {table_name}")
        return None
    
    prompt = f"""
    Given the following table schema for {table_name}:
    {table_schema}

    Generate a SQL query to select all columns (excluding any columns with 'embedding' in the name) from the table {PROJECT_ID}.{DATASET_NAME}.{table_name}
    where the {code_column} is in the following list: {code_list}.
    
    The query should:
    1. Select all columns except those containing 'embedding' in their name
    2. Filter rows where {code_column} is in the provided list
    3. Limit the results to 8 rows

    Important notes:
    - Use the provided table schema to ensure you're selecting valid columns
    - Make sure to exclude any column with 'embedding' in its name
    - Ensure the query starts with 'SELECT' and is a valid SQL statement
    - Do not include any markdown formatting or code block syntax

    Provide only the SQL query without any additional formatting or explanation.
    """
    
    response = model.generate_content(
        prompt,
        generation_config={"temperature": 0.2, "top_p": 0.8},
    )
    
    generated_query = response.text.strip()
    
   
    generated_query = re.sub(r'```sql\s*|\s*```', '', generated_query)
    generated_query = generated_query.strip()
    
    
    logger.info(f"Generated SQL query after cleaning: {generated_query}")

   
    if not re.match(r'^\s*SELECT', generated_query, re.IGNORECASE):
        logger.error(f"Invalid SQL query generated: {generated_query}")
        return None

    return generated_query

async def execute_additional_query(query):
    try:
        if query is None:
            raise ValueError("No valid SQL query provided")
        
        query_job = client.query(query)
        results = query_job.result()
        return [dict(row) for row in results]
    except Exception as e:
        logger.error(f"Error executing additional SQL query: {str(e)}")
        logger.error(f"Problematic query: {query}")
        raise
    
async def process_query(query):
    try:
        logger.info(f"Processing query: {query}")
        
        # Step 1: Determine the search method and table
        search_info = determine_search_method(query)
        logger.info(f"Search method determined: {search_info}")
        
        # Step 2: Perform the search
        if search_info['search_method'] == 'vector_search':
            logger.info("Performing vector search")
            vector_results = await vector_search(query, search_info['table_name'])
            
            # Extract codes based on the table
            if search_info['table_name'] == 'qnps_embedding':
                codes = list(set([result.get('ccc_code') for result in vector_results if result.get('ccc_code')]))
            else:  # warranty_embedding
                codes = list(set([result.get('cust_conc_cd') for result in vector_results if result.get('cust_conc_cd')]))
            
            results = {
                'vector_results': vector_results,
                'codes': codes
            }
        elif search_info['search_method'] == 'text2sql':
            logger.info("Performing text2sql search")
            results = await generate_and_execute_sql(query, search_info['table_name'])
        else:
            raise ValueError(f"Invalid search method: {search_info['search_method']}")
        
        logger.info(f"Search results: {results}")
        
        # Step 3: Generate natural language answer
        answer = await generate_natural_language_answer(query, results)
        logger.info(f"Generated answer: {answer}")
        
        return {
            'query': query,
            'search_method': search_info['search_method'],
            'table_name': search_info['table_name'],
            'results': results,
            'answer': answer
        }
    except Exception as e:
        logger.error(f"Error processing query: {str(e)}", exc_info=True)
        return {'error': str(e)}

async def get_more_information(table_name, codes):
    try:
        # Generate and execute additional SQL query
        additional_query = await generate_additional_sql_query(table_name, codes)
        if additional_query is None:
            raise ValueError("Failed to generate a valid SQL query")
        
        additional_results = await execute_additional_query(additional_query)
        
       
        code_column = 'ccc_code' if table_name == 'qnps_embedding' else 'cust_conc_cd'
        
      
        grouped_results = {}
        for code, group in groupby(sorted(additional_results, key=itemgetter(code_column)), key=itemgetter(code_column)):
            grouped_results[code] = list(group)
        
      
        summaries = {}
        for code, results in grouped_results.items():
            summary = await generate_concern_code_summary(code, results)
            summaries[code] = summary
        
        # Generate overall summary
        overall_summary = await generate_overall_summary(summaries)
        
        return {
            'additional_results': additional_results,
            'concern_code_summaries': summaries,
            'overall_summary': overall_summary
        }
    except Exception as e:
        logger.error(f"Error getting more information: {str(e)}", exc_info=True)
        return {'error': str(e)}

async def generate_concern_code_summary(code, results):
    vertexai.init(project=PROJECT_ID, location=LOCATION)
    model = GenerativeModel(MODEL_NAME)
    
    prompt = f"""
    Generate a summary for the code {code} based on the following results:
    {results}

    Your summary should:
    1. Provide an overview of the main issues associated with this code
    2. Highlight any patterns or trends in the data
    3. Include relevant statistics (e.g., average costs, frequency of issues)
    4. Mention any notable or unusual cases
    5. Be concise but informative, aiming for 3-5 bullet points

    Provide only the summary without any additional formatting or explanation.
    """
    
    response = model.generate_content(
        prompt,
        generation_config={"temperature": 0.2, "top_p": 0.8},
    )
    
    return response.text.strip()

async def generate_overall_summary(summaries):
    vertexai.init(project=PROJECT_ID, location=LOCATION)
    model = GenerativeModel(MODEL_NAME)
    
    prompt = f"""
    Generate an overall summary based on the following summaries for different codes:
    {summaries}

    Your overall summary should:
    1. Provide a high-level overview of the main issues across all codes
    2. Highlight any overarching patterns or trends
    3. Compare and contrast the different codes
    4. Mention any significant findings or insights
    5. Be concise but informative, aiming for 5-7 bullet points

    Provide only the summary without any additional formatting or explanation.
    """
    
    response = model.generate_content(
        prompt,
        generation_config={"temperature": 0.2, "top_p": 0.8},
    )
    
    return response.text.strip()

@app.post("/api/process-query")
async def api_process_query(request: QueryRequest):
    try:
        result = await process_query(request.query)
        return result
    except Exception as e:
        logger.error(f"Error processing query: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/more-information")
async def api_more_information(request: MoreInfoRequest):
    try:
        codes = request.codes or request.cust_conc_cds or request.ccc_codes
        result = await get_more_information(request.table_name, codes)
        return result
    except Exception as e:
        logger.error(f"Error getting more information: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


def safe_file_response(file_path: str):
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    else:
        raise HTTPException(status_code=404, detail="File not found")


app.mount("/static", StaticFiles(directory="dist/static"), name="static")


@app.get("/Ford_logo_flat.png")
async def serve_ford_logo():
    return safe_file_response("dist/Ford_logo_flat.png")

@app.get("/gemini-logo.png")
async def serve_gemini_logo():
    return safe_file_response("dist/gemini-logo.png")

@app.get("/google-cloud-logo.svg")
async def serve_google_cloud_logo():
    return safe_file_response("dist/google-cloud-logo.svg")

@app.get("/ford-webpage.png")
async def serve_ford_webpage_logo():
    return safe_file_response("dist/ford-webpage.png")

@app.get("/vite.svg")
async def serve_vite_svg():
    return safe_file_response("dist/vite.svg")


@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    if os.path.isfile(f"dist/{full_path}"):
        return FileResponse(f"dist/{full_path}")
    index_path = "dist/index.html"
    if os.path.isfile(index_path):
        return FileResponse(index_path)
    else:
        raise HTTPException(status_code=404, detail="File not found")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)