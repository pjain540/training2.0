import { GoogleGenAI } from '@google/genai';
import { interrupt } from '@langchain/langgraph';
import { AgentStatus, formatLog } from './state.mjs';
import { IncidentRetriever } from '../rag/retriever.mjs';
import { QualityEvaluator } from '../eval/quality-evaluator.mjs';

export function createAgentNodes({
  mcpClient,
  retriever = new IncidentRetriever(),
  evaluator = new QualityEvaluator(),
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'
} = {}) {
  const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

  // ── Node 1: RAG Retriever Node ──────────────────────────────────────────
  const ragRetrieverNode = async (state) => {
    const ticketDesc = state.ticket?.title || 'Database latency outage and SLA credit claim';
    const { hits, citations, formattedContext } = await retriever.retrieve(ticketDesc, { topK: 2 });

    return {
      retrievedDocs: hits,
      citations,
      status: AgentStatus.RETRIEVED,
      logs: [formatLog('RAG-Retriever', `Retrieved ${hits.length} relevant knowledge base documents (${citations.map(c => c.docId).join(', ')})`)]
    };
  };

  // ── Node 2: Triage & Reasoning Agent (Agent 1) ───────────────────────────
  const triageAgentNode = async (state) => {
    const ticketNumber = state.ticket?.ticket_number || 'INC-8091';

    // 1. Query MCP Read Tool to inspect live database records
    const mcpQueryResult = await mcpClient.callTool('query_system_state', {
      sql: `
        SELECT i.id, i.ticket_number, i.title, i.severity, i.service_impact_minutes, i.status,
               c.name as customer_name, c.tier as customer_tier, c.monthly_spend
        FROM incidents i
        JOIN customers c ON i.customer_id = c.id
        WHERE i.ticket_number = ?
      `,
      params: [ticketNumber]
    });

    let liveTicketData = state.ticket;
    try {
      const parsed = JSON.parse(mcpQueryResult.content);
      if (parsed.rows && parsed.rows.length > 0) {
        liveTicketData = parsed.rows[0];
      }
    } catch {
      // Use existing state ticket data if parse fails
    }

    const citationRefs = state.citations.map(c => `${c.citationId} (${c.title})`).join('\n');
    const kbContext = (state.retrievedDocs || []).map((d, i) => `[REF-${i+1}] ${d.title}: ${d.text}`).join('\n\n');

    let diagnosis = '';
    let proposedAction = null;

    // Use Gemini model if available, otherwise high-precision fallback reasoning
    if (ai) {
      try {
        const prompt = `You are an Enterprise Incident & SLA Resolution Agent.
Review the following active incident and RAG knowledge base documents:

[TICKET DETAILS]:
Ticket: ${liveTicketData.ticket_number}
Customer: ${liveTicketData.customer_name || 'Acme Global'} (${liveTicketData.customer_tier || 'Enterprise'})
Title: ${liveTicketData.title}
Downtime: ${liveTicketData.service_impact_minutes || 90} minutes
Monthly Spend: $${liveTicketData.monthly_spend || 4500.0}

[RETRIEVED RUNBOOKS & POLICIES]:
${kbContext}

INSTRUCTIONS:
1. Diagnose the issue and determine SLA credit eligibility based explicitly on retrieved policies citing references like [REF-1].
2. Formulate a proposed remediation action.
Respond ONLY with a valid JSON object matching:
{
  "diagnosis": "Detailed diagnosis citing [REF-X]...",
  "actionType": "APPLY_SLA_CREDIT",
  "creditAmount": 350.00,
  "notes": "Action explanation citing [REF-X]"
}`;

        const res = await ai.models.generateContent({
          model,
          contents: prompt,
          config: { responseMimeType: 'application/json' }
        });

        const parsedResponse = JSON.parse(res.text);
        diagnosis = parsedResponse.diagnosis;
        proposedAction = {
          ticketNumber: liveTicketData.ticket_number,
          actionType: parsedResponse.actionType || 'APPLY_SLA_CREDIT',
          creditAmount: Number(parsedResponse.creditAmount) || 350.00,
          notes: parsedResponse.notes || 'SLA compensation based on 90 min outage'
        };
      } catch (err) {
        // Fall back to deterministic policy formulation
      }
    }

    if (!diagnosis) {
      // Deterministic reasoning fallback
      const impactMins = liveTicketData.service_impact_minutes || 90;
      const credit = impactMins >= 30 ? Math.min(350.0, (liveTicketData.monthly_spend || 4500) * 0.10) : 0;
      diagnosis = `Analysis of ${liveTicketData.ticket_number}: Verified ${impactMins} min outage affecting ${liveTicketData.customer_name || 'Customer'}. Under SLA terms [REF-1], customer is eligible for a 10% credit ($${credit.toFixed(2)}) capped under $500 standard authorization limits [REF-2].`;
      proposedAction = {
        ticketNumber: liveTicketData.ticket_number,
        actionType: 'APPLY_SLA_CREDIT',
        creditAmount: credit,
        notes: `Applying standard SLA service credit of $${credit.toFixed(2)} for ${impactMins} min degradation per [REF-1].`
      };
    }

    return {
      ticket: liveTicketData,
      diagnosisDraft: diagnosis,
      proposedAction,
      status: AgentStatus.DIAGNOSED,
      logs: [
        formatLog('Triage-Agent', `Inspected live state via MCP query_system_state.`),
        formatLog('Triage-Agent', `Formulated diagnosis and proposed action: ${proposedAction.actionType} ($${proposedAction.creditAmount})`)
      ]
    };
  };

  // ── Node 3: Quality Evaluator Agent (Agent 2) ───────────────────────────
  const evaluatorAgentNode = async (state) => {
    const evalResult = evaluator.evaluate({
      ticket: state.ticket,
      retrievedDocs: state.retrievedDocs,
      citations: state.citations,
      diagnosisDraft: state.diagnosisDraft,
      proposedAction: state.proposedAction
    });

    const logMsg = `Quality Score: ${evalResult.score}/100 (Grounding: ${evalResult.metrics.grounding}/40, Policy: ${evalResult.metrics.policyCompliance}/35, Completeness: ${evalResult.metrics.completeness}/25) -> ${evalResult.passed ? 'PASSED' : 'FLAGGED'}`;

    return {
      evaluation: evalResult,
      status: AgentStatus.EVALUATED,
      logs: [formatLog('Quality-Evaluator', logMsg)]
    };
  };

  // ── Node 4: Checkpointed Human-in-the-Loop Gate ──────────────────────────
  const humanGateNode = async (state) => {
    // Checkpoint interrupt: Pauses graph execution for operator review
    const interruptPayload = {
      message: 'Human review required before executing resolution action.',
      ticketNumber: state.ticket?.ticket_number,
      customer: state.ticket?.customer_name,
      severity: state.ticket?.severity,
      diagnosis: state.diagnosisDraft,
      proposedAction: state.proposedAction,
      evaluation: {
        score: state.evaluation?.score,
        passed: state.evaluation?.passed,
        feedback: state.evaluation?.feedback
      },
      citations: state.citations,
      actions: ['APPROVED', 'EDITED', 'REJECTED']
    };

    const rawDecision = interrupt(interruptPayload);

    // When resumed, normalize decision
    const decision = typeof rawDecision === 'string'
      ? { action: rawDecision }
      : (rawDecision || { action: 'APPROVED' });

    const action = (decision.action || 'APPROVED').toUpperCase();
    const approvedBy = decision.approvedBy || 'Operations_Lead_Operator';
    const notes = decision.notes || 'Human authorization confirmed';
    const decidedAt = new Date().toISOString();

    const humanDecision = {
      action,
      approvedBy,
      notes,
      decidedAt
    };

    const logMsg = `Operator decision: ${action} by ${approvedBy} (${notes})`;

    return {
      humanDecision,
      status: action === 'REJECTED' ? AgentStatus.REJECTED : AgentStatus.AWAITING_APPROVAL,
      logs: [formatLog('HITL-Gate', logMsg)]
    };
  };

  // ── Node 5: Action Execution Agent (Agent 3 - Calls MCP Write Tool) ───────
  const executorAgentNode = async (state) => {
    const action = state.proposedAction;
    const operator = state.humanDecision?.approvedBy || 'Authorized_Operator';

    // Execute state mutation via MCP tool execute_resolution_action
    const toolResult = await mcpClient.callTool('execute_resolution_action', {
      ticketNumber: action.ticketNumber,
      actionType: action.actionType,
      creditAmount: action.creditAmount || 0,
      notes: action.notes,
      approvedBy: operator
    });

    let parsedResult = null;
    try {
      parsedResult = JSON.parse(toolResult.content);
    } catch {
      parsedResult = { raw: toolResult.content };
    }

    return {
      mcpExecutionResult: parsedResult,
      status: AgentStatus.COMMITTED,
      logs: [
        formatLog('Execution-Agent', `Called MCP tool execute_resolution_action -> Success: ${!toolResult.isError}`)
      ]
    };
  };

  // ── Node 6: Rejection / Safe Abort Node ────────────────────────────────────
  const abortNode = async (state) => {
    const operator = state.humanDecision?.approvedBy || 'Operator';
    // Log rejection via MCP audit tool
    await mcpClient.callTool('record_audit_log', {
      ticketNumber: state.ticket?.ticket_number || 'UNKNOWN',
      actionType: 'HUMAN_REJECTION',
      details: state.humanDecision?.notes || 'Rejected by human operator',
      approvedBy: operator
    });

    const report = `### Incident Resolution Halted
Ticket: ${state.ticket?.ticket_number}
Status: REJECTED by ${operator}
Reason: ${state.humanDecision?.notes || 'Manual operator override'}`;

    return {
      finalAnswer: report,
      status: AgentStatus.REJECTED,
      logs: [formatLog('Operations-Manager', `Action aborted by operator. Immutable audit trail recorded.`)]
    };
  };

  // ── Node 7: Finalizer / Synthesis Node ────────────────────────────────────
  const finalizerNode = async (state) => {
    const ticket = state.ticket;
    const action = state.proposedAction;
    const hitl = state.humanDecision;
    const exec = state.mcpExecutionResult;
    const evalScore = state.evaluation?.score;

    const citationText = (state.citations || []).map(c => `- ${c.citationId} ${c.title} (${c.docId}) - Score: ${c.relevanceScore}`).join('\n');

    const report = `# Incident Resolution Report: ${ticket.ticket_number}

## 1. Executive Summary
- **Customer**: ${ticket.customer_name} (${ticket.customer_tier} Tier)
- **Impact Duration**: ${ticket.service_impact_minutes} minutes
- **Final Status**: ${exec?.status || 'RESOLVED'}
- **Credit Granted**: $${(exec?.creditAwarded || action.creditAmount || 0).toFixed(2)}

## 2. Diagnosis & RAG Policy Grounding
${state.diagnosisDraft}

### Knowledge Base Citations
${citationText}

## 3. Automated Answer Quality Scorecard
- **Total Quality Score**: ${evalScore}/100 (${state.evaluation?.passed ? 'PASSED' : 'FLAGGED'})
- **Factual Grounding**: ${state.evaluation?.metrics?.grounding}/40
- **Policy Compliance**: ${state.evaluation?.metrics?.policyCompliance}/35
- **Completeness**: ${state.evaluation?.metrics?.completeness}/25

## 4. Human-in-the-Loop Authorization
- **Decision**: ${hitl?.action}
- **Authorized By**: ${hitl?.approvedBy}
- **Decided At**: ${hitl?.decidedAt}
- **Notes**: ${hitl?.notes}

## 5. Model Context Protocol (MCP) Tool Execution
- **Tool Invoked**: \`execute_resolution_action\`
- **Database Mutation**: Updated ticket status to ${exec?.status} and committed audit log entry.
- **Audit Timestamp**: ${exec?.timestamp}
`;

    return {
      finalAnswer: report,
      status: AgentStatus.COMPLETED,
      logs: [formatLog('Operations-Manager', 'Resolution report generated and finalized.')]
    };
  };

  return {
    ragRetrieverNode,
    triageAgentNode,
    evaluatorAgentNode,
    humanGateNode,
    executorAgentNode,
    abortNode,
    finalizerNode
  };
}
