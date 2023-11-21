//-------------------------------------------//
// 0. Import Dependencies
//-------------------------------------------//
import OpenAI from 'openai';
import 'dotenv/config';
import fetch from 'node-fetch';
import { FixieClient } from "fixie";


//-------------------------------------------//
// 1. Initialize our Variables
//-------------------------------------------//
const OPENAI_MODEL = "gpt-4-1106-preview";
const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY});
const fixieClient = new FixieClient({ apiKey: process.env.FIXIE_API_KEY });

const POLL_INTERVAL = 100;
const ASSISTANT_NAME = "Fixie Assistant";
const SYSTEM_MESSAGE = "You are a helpful assistant who is an expert on a company called Fixie.ai. Fixie provides a platform for helping developers build conversational, AI applications. You have access to a knowledge base that you can query for more information about Fixie, their products, and their APIs.";
const QUERY_FIXIE_CORPUS = {
  "name": "query_Fixie_Corpus",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "The query to execute against the knowledge base"
        }
      },
      "required": [
        "query"
      ]
    },
    "description": "Query a knowledge base of information about Matt Welsh."
};

const TOOLS = [
  { "type": "function", "function": QUERY_FIXIE_CORPUS }
];

const USER_MESSAGES = [
  { role: "user", content: "What does Fixie provide?" },
  { role: "user", content: "How does the Corpus API work?"}
];
const FIXIE_API_URL = "https://api.fixie.ai";
const FIXIE_CORPUS_ID = "437594d6-ae69-4e54-abea-c58ab2be80ec";



//-------------------------------------------//
// 2.a Function to call Fixie Corpus
//-------------------------------------------//
async function query_Fixie_Corpus(query) {
  const queryResult = await fixieClient.queryCorpus({ corpusId: FIXIE_CORPUS_ID, query: query });

  return queryResult;
  // return result;
  // const url = new URL(`api/v1/corpora/${FIXIE_CORPUS_ID}/query`, FIXIE_API_URL)
  // const requestBody = {
  //   corpusId: FIXIE_CORPUS_ID,
  //   query: query,
  // };
  // const response = await fetch(url, {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'Accept': 'application/json',
  //     Authorization: `Bearer ${process.env.FIXIE_API_KEY}`,
  //   },
  //   body: JSON.stringify({ requestBody }),
  // });
  // if (!response.ok) {
  //   throw new Error(`Corpus query request failed: ${response.status} ${response.statusText} ${JSON.stringify(response.body)}`);
  // }
  // return response.text();
}


//-------------------------------------------//
// 3. Create the Assistant
//-------------------------------------------//
const assistant = await openai.beta.assistants.create({
  name: ASSISTANT_NAME,
  instructions: SYSTEM_MESSAGE,
  tools: TOOLS,
  model: OPENAI_MODEL
})


//-------------------------------------------//
// 4. Create the Thread
//-------------------------------------------//
const thread = await openai.beta.threads.create()


//-------------------------------------------//
// 5. Add Messages to the Thread
//-------------------------------------------//
// const message = await openai.beta.threads.messages.create(thread.id, USER_MESSAGES)

const message = await openai.beta.threads.messages.create(thread.id, {
  role: 'user',
  content: 'What is the Fixie corpus API?',
})

//-------------------------------------------//
// 6. Run Assistant Loop (Polling)
//-------------------------------------------//
const run = await openai.beta.threads.runs.create(thread.id, {
  assistant_id: assistant.id
})

async function runAssistant(interval) {
  const runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);  // get the run status
  console.log(`Run Status: ${runStatus.status}`);

  switch (runStatus.status) {
    case 'completed':
      const messages = await openai.beta.threads.messages.list(thread.id);  // get the messages
      messages.data.forEach((message) => {
        const role = message.role;
        const content = message.content[0].text.value;
        console.log(`${role}: ${content}`);
      });

      break;

    case 'requires_action':
      console.log("Need to call a function...");
      const requiredActions = runStatus.required_action.submit_tool_outputs;
      const tool_outputs = [];

      console.log(requiredActions);

      requiredActions["tool_calls"].forEach((action) => {
        const functionName = action["function"]["name"];
        const functionArgs = action["function"]["arguments"];
        console.log(`Function Name: ${functionName}`);
        console.log(`Arguments: ${functionArgs}`);

        // Make sure it's the right function for Fixie Corpus service
        if (functionName == "query_Fixie_Corpus") {
          const query = JSON.parse(functionArgs)["query"];
          const output = await query_Fixie_Corpus(query);
          tool_outputs.push({
            "tool_call_id": action["id"],
            "output": output
          });
        } else {
          throw new Error(`Unknown function: ${functionName}`);
        }
      });

      console.log("Submitting function output back to the Assistant...");
      openai.beta.threads.runs.submitToolOutputs(thread.id, run.id, tool_outputs);
      break;
  
    default:
      console.log(`Assistant is still running. Polling again in ${interval}ms`);
      setTimeout(() => runAssistant(interval), interval);
      break;
  }
}

// Start the Assistant Loop
runAssistant(POLL_INTERVAL);
