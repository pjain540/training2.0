/**
 * Working memory and scratchpad for the ReAct autonomous agent.
 * Tracks the perceived state, thoughts, dispatched actions, and observations.
 */
export class AgentMemory {
  constructor() {
    this.task = '';
    this.startTime = null;
    this.endTime = null;
    /** @type {Array<{ step: number, timestamp: string, thought?: string, action?: { name: string, args: Object }, observation?: Object, durationMs?: number }>} */
    this.steps = [];
    this.finalAnswer = null;
    this.stopReason = null;
  }

  /**
   * Initializes memory for a new task.
   *
   * @param {string} task
   */
  startTask(task) {
    this.task = task;
    this.startTime = Date.now();
    this.endTime = null;
    this.steps = [];
    this.finalAnswer = null;
    this.stopReason = null;
  }

  /**
   * Records a step in the scratchpad.
   *
   * @param {Object} stepData
   * @param {number} stepData.step
   * @param {string} [stepData.thought]
   * @param {{ name: string, args: Object }} [stepData.action]
   * @param {Object} [stepData.observation]
   * @param {number} [stepData.durationMs]
   */
  recordStep({ step, thought, action, observation, durationMs }) {
    this.steps.push({
      step,
      timestamp: new Date().toISOString(),
      ...(thought ? { thought } : {}),
      ...(action ? { action } : {}),
      ...(observation !== undefined ? { observation } : {}),
      ...(durationMs !== undefined ? { durationMs } : {})
    });
  }

  /**
   * Sets the final answer when the agent completes its goal.
   *
   * @param {string} answer
   * @param {string} [stopReason='completed']
   */
  setFinalAnswer(answer, stopReason = 'completed') {
    this.finalAnswer = answer;
    this.stopReason = stopReason;
    this.endTime = Date.now();
  }

  /**
   * Retrieves the full step-by-step trace.
   */
  getTrace() {
    return [...this.steps];
  }

  /**
   * Returns a high-level summary of the execution session.
   */
  getSummary() {
    const totalDurationMs = (this.endTime || Date.now()) - (this.startTime || Date.now());
    const toolsUsed = this.steps
      .filter(s => s.action?.name)
      .map(s => s.action.name);

    return {
      task: this.task,
      totalSteps: this.steps.length,
      toolsUsed,
      uniqueTools: Array.from(new Set(toolsUsed)),
      durationMs: totalDurationMs,
      stopReason: this.stopReason,
      completed: this.stopReason === 'completed'
    };
  }

  /**
   * Clears the memory.
   */
  clear() {
    this.task = '';
    this.startTime = null;
    this.endTime = null;
    this.steps = [];
    this.finalAnswer = null;
    this.stopReason = null;
  }
}
