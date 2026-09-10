import {
  createGeminiClient,
  withRetry,
  defaultOutputSchema,
  weatherToolDeclaration,
  defaultWeatherToolHandler
} from './gemini-client.mjs';

const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

function pass(name, details = '') {
  console.log(`${colors.green}✔ PASS:${colors.reset} ${colors.bold}${name}${colors.reset} ${details}`);
}

function fail(name, err) {
  console.error(`${colors.red}✖ FAIL:${colors.reset} ${colors.bold}${name}${colors.reset}`);
  console.error(err);
  process.exit(1);
}

async function runTests() {
  console.log(`\n${colors.cyan}${colors.bold}=== Day 1 Gemini Client & CLI Verification ===${colors.reset}\n`);

  const client = createGeminiClient();

  // -------------------------------------------------------------
  // Test 1: Count Tokens
  // -------------------------------------------------------------
  try {
    const testPrompt = 'Explain context windows in large language models.';
    const tokenCount = await client.countTokens(testPrompt);
    if (typeof tokenCount !== 'number' || tokenCount <= 0) {
      throw new Error(`Invalid token count returned: ${tokenCount}`);
    }
    pass('Token Counting', `(${tokenCount} tokens for prompt)`);
  } catch (err) {
    fail('Token Counting', err);
  }

  // -------------------------------------------------------------
  // Test 2: Real-time Streaming
  // -------------------------------------------------------------
  try {
    const streamPrompt = 'Count from 1 to 5 separated by commas.';
    const generator = client.streamGenerate(streamPrompt, { temperature: 0.1 });
    let fullText = '';
    let chunkCount = 0;

    for await (const chunk of generator) {
      chunkCount++;
      fullText += chunk.text;
    }

    if (chunkCount < 1 || !fullText.includes('1') || !fullText.includes('5')) {
      throw new Error(`Unexpected streaming output: "${fullText}", chunks: ${chunkCount}`);
    }
    pass('Streaming Generation', `(Received ${chunkCount} chunks: "${fullText.trim()}")`);
  } catch (err) {
    fail('Streaming Generation', err);
  }

  // -------------------------------------------------------------
  // Test 3: Structured JSON with Schema Validation
  // -------------------------------------------------------------
  try {
    const jsonPrompt = 'What is the speed of light in vacuum?';
    const res = await client.generateJSON(jsonPrompt, {
      schema: defaultOutputSchema,
      temperature: 0.1
    });

    const data = res.data;
    if (!data.query || !data.summary || !Array.isArray(data.keyPoints) || typeof data.confidenceScore !== 'number') {
      throw new Error(`JSON does not conform to schema: ${JSON.stringify(data)}`);
    }
    pass('Structured JSON Output', `(Valid fields: query, summary, keyPoints[${data.keyPoints.length}], confidenceScore=${data.confidenceScore})`);
  } catch (err) {
    fail('Structured JSON Output', err);
  }

  // -------------------------------------------------------------
  // Test 4: Tool / Function Calling Loop
  // -------------------------------------------------------------
  try {
    const toolPrompt = 'What is the weather in Amsterdam right now?';
    let toolInvoked = false;

    const toolResult = await client.executeToolCall(toolPrompt, {
      tool: weatherToolDeclaration,
      handler: defaultWeatherToolHandler,
      onToolExecute: (name, args) => {
        toolInvoked = true;
      }
    });

    if (!toolInvoked) {
      throw new Error('Model did not trigger the getCurrentWeather tool call.');
    }
    if (!toolResult.text.toLowerCase().includes('amsterdam') && !toolResult.toolResult?.temperature) {
      throw new Error(`Tool execution answer did not incorporate tool result: "${toolResult.text}"`);
    }
    pass('Tool / Function Calling', `(Tool invoked: ${toolResult.toolCall?.name}, Answer incorporated output)`);
  } catch (err) {
    fail('Tool / Function Calling', err);
  }

  // -------------------------------------------------------------
  // Test 5: Exponential Backoff & Transient Retry Logic
  // -------------------------------------------------------------
  try {
    let mockAttempts = 0;
    const simulatedTransientOp = async () => {
      mockAttempts++;
      if (mockAttempts < 3) {
        const fakeErr = new Error('This model is currently experiencing high demand');
        fakeErr.status = 503;
        throw fakeErr;
      }
      return 'recovered_success';
    };

    let retryNotifications = 0;
    const outcome = await withRetry(simulatedTransientOp, {
      maxRetries: 4,
      baseDelayMs: 100, // fast delay for unit test
      onRetry: (attempt) => {
        retryNotifications++;
      }
    });

    if (outcome !== 'recovered_success' || mockAttempts !== 3 || retryNotifications !== 2) {
      throw new Error(`Retry logic failed: outcome=${outcome}, attempts=${mockAttempts}, retries=${retryNotifications}`);
    }
    pass('Exponential Backoff & Retry', `(Recovered successfully after ${retryNotifications} retries on simulated 503)`);
  } catch (err) {
    fail('Exponential Backoff & Retry', err);
  }

  console.log(`\n${colors.green}${colors.bold}All 5 verification suites passed successfully!${colors.reset}\n`);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
