// befundTicket.js — creates tickets from BCF findings (72-13, N-12).
//
// Why: the finding world (BCF topics in BimModel.befunde_layer) and the ticket
// world (Issue) were separate, so dashboard, reports and BIM viewer never saw
// the findings of the check suite. This module is the ONLY bitApi access of
// the chain finding → ticket; BcfIssues.jsx keeps reading and writing its layer
// through load/saveBimModel and goes through here for tickets.
//
// In:  project id, BCF topic (parseBcfZip form), befunde_layer (answers).
// Out: Issue records of the project; one new Issue per finding at most.
// Side effects: bitApi.entities.Issue.filter / create (Express, demo
//   IndexedDB or cloud, whatever bitApi is wired to).

import { bitApi } from '@core/api/bitApi';

import { befundZuIssue, ticketZuBefund } from './befundSpur.js';

/**
 * @typedef {{filter: (query: object) => Promise<Array<object>>,
 *   create: (data: object) => Promise<object>}} IssueApi
 */

/**
 * The Issue entity of bitApi. bitApi.entities is a Proxy that tsc sees as {}
 * (bitApi.js); the cast names the two calls this module uses. Resolved per
 * call, like every other bitApi access.
 * @returns {IssueApi}
 */
function issueApi() {
  return /** @type {{Issue: IssueApi}} */ (bitApi.entities).Issue;
}

/**
 * All tickets of a project.
 * @param {string|null|undefined} projectId
 * @returns {Promise<Array<object>>} Issue records; [] without project
 */
export async function ticketsDesProjekts(projectId) {
  if (!projectId) return [];
  const liste = await issueApi().filter({ project_id: projectId });
  return Array.isArray(liste) ? liste : [];
}

// Calls in flight per project + topic. A double click fires twice before React
// has re-rendered the disabled button; both calls then share one create instead
// of racing past the duplicate check.
const laufend = new Map();

/**
 * Ticket for a BCF finding: returns the existing ticket with the same
 * bcf_topic_guid, otherwise creates one (befundZuIssue) in the project.
 * @param {{guid?: string, titel?: string, beschreibung?: string,
 *   topicStatus?: string, prioritaet?: string|null, ifcGuids?: string[]}} topic
 * @param {object|null} layer befunde_layer (answer status beats import status)
 * @param {string} projectId project the ticket belongs to
 * @returns {Promise<{issue: object, neu: boolean}>} neu = true when created now
 * @throws {Error} without project or topic guid, or when bitApi fails
 */
export function ticketFuerBefund(topic, layer, projectId) {
  const guid = String(topic?.guid || '').trim().toLowerCase();
  if (!projectId) return Promise.reject(new Error('Kein Projekt gewählt'));
  if (!guid) return Promise.reject(new Error('Befund ohne Guid'));
  const schluessel = `${projectId}|${guid}`;
  const offen = laufend.get(schluessel);
  if (offen) return offen;
  const auftrag = (async () => {
    const vorhanden = ticketZuBefund(await ticketsDesProjekts(projectId), guid);
    if (vorhanden) return { issue: vorhanden, neu: false };
    const issue = await issueApi().create(befundZuIssue(topic, { projectId, layer }));
    return { issue, neu: true };
  })().finally(() => laufend.delete(schluessel));
  laufend.set(schluessel, auftrag);
  return auftrag;
}
