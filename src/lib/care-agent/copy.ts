// Care Agent: canned copy (English and Spanish) and language choice. Pure. The model NEVER writes refusal, fallback or withheld
// text: the server substitutes these strings, in the language of the current question.
import type { AgentRefusal, Language } from "./contract";

export const REFUSAL_COPY: Record<Language, Record<AgentRefusal, string>> = {
  en: {
    medical_advice:
      "I can't give medical advice, diagnose, or recommend a treatment or any change to a medication or dose. Please ask the doctor, pharmacist or care team. If symptoms seem urgent, seek emergency help right away and call your local emergency number. I can tell you what is recorded in Pendia.",
    out_of_scope:
      "I can only answer questions about what is recorded in your family's Pendia records: visits, medications, handoffs and coverage. I can't take actions, change records, or share my instructions.",
  },
  es: {
    medical_advice:
      "No puedo dar consejos médicos, diagnosticar ni recomendar un tratamiento o un cambio de medicamento o dosis. Consulte al médico, al farmacéutico o al equipo de cuidado. Si los síntomas parecen urgentes, busque ayuda de emergencia de inmediato y llame a su número local de emergencias. Puedo decirle qué hay registrado en Pendia.",
    out_of_scope:
      "Solo puedo responder preguntas sobre lo que está registrado en los registros de Pendia de su familia: visitas, medicamentos, relevos y cobertura. No puedo realizar acciones, cambiar registros ni compartir mis instrucciones.",
  },
};

/** The fixed "unverified" outcome: shown instead of ANY model text that fails validation. */
export const UNVERIFIED_COPY: Record<Language, string> = {
  en: "I couldn't verify an answer against the records, so I'm not showing one. Please check the Visits, Meds and Handoffs pages directly.",
  es: "No pude verificar una respuesta con los registros, así que no la muestro. Revise directamente las páginas de Visitas, Medicamentos y Relevos.",
};

/** Server-added `missing` entries (deterministic; not model-authored). */
export const MISSING_COPY: Record<
  Language,
  {
    withheldHandoff: string;
    withheldDetails: string;
    notVisible: Record<"visits" | "meds" | "schedule", string>;
  }
> = {
  en: {
    withheldHandoff:
      "Handoff details (free-text and medication-related fields) are withheld from this member.",
    withheldDetails:
      "Some free-text details are withheld from this member because they may contain medication information.",
    notVisible: {
      visits: "Visits are not visible to this member.",
      meds: "Medications, dose reports and medication changes are not visible to this member.",
      schedule: "Handoffs, shifts, tasks and watch items are not visible to this member.",
    },
  },
  es: {
    withheldHandoff:
      "Los detalles del relevo (texto libre y campos relacionados con medicamentos) no están disponibles para este miembro.",
    withheldDetails:
      "Algunos detalles de texto libre no están disponibles para este miembro porque pueden contener información sobre medicamentos.",
    notVisible: {
      visits: "Las visitas no son visibles para este miembro.",
      meds: "Los medicamentos, las dosis registradas y los cambios de medicamentos no son visibles para este miembro.",
      schedule:
        "Los relevos, turnos, tareas y elementos de vigilancia no son visibles para este miembro.",
    },
  },
};

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const ES_MARKERS =
  /\b(que|cual|cuales|cuando|quien|quienes|donde|como|cuanto|cuantos|cuantas|esta|estan|tiene|tienen|hay|ella|el|la|los|las|una|un|del|para|por|con|sin|mi|su|sus|mama|papa|abuela|abuelo|medicamento|medicamentos|medicina|pastilla|dosis|cita|visita|tarea|turno|relevo|hoy|manana|ayer|semana|proxima|ultima|tomo|dar|puede|puedo|debo|y|es|son|fue)\b|[¿¡ñ]/g;
