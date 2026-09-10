import { Type } from '@google/genai';
import { withRetry } from './retry.mjs';

/**
 * Standard function declaration for live weather lookups.
 */
export const weatherToolDeclaration = {
  name: 'getCurrentWeather',
  description: 'Get current temperature, conditions, and humidity for a specified location.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      location: {
        type: Type.STRING,
        description: 'City and state or country (e.g., "San Francisco, CA", "Tokyo, Japan")'
      }
    },
    required: ['location']
  }
};

// Helper to map WMO weather codes to human-readable weather conditions
function getWeatherDescription(code) {
  if (code === 0) return 'Clear sky';
  if ([1, 2, 3].includes(code)) return 'Partly cloudy';
  if ([45, 48].includes(code)) return 'Foggy';
  if ([51, 53, 55].includes(code)) return 'Drizzle';
  if ([61, 63, 65].includes(code)) return 'Rainy';
  if ([71, 73, 75].includes(code)) return 'Snow';
  if ([77].includes(code)) return 'Snow grains';
  if ([80, 81, 82].includes(code)) return 'Rain showers';
  if ([85, 86].includes(code)) return 'Snow showers';
  if ([95, 96, 99].includes(code)) return 'Thunderstorm';
  return 'Overcast';
}

/**
 * Live weather handler using Open-Meteo geocoding and forecast API.
 * Free, non-commercial, zero-API-key-needed service.
 */
export async function defaultWeatherToolHandler(args) {
  const queryLocation = args.location || 'London';

  try {
    // 1. Geocode location query to latitude & longitude
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(queryLocation)}&count=1&language=en&format=json`;
    const geoRes = await fetch(geoUrl);
    if (!geoRes.ok) {
      throw new Error(`Geocoding HTTP error ${geoRes.status}`);
    }
    const geoData = await geoRes.json();

    if (!geoData.results || geoData.results.length === 0) {
      return {
        error: `Could not locate "${queryLocation}". Please check the spelling.`
      };
    }

    const { latitude, longitude, name, country } = geoData.results[0];

    // 2. Fetch live weather conditions for coordinates
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m`;
    const weatherRes = await fetch(weatherUrl);
    if (!weatherRes.ok) {
      throw new Error(`Weather service HTTP error ${weatherRes.status}`);
    }
    const weatherData = await weatherRes.json();

    const current = weatherData.current;

    return {
      location: `${name}, ${country || ''}`.trim(),
      latitude,
      longitude,
      temperature: `${current.temperature_2m}°C`,
      condition: getWeatherDescription(current.weather_code),
      humidity: `${current.relative_humidity_2m}%`,
      windSpeed: `${current.wind_speed_10m} km/h`,
      recordedAt: current.time
    };
  } catch (err) {
    return {
      error: `Failed to fetch live weather for "${queryLocation}": ${err.message}`
    };
  }
}

/**
 * Executes a multi-turn tool/function calling loop with Gemini.
 *
 * @param {Object} ai - Initialized GoogleGenAI instance
 * @param {string} model - Target model identifier
 * @param {string|Array} prompt - Input prompt text
 * @param {Object} [options]
 * @param {Object} [options.tool=weatherToolDeclaration] - Tool declaration schema
 * @param {Function} [options.handler=defaultWeatherToolHandler] - Function execution handler
 * @param {number} [options.temperature=0.7] - Sampling temperature
 * @param {string} [options.systemInstruction] - System instruction
 * @param {Function} [options.onToolExecute] - Callback when tool is invoked
 * @param {Function} [options.onRetry] - Retry callback
 * @returns {Promise<{ text: string, toolCall: Object|null, toolResult: Object|null, usageMetadata: Object }>}
 */
export async function executeToolLoop(ai, model, prompt, {
  tool = weatherToolDeclaration,
  handler = defaultWeatherToolHandler,
  temperature = 0.7,
  systemInstruction,
  onToolExecute,
  onRetry
} = {}) {
  return withRetry(async () => {
    const chat = ai.chats.create({
      model,
      config: {
        temperature,
        tools: [{ functionDeclarations: [tool] }],
        ...(systemInstruction ? { systemInstruction } : {})
      }
    });

    const initialTurn = await chat.sendMessage({ message: prompt });
    const calls = initialTurn.functionCalls;

    if (calls && calls.length > 0) {
      const functionCall = calls[0];

      if (typeof onToolExecute === 'function') {
        onToolExecute(functionCall.name, functionCall.args);
      }

      const toolExecutionResult = await handler(functionCall.args);

      const finalTurn = await chat.sendMessage({
        message: [{
          functionResponse: {
            name: functionCall.name,
            response: toolExecutionResult
          }
        }]
      });

      return {
        text: finalTurn.text,
        toolCall: functionCall,
        toolResult: toolExecutionResult,
        usageMetadata: finalTurn.usageMetadata
      };
    }

    // Direct response if no tool call was necessary
    return {
      text: initialTurn.text,
      toolCall: null,
      toolResult: null,
      usageMetadata: initialTurn.usageMetadata
    };
  }, { onRetry });
}
