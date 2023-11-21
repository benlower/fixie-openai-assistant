//-------------------------------------------//
// 0. Import Dependencies
//-------------------------------------------//
import OpenAI from 'openai';
import 'dotenv/config';
import { FixieClient } from "fixie";


//-------------------------------------------//
// 1. Initialize our Variables
//-------------------------------------------//
const OPENAI_MODEL = "gpt-4-1106-preview";
const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY});
const fixieClient = new FixieClient({ apiKey: process.env.FIXIE_API_KEY });

const FIXIE_MAX_CHUNKS = 2;
const POLL_INTERVAL = 100;
const ASSISTANT_NAME = "Fixie Assistant";
// const SYSTEM_MESSAGE = "You are a helpful assistant who is an expert on a real company called Fixie.ai. The company is based in Seattle, WA and has a website at https://fixie.ai. Fixie provides a platform for helping developers build conversational, AI applications. You have access to a knowledge base that you can query for more information about Fixie, their products, and their APIs."; // Fixie
const SYSTEM_MESSAGE = "You are a helpful assistant who is an expert on all types of foxes. You have access to a knowledge base that you can query for more information when users ask questions about foxes."; // Foxes
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

const TOOLS = [{ "type": "function", "function": QUERY_FIXIE_CORPUS }];

// const USER_MESSAGE = { role: "user", content: "What is blue?"}; // works
// const USER_MESSAGE = { role: "user", content: "How does the Corpus API work?"};  // fails
// const USER_MESSAGE = { role: "user", content: "What does Fixie do?"}; // fails
const USER_MESSAGE = { role: "user", content: "Who is Foxie?"};

// const FIXIE_CORPUS_ID = "437594d6-ae69-4e54-abea-c58ab2be80ec";   // Fixie.ai
const FIXIE_CORPUS_ID = "44094d5a-f817-4c2e-a2a4-8f8a0c936d0f";   // Foxes


//-------------------------------------------//
// 2.a Call the Fixie Corpus API
//-------------------------------------------//
async function query_Fixie_Corpus(query) {
  const queryResult = await fixieClient.queryCorpus({ corpusId: FIXIE_CORPUS_ID, query: query, maxChunks: FIXIE_MAX_CHUNKS });
  return queryResult;
}

// async function processFixieChunks(results) {
//   let completeResults = "";
//   const content = results.results;
//   for (let i = 0; i < content.length; i++) {
//     completeResults += content[i].chunkContent;
//   } 

//   return completeResults;
// }

async function processFixieChunks(results) {
  let completeResults = "";
  for (const result of results) {
    completeResults += result.chunkContent;
  }
  return completeResults;
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
const message = await openai.beta.threads.messages.create(thread.id, USER_MESSAGE);

// const message = await openai.beta.threads.messages.create(thread.id, {
//   role: 'user',
//   content: 'What is the Fixie corpus API?',
// })

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
      const tool_outputs = [];
      const requiredActions = runStatus.required_action.submit_tool_outputs;
      console.log(`Required Actions: ${JSON.stringify(requiredActions)}`);

      // Make sure the closure is async or else we will send the tool outputs before they are all processed
      await Promise.all(requiredActions["tool_calls"].map(async (action) => {
        const functionName = action["function"]["name"];
        const functionArgs = action["function"]["arguments"];
        console.log(`Function Name: ${functionName}`);
        console.log(`Arguments: ${functionArgs}`);

        // Make sure it's the right function for Fixie Corpus service
        if (functionName == "query_Fixie_Corpus") {
          const query = JSON.parse(functionArgs)["query"];
          const output = await query_Fixie_Corpus(query);
          const processedOutput = await processFixieChunks(output.results);
          tool_outputs.push({
            "tool_call_id": action["id"],
            "output": JSON.stringify(processedOutput)
          });
        } else {
          throw new Error(`Unknown function: ${functionName}`);
        }
      }));


      // requiredActions["tool_calls"].forEach((action) => {
      //   const functionName = action["function"]["name"];
      //   const functionArgs = action["function"]["arguments"];
      //   console.log(`Function Name: ${functionName}`);
      //   console.log(`Arguments: ${functionArgs}`);

      //   // Make sure it's the right function for Fixie Corpus service
      //   if (functionName == "query_Fixie_Corpus") {
      //     const query = JSON.parse(functionArgs)["query"];
      //     const output = query_Fixie_Corpus(query);
      //     tool_outputs.push({
      //       "tool_call_id": action["id"],
      //       "output": output
      //     });
      //   } else {
      //     throw new Error(`Unknown function: ${functionName}`);
      //   }
      // });

      console.log("Submitting function output back to the Assistant...");
      console.log(`Tool Outputs: ${JSON.stringify(tool_outputs)}`);
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