const EN_MARKERS =
  /\b(what|which|when|who|where|how|many|much|is|are|was|were|does|did|do|has|have|her|his|she|he|the|a|an|of|for|with|without|my|their|mom|dad|grandma|grandpa|medication|medications|medicine|pill|dose|doses|appointment|visit|task|shift|handoff|today|tomorrow|yesterday|week|next|last|take|give|can|should|and|to|in|on|at)\b/g;

/**
 * The language of the CURRENT question. When it is too short to tell (fewer than 2 informative words in total), the member's own
 * language preference decides; failing that, English.
 */
export function detectLanguage(
  question: string,
  memberLanguage: string | null | undefined,
): Language {
  const q = norm(question);
  const es = (q.match(ES_MARKERS) ?? []).length + (/[¿¡ñ]/.test(question) ? 2 : 0);
  const en = (q.match(EN_MARKERS) ?? []).length;
  if (es + en < 2 || es === en) return memberLanguage === "es" ? "es" : "en";
  return es > en ? "es" : "en";
}

/** Interface copy for the Ask page (the placeholder shown to ineligible families is NOT here: it stays exactly as it was). */
export const UI_COPY: Record<
  Language,
  {
    checking: string;
    statusError: string;
    tryAgain: string;
    demoBanner: string;
    questionLabel: string;
    ask: string;
    asking: string;
    cancel: string;
    answerHeading: string;
    aiBadge: string;
    sourcesHeading: string;
    noSources: string;
    missingHeading: string;
    footer: string;
    askAnother: string;
    rateLimited: string;
    error: string;
    exampleHeading: string;
    examples: string[];
    youSaid: string;
  }
> = {
  en: {
    checking: "Checking whether Ask Pendia is available…",
    statusError: "Couldn't check whether Ask Pendia is available.",
    tryAgain: "Try again",
    demoBanner:
      "Demo family — synthetic records only. Answers are generated by AI from this family's Pendia records and can be incomplete or wrong. Not medical advice.",
    questionLabel: "Your question",
    ask: "Ask",
    asking: "Looking through the records…",
    cancel: "Cancel",
    answerHeading: "Answer",
    aiBadge: "AI-generated from Pendia records",
    sourcesHeading: "Sources",
    noSources: "No sources — nothing in the records supports a specific answer.",
    missingHeading: "Not in the records",
    footer: "Not medical advice. Check the linked records.",
    askAnother: "Ask another question",
    rateLimited: "You've asked several questions recently. Please wait a while and try again.",
    error: "Couldn't get an answer right now. Your question wasn't saved. Try again.",
    exampleHeading: "Examples",
    examples: [
      "What medications are listed in these records?",
      "When is the next visit?",
      "Who is covering this week?",
    ],
    youSaid: "You asked",
  },
  es: {
    checking: "Comprobando si Ask Pendia está disponible…",
    statusError: "No se pudo comprobar si Ask Pendia está disponible.",
    tryAgain: "Intentar de nuevo",
    demoBanner:
      "Familia de demostración — solo registros sintéticos. Las respuestas las genera la IA a partir de los registros de Pendia de esta familia y pueden ser incompletas o incorrectas. No es un consejo médico.",
    questionLabel: "Su pregunta",
    ask: "Preguntar",
    asking: "Buscando en los registros…",
    cancel: "Cancelar",
    answerHeading: "Respuesta",
    aiBadge: "Generado por IA a partir de los registros de Pendia",
    sourcesHeading: "Fuentes",
    noSources: "Sin fuentes: nada en los registros respalda una respuesta específica.",
    missingHeading: "No está en los registros",
    footer: "No es un consejo médico. Revise los registros enlazados.",
    askAnother: "Hacer otra pregunta",
    rateLimited: "Ha hecho varias preguntas recientemente. Espere un poco e intente de nuevo.",
    error: "No se pudo obtener una respuesta ahora. Su pregunta no se guardó. Intente de nuevo.",
    exampleHeading: "Ejemplos",
    examples: [
      "¿Qué medicamentos aparecen en estos registros?",
      "¿Cuándo es la próxima visita?",
      "¿Quién cubre esta semana?",
    ],
    youSaid: "Usted preguntó",
  },
};
