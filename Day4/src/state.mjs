/**
 * Day 4 — Central Shared State (Blackboard Pattern)
 *
 * All agents read from and write to this state.
 * Keeping state centralized ensures reproducible execution, serialization, and clean audit logs.
 */

export const AgentStatus = {
  INITIALIZED: 'INITIALIZED',
  RESEARCHED: 'RESEARCHED',
  DRAFTED: 'DRAFTED',
  CRITIQUED: 'CRITIQUED',
  HITL_PENDING: 'HITL_PENDING',
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED'
};

export class PipelineState {
  /**
   * @param {string} topic - User's target subject or prompt
   * @param {Object} [options]
   * @param {number} [options.maxIterations=1] - Strict max revision cycles allowed
   */
  constructor(topic, { maxIterations = 1 } = {}) {
    if (!topic || typeof topic !== 'string') {
      throw new Error('A valid string topic is required to initialize PipelineState.');
    }

    this.topic = topic.trim();
    this.iteration = 0;
    this.maxIterations = maxIterations;
    
    // Knowledge & research gathered
    this.facts = []; // Array of { id, source, chunkIndex, content, similarity }
    this.citations = [];

    // Draft versions
    this.draft = '';
    this.draftHistory = []; // Array of previous drafts

    // Critique evaluations
    this.critiqueHistory = []; // Array of { status, score, strengths, feedback, missingPoints, timestamp }

    // Lifecycle status
    this.status = AgentStatus.INITIALIZED;

    // Human decision: { action: 'APPROVED' | 'EDITED' | 'REJECTED', notes?: string, finalContent?: string, path?: string }
    this.humanDecision = null;

    // Execution logs
    this.logs = [];
    this.createdAt = new Date().toISOString();
  }

  /**
   * Append an execution log entry.
   * @param {string} agent - Name of the acting agent
   * @param {string} message - Description of the action
   */
  log(agent, message) {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
    const entry = `[${timestamp}] [${agent}]: ${message}`;
    this.logs.push(entry);
  }

  /**
   * Snapshot current state for persistence or audit.
   * @returns {Object} Plain object representation of state
   */
  toJSON() {
    return {
      topic: this.topic,
      iteration: this.iteration,
      maxIterations: this.maxIterations,
      factsCount: this.facts.length,
      facts: this.facts,
      citations: this.citations,
      draftLength: this.draft.length,
      draft: this.draft,
      draftHistoryCount: this.draftHistory.length,
      critiqueHistory: this.critiqueHistory,
      status: this.status,
      humanDecision: this.humanDecision,
      createdAt: this.createdAt,
      logs: this.logs
    };
  }
}
