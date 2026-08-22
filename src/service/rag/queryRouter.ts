export type QueryPath = "structured" | "semantic" | "ambiguous";

// Keyword/intent heuristics — simple and testable, not ML-based. Structured
// signals are numeric/aggregate-shaped questions; semantic signals are
// document-lookup/narrative-shaped questions.
const STRUCTURED_PATTERNS = [
  /how many/i,
  /count of/i,
  /total (revenue|sales|cost|amount|parts|job cards)/i,
  /\baverage\b/i,
  /\btrend\b/i,
  /month(ly)?/i,
  /this (week|month|year)/i,
  /\bcompare\b/i,
  /\bgrowth\b/i,
  /\bsum\b/i,
  /percentage/i,
  /\btop\s*\d+/i,
];

const SEMANTIC_PATTERNS = [
  /which (part|job card|customer|report)/i,
  /\bdescribe\b/i,
  /details? (about|on|for)/i,
  /what (happened|is the status)/i,
  /\bfind\b/i,
  /search for/i,
  /tell me about/i,
];

/**
 * Classifies a natural-language question into a retrieval path. Structured
 * questions are answered from existing aggregate functions (the LLM only
 * narrates the returned numbers); semantic questions go through embedding
 * retrieval; ambiguous questions run both, preferring the structured number
 * for any figure that's stated (see rag.service.ts).
 */
export function classifyQuery(question: string): QueryPath {
  const hasStructured = STRUCTURED_PATTERNS.some((r) => r.test(question));
  const hasSemantic = SEMANTIC_PATTERNS.some((r) => r.test(question));

  if (hasStructured && hasSemantic) return "ambiguous";
  if (hasStructured) return "structured";
  if (hasSemantic) return "semantic";

  // No clear signal either way. A number-shaped question with no other
  // signal is treated as ambiguous rather than assumed semantic, since a
  // wrong "semantic-only" guess risks the LLM inventing a number instead of
  // computing it.
  const looksNumeric = /\d+/.test(question) || /how (much|many)/i.test(question);
  return looksNumeric ? "ambiguous" : "semantic";
}
