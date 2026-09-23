/**
 * Answer Quality Evaluator
 * Evaluates agent diagnosis and proposed action on:
 * 1. Grounding & Citation Integrity (Faithfulness to RAG retrieved context)
 * 2. Policy & Constraint Adherence (SLA limits, compensation ceilings, allowed action types)
 * 3. Answer Completeness & Action Specificity (Structure, parameters, clarity)
 */

export class QualityEvaluator {
  constructor({ passingThreshold = 70 } = {}) {
    this.passingThreshold = passingThreshold;
  }

  evaluate({ ticket, retrievedDocs = [], citations = [], diagnosisDraft, proposedAction }) {
    let groundingScore = 0;
    let policyScore = 0;
    let completenessScore = 0;
    const feedback = [];

    // ── 1. Grounding & Citation Integrity (Max: 40 pts) ──────────────────────
    const text = (diagnosisDraft || '') + ' ' + (proposedAction?.notes || '');
    const hasRefCitation = /\[REF-\d+\]/i.test(text) || /KB-/i.test(text);
    const hasCitationsList = Array.isArray(citations) && citations.length > 0;

    if (hasRefCitation && hasCitationsList) {
      groundingScore += 25;
      feedback.push('✔ Faithfully cites retrieved RAG reference sources.');
    } else if (hasCitationsList) {
      groundingScore += 10;
      feedback.push('⚠ Citations provided in metadata but not explicitly referenced in draft body.');
    } else {
      feedback.push('✖ Lacks explicit reference citations to knowledge base.');
    }

    // Check overlap with retrieved terms
    const retrievedKeywords = retrievedDocs
      .map(d => (d.text || '').toLowerCase().split(/\s+/))
      .flat()
      .filter(w => w.length > 5);
    const draftWords = new Set(text.toLowerCase().split(/\s+/));
    let termOverlap = 0;
    for (const kw of retrievedKeywords) {
      if (draftWords.has(kw)) termOverlap++;
    }

    if (termOverlap >= 5) {
      groundingScore += 15;
    } else if (termOverlap >= 2) {
      groundingScore += 8;
    } else {
      feedback.push('⚠ Low semantic keyword overlap with retrieved runbooks.');
    }

    // ── 2. Policy & Constraint Adherence (Max: 35 pts) ────────────────────────
    const creditAmount = proposedAction?.creditAmount ?? 0;
    const allowedActions = ['APPLY_SLA_CREDIT', 'SCALE_READ_REPLICA', 'CLOSE_INCIDENT', 'REJECT_CLAIM'];

    if (proposedAction && allowedActions.includes(proposedAction.actionType)) {
      policyScore += 15;
      feedback.push(`✔ Action type '${proposedAction.actionType}' is permitted under SOP.`);
    } else {
      feedback.push(`✖ Action type '${proposedAction?.actionType}' is invalid or unauthorized.`);
    }

    // Check financial ceiling ($500 cap from KB-POLICY-002)
    if (creditAmount >= 0 && creditAmount <= 500) {
      policyScore += 20;
      feedback.push(`✔ Proposed credit ($${creditAmount.toFixed(2)}) is within standard authorization ceiling (<= $500.00).`);
    } else if (creditAmount > 500) {
      policyScore += 5;
      feedback.push(`✖ Proposed credit ($${creditAmount.toFixed(2)}) violates standard ceiling of $500.00 without VP signoff.`);
    }

    // ── 3. Completeness & Specificity (Max: 25 pts) ───────────────────────────
    if (diagnosisDraft && diagnosisDraft.length > 80) {
      completenessScore += 15;
    } else {
      feedback.push('⚠ Diagnosis draft is brief or lacking root cause detail.');
    }

    if (proposedAction?.ticketNumber && proposedAction?.notes) {
      completenessScore += 10;
      feedback.push('✔ Action payload contains complete ticket ID and actionable notes.');
    } else {
      feedback.push('✖ Proposed action missing ticket ID or operational notes.');
    }

    const totalScore = groundingScore + policyScore + completenessScore;
    const passed = totalScore >= this.passingThreshold;

    return {
      score: totalScore,
      passed,
      passingThreshold: this.passingThreshold,
      metrics: {
        grounding: groundingScore,
        policyCompliance: policyScore,
        completeness: completenessScore
      },
      citationsValid: hasRefCitation && hasCitationsList,
      feedback
    };
  }
}

/**
 * Standalone evaluation runner for npm run eval
 */
export function runEvalDemo() {
  const evaluator = new QualityEvaluator();
  console.log('\n--- Running Standalone Answer Quality Evaluation Demo ---');
  const sampleEvaluation = evaluator.evaluate({
    ticket: { ticket_number: 'INC-8091', service_impact_minutes: 90, tier: 'Enterprise' },
    retrievedDocs: [{ text: 'Enterprise Tier customers are eligible for service credit capped at $500.' }],
    citations: [{ citationId: '[REF-1]', docId: 'KB-POLICY-002' }],
    diagnosisDraft: 'Verified 90 minutes latency degradation for Acme Global under Enterprise SLA [REF-1]. Recommend applying standard 10% credit.',
    proposedAction: {
      ticketNumber: 'INC-8091',
      actionType: 'APPLY_SLA_CREDIT',
      creditAmount: 350.0,
      notes: 'Applying 10% service credit of $350.00 per SLA policy [REF-1].'
    }
  });

  console.log(JSON.stringify(sampleEvaluation, null, 2));
}
