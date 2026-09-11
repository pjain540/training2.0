import { Type } from '@google/genai';

/**
 * Gemini Function Declaration for the Search Tool Stub.
 */
export const searchToolDeclaration = {
  name: 'search_web',
  description: 'Search the web or knowledge repository for factual data, statistics, country demographics, populations, geography, and general knowledge.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      query: {
        type: Type.STRING,
        description: 'The search query or keywords to look up (e.g. "population of France", "GDP of Japan", "distance to moon").'
      }
    },
    required: ['query']
  }
};

/**
 * Curated knowledge repository representing web search index data.
 */
const KNOWLEDGE_BASE = [
  {
    keywords: ['france', 'population', 'french'],
    title: 'Demographics of France (2024)',
    snippet: 'According to official INSEE (National Institute of Statistics and Economic Studies) data for 2024, the population of France is 68,373,433 inhabitants.',
    data: {
      country: 'France',
      population: 68373433,
      year: 2024,
      source: 'INSEE Official Demographic Census',
      capital: 'Paris',
      area_sq_km: 551695
    }
  },
  {
    keywords: ['germany', 'population', 'german'],
    title: 'Demographics of Germany (2024)',
    snippet: 'The Federal Statistical Office of Germany (Destatis) estimates the population of Germany at approximately 84,607,000 as of 2024.',
    data: {
      country: 'Germany',
      population: 84607000,
      year: 2024,
      source: 'Destatis Germany',
      capital: 'Berlin'
    }
  },
  {
    keywords: ['united states', 'usa', 'america', 'population'],
    title: 'United States Demographics (2024)',
    snippet: 'The United States Census Bureau estimates the total population of the USA at 335,893,238 as of 2024.',
    data: {
      country: 'United States',
      population: 335893238,
      year: 2024,
      source: 'U.S. Census Bureau',
      capital: 'Washington, D.C.'
    }
  },
  {
    keywords: ['japan', 'population', 'japanese'],
    title: 'Demographics of Japan (2024)',
    snippet: 'The Ministry of Internal Affairs and Communications of Japan reports the population at approximately 124,500,000 as of 2024.',
    data: {
      country: 'Japan',
      population: 124500000,
      year: 2024,
      source: 'Statistics Bureau of Japan',
      capital: 'Tokyo'
    }
  },
  {
    keywords: ['india', 'population', 'indian'],
    title: 'Demographics of India (2024)',
    snippet: 'The United Nations Population Fund (UNFPA) estimates India population at approximately 1,428,627,663 in 2024.',
    data: {
      country: 'India',
      population: 1428627663,
      year: 2024,
      source: 'UNFPA State of World Population',
      capital: 'New Delhi'
    }
  },
  {
    keywords: ['united kingdom', 'uk', 'britain', 'population'],
    title: 'Demographics of the United Kingdom (2024)',
    snippet: 'The UK Office for National Statistics (ONS) estimates the UK population at 67,736,802 as of 2024.',
    data: {
      country: 'United Kingdom',
      population: 67736802,
      year: 2024,
      source: 'UK Office for National Statistics',
      capital: 'London'
    }
  },
  {
    keywords: ['speed of light', 'light speed'],
    title: 'Speed of Light in Vacuum',
    snippet: 'The speed of light in a vacuum is exactly 299,792,458 meters per second (approx 300,000 km/s).',
    data: {
      value: 299792458,
      unit: 'm/s',
      constant: 'c'
    }
  },
  {
    keywords: ['earth to moon', 'distance to moon', 'moon distance'],
    title: 'Average Distance from Earth to Moon',
    snippet: 'The average distance from the center of Earth to the center of the Moon is approximately 384,400 kilometers (238,855 miles).',
    data: {
      distance_km: 384400,
      distance_miles: 238855
    }
  }
];

/**
 * Searches the knowledge repository using robust whole-word and phrase matching.
 *
 * @param {Object} args
 * @param {string} args.query - The search query
 * @returns {Promise<{ found: boolean, query: string, title?: string, snippet?: string, data?: Object, message?: string }>}
 */
export async function searchToolHandler(args) {
  const rawQuery = (args?.query || '').trim();
  const query = rawQuery.toLowerCase();

  if (!query) {
    return {
      found: false,
      query: '',
      message: 'Empty search query provided. Please specify keywords to search.'
    };
  }

  // Tokenize query words
  const queryWords = query.match(/[a-z0-9]+/g) || [];
  if (queryWords.length === 0) {
    return { found: false, query: rawQuery, snippet: `No valid keywords found in "${rawQuery}".` };
  }

  let bestMatch = null;
  let highestScore = 0;

  for (const entry of KNOWLEDGE_BASE) {
    let score = 0;

    for (const kw of entry.keywords) {
      const kwLower = kw.toLowerCase();
      // Phrase match (e.g. "speed of light", "earth to moon")
      if (kwLower.includes(' ')) {
        if (query.includes(kwLower)) {
          score += 5;
        }
      } else {
        // Single word exact token match
        if (queryWords.includes(kwLower)) {
          score += 3;
        }
      }
    }

    if (score > highestScore) {
      highestScore = score;
      bestMatch = entry;
    }
  }

  // Require a score >= 3 (at least one exact keyword or phrase match)
  if (bestMatch && highestScore >= 3) {
    return {
      found: true,
      query: rawQuery,
      title: bestMatch.title,
      snippet: bestMatch.snippet,
      data: bestMatch.data
    };
  }

  return {
    found: false,
    query: rawQuery,
    snippet: `No specific indexed document found for "${rawQuery}". Try searching for popular country demographics (e.g. "population of France", "population of Germany") or scientific constants.`,
    suggestions: ['population of France', 'population of Germany', 'speed of light', 'distance from earth to moon']
  };
}
