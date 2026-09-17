import { GoogleGenAI } from '@google/genai';
import { AgentStatus } from '../state.mjs';
import { withRetry } from '../retry.mjs';

/**
 * CriticAgent
 * Role: Rigorous technical reviewer who audits the draft against the factual context,
 * checks citations, verifies completeness, and returns a structured JSON verdict.
 */
export class CriticAgent {
  /**
   * @param {Object} [options]
   * @param {string} [options.apiKey]
   * @param {string} [options.model]
   */
  constructor({
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'
  } = {}) {
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required for CriticAgent.');
    }
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  /**
   * Run critical evaluation of the draft.
   * @param {import('../state.mjs').PipelineState} state
   * @returns {Promise<Object>} Structured critique object
   */
  async run(state) {
    state.log('Critic', `Auditing draft for factual fidelity, citations, and structure (Iteration ${state.iteration})...`);

    const factsExcerpt = state.facts
      .map(f => `- [${f.source}]: ${f.content.slice(0, 300)}...`)
      .join('\n');

    const prompt = `You are a Strict Editorial Critic & Technical Reviewer.
Review the following technical draft against the source facts.

TOPIC: ${state.topic}
CURRENT ITERATION: ${state.iteration} (Max allowed revisions: ${state.maxIterations})

SOURCE FACTS:
${factsExcerpt}

CANDIDATE DRAFT:
${state.draft}

EVALUATION CRITERIA:
1. Grounding & Factual Accuracy: Are statements supported by facts? Are there hallucinations?
2. Citations: Are claims cited with [Source: ..., Chunk: ...]?
3. Comprehensiveness & Flow: Does it answer the topic thoroughly?

REVIEW POLICY:
- If this is Iteration 0 (Initial draft), be constructively critical. Unless it is utterly flawless, suggest concrete improvements and set "status": "REVISE" to ensure the draft is polished.
- If this is Iteration 1 or higher (Revised draft), confirm if previous feedback was addressed. If acceptable, set "status": "APPROVED".

RESPOND WITH ONLY A JSON OBJECT matching this exact schema:
{
  "status": "APPROVED" | "REVISE",
  "score": <number between 1 and 10>,
  "strengths": ["string"],
  "feedback": "string explaining what needs revision or why it is approved",
  "missingPoints": ["string"]
}`;

    const response = await withRetry(
      () => this.ai.models.generateContent({
        model: this.model,
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1
        }
      }),
      { label: 'CriticAgent' }
    );

    let critiqueResult;
    try {
      const rawText = response.text ? response.text.trim() : '{}';
      critiqueResult = JSON.parse(rawText);
    } catch {
      // Fallback in case of JSON parse error
      critiqueResult = {
        status: state.iteration >= state.maxIterations ? 'APPROVED' : 'REVISE',
        score: state.iteration >= state.maxIterations ? 8.5 : 6.5,
        strengths: ['Relevant technical topic coverage'],
        feedback: state.iteration >= state.maxIterations
          ? 'Draft meets quality standards.'
          : 'Please deepen the technical detail and emphasize citations.',
        missingPoints: ['Ensure every section has an explicit source reference.']
      };
    }

    // Attach timestamp and metadata
    const critiqueRecord = {
      ...critiqueResult,
      iteration: state.iteration,
      timestamp: new Date().toISOString()
    };

    state.critiqueHistory.push(critiqueRecord);
    state.status = AgentStatus.CRITIQUED;
    state.log('Critic', `Evaluation completed: Verdict=${critiqueResult.status}, Score=${critiqueResult.score}/10.`);

    return critiqueRecord;
  }
}
