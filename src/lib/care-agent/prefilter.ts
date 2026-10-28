// Care Agent: the deterministic advice pre-filter (English and Spanish). Pure. It runs AFTER the authorization gates and BEFORE any
// record read, rate-limit spend or model call; a hit means provider fetch count zero and canned copy. Internal categories exist only
// to organise the patterns; they map onto the two public refusal codes: medical_advice and out_of_scope.
//
// Policy: when a question is ambiguous between advice and a record lookup, REFUSE (the cost is a canned message; the alternative is
// advice). A plain lookup ("What dose is listed in the records?") that merely mentions a medication, dose, symptom or visit is NOT
// refused; "Should we change the dose?" is.
import type { AgentRefusal } from "./contract";

export type AdviceCategory =
  "urgent" | "dose_change" | "treatment" | "diagnosis" | "prognosis" | "manipulation" | "action";

export interface PrefilterHit {
  refusal: AgentRefusal;
  category: AdviceCategory;
}

/** Lowercase, accents stripped (so Spanish patterns need no accents), curly quotes straightened, whitespace collapsed. */
export function normalizeQuestion(q: string): string {
  return q
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[¿¡]/g, "") // Spanish opening marks must not hide a lookup opener
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const re = (source: string) => new RegExp(source, "i");

// ---- shared vocabulary ------------------------------------------------------------------------------------------------------

const CUE = re(
  "\\b(should|shouldn't|shouldnt|ought to|ok to|okay to|safe to|is it (ok|okay|safe|fine|alright)|can (she|he|i|we|they|mom|dad|grandma|grandpa|the patient)|could (she|he|i|we|they)|may (she|he|i|we)|need to|do (i|we) need|what if|what do i do|what should|would it be|better to|is it better|worth (giving|taking)|deberia\\w*|debo|debemos|debe (ella|el)|puede (ella|el|ellos|tomar|darle|dejar|seguir)|puedo|podemos|es seguro|esta bien (que|si)|conviene|que hago|que debo|que deberia\\w*|que pasa si|necesita\\w*)\\b|recommend\\w*|advice|advise|aconsej\\w*|recomiend\\w*|consejo",
);

const ACTION_VERB = re(
  "\\b(take|taking|give|giving|skip|skipping|stop|stopping|start|starting|double|halve|increase|decrease|lower|raise|change|changing|adjust|crush|split|combine|mix|withhold|miss|missed|substitut\\w*|switch|replace|discontinu\\w*|quit|add|remove|cut|tomar|toma|dar|darle|darla|darlo|dale|saltar|omitir|suspender|parar|dejar|empezar|comenzar|duplicar|doble|aumentar|reducir|disminuir|subir|bajar|cambiar|ajustar|combinar|mezclar|sustituir|reemplazar|quitar|agregar|anadir)\\b",
);

const MED_WORD = re(
  "\\b(medication|medications|medicine|medicines|med|meds|pill|pills|dose|doses|dosage|mg|mcg|tablet|capsule|insulin|inhaler|patch|drug|prescription|ibuprofen|aspirin|tylenol|acetaminophen|paracetamol|advil|motrin|aleve|naproxen|antibiotic|antibiotics|laxative|medicamento|medicamentos|medicina|medicinas|pastilla|pastillas|pildora|pildoras|dosis|tableta|capsula|insulina|inhalador|parche|receta|farmaco|ibuprofeno|aspirina|antibiotico|antibioticos)\\b",
);

/** A record-lookup opener. Used only to keep a lookup about a symptom (past) from reading as an emergency (present). */
const LOOKUP_START = re(
  "^(what|when|who|which|where|did|has|have|how many|list|show|tell me what|que|cual|cuales|cuando|quien|donde|cuantos|cuantas|hay|tomo|dame|muestrame|lista|dime)\\b",
);
const PRESENT = re(
  "\\b(right now|now|currently|just now|at the moment|today|ahora|ahorita|en este momento|acaba de|hoy)\\b",
);

// ---- categories --------------------------------------------------------------------------------------------------------------

const URGENT = re(
  "chest pain|can't breathe|cannot breathe|can not breathe|trouble breathing|short of breath|not breathing|stopped breathing|unresponsive|isn't responding|is not responding|won't wake|wont wake|passed out|fainted|seizure|convulsion|face droop|slurred|choking|overdos|took too (much|many)|suicid|bleeding (a lot|heavily|badly|won't stop)|fell and|call 911|emergency room|\\ber\\b|urgent care|ambulance|(should|do|can|must) (we|i) (call|go|take|bring).{0,30}(doctor|er|hospital|ambulance|911|urgent care|emergency)|dolor de pecho|no puede respirar|no respira|falta de aire|dejo de respirar|inconsciente|no responde|no despierta|se desmayo|convulsion|derrame|ictus|sangrado (fuerte|abundante|que no para)|sobredosis|suicid|se cayo y|llamar al 911|llamo al 911|sala de emergencia|urgencias|ambulancia|(debemos|debo|deberia\\w*|puedo|podemos) (llamar|ir|llevar).{0,30}(medico|doctor|hospital|ambulancia|911|urgencias|emergencia)",
);

const MANIPULATION = re(
  "ignore (all |your |the |any )?(previous|above|prior|earlier|these) |disregard (all |your |the )?(previous|above|prior|instructions|rules)|forget (your|the|all) (instructions|rules)|system prompt|your (instructions|rules|prompt)|reveal.{0,20}(prompt|instructions|rules)|developer mode|pretend (you are|to be)|jailbreak|\\bact as\\b|other famil|another family|all famil|every famil|everyone's (records|data)|ignora (todas |tus |las )?(instrucciones|reglas)|instrucciones anteriores|olvida (tus|las) (instrucciones|reglas)|prompt del sistema|muestrame (tu|el) prompt|revela.{0,20}(instrucciones|reglas|prompt)|otras familias|otra familia|todas las familias|datos de (otras|todas)",
);

const DOSE_SPECIFIC = re(
  "how much (should|can|could|may)|what dose (should|can|is safe)|safe (dose|amount)|double (up|dose|the)|extra dose|(can|may) (she|he|i|we) take .{1,40} (with|and|together)|cuanto (debo|debe|puedo|puede|deberia\\w*|le doy)|que dosis (debo|debe|deberia\\w*|puedo)|dosis (segura|doble|extra)|puede tomar .{1,40} (con|y) ",
);

const TREAT_STANDALONE = re(
  "what (helps|works|is good for|should (i|we) give)|what (should|do) (i|we) do|what to do (about|if|when)|how (do i|can i|to|do we|can we) (treat|ease|relieve|reduce|lower|stop|cure|soothe)|home remedy|remedy for|medicine for|something for (her|his|the)|que (ayuda|sirve|funciona|es bueno)|que (debo|debemos|hago|hacemos) hacer|que hacer (con|si|cuando)|que hago (si|con|cuando)|como (tratar|aliviar|reducir|bajar|curar|calmar)|remedio (casero|para)|algo para (su|el|la)",
);
const TREAT_TERMS = re(
  "\\b(treat|treatment|remedy|cure|antibiotic|painkiller|supplement|therapy|exercise|diet|heating pad|ice pack|tratamiento|tratar|remedio|cura|antibiotico|suplemento|terapia|ejercicio|dieta)\\b",
);

const DIAGNOSIS = re(
  "diagnos|what('s| is) wrong|does (she|he|they|mom|dad|grandma|grandpa) have (an? |any |the )?(infection|uti|pneumonia|dementia|diabetes|delirium|cancer|stroke|flu|cold|fever|clot|disease|condition|illness|problem)|is (it|this|that) (a |an )?(stroke|infection|uti|pneumonia|dementia|diabetes|delirium|clot|flu|cold|emergency)|what does .{0,40}(mean|indicate|suggest)|interpret|is (this|that|it|her|his|she|he)\\b.{0,30}\\b(normal|abnormal|too high|too low|dangerous|serious|worrying|concerning|bad)\\b|(blood pressure|\\bbp\\b|sugar|glucose|heart rate|pulse|temperature|oxygen|\\blab\\b|result|reading|x-?ray|\\bscan\\b)\\b.{0,25}\\b(mean|normal|abnormal|too high|too low)\\b|diagnostic|que le pasa|que enfermedad|esta enferm[oa]|tiene (una |un )?(infeccion|derrame|diabetes|demencia|neumonia|delirio|cancer|fiebre|gripe)|es (una |un )?(infeccion|derrame|demencia|diabetes)|que significa|interpret|es normal|esta (muy )?(alta|alto|baja|bajo)\\b|es (peligroso|grave|serio|preocupante)|(presion|azucar|glucosa|pulso|temperatura|oxigeno|resultado|lectura|analisis).{0,25}(significa|normal|alta|alto|baja|bajo)",
);

const PROGNOSIS = re(
  "will (she|he|they) (get better|recover|die|survive|live|improve)|how long (does|will|has|is) (she|he)|life expectancy|prognosis|is (she|he) dying|getting worse|going to (die|recover|be ok|be okay)|se (va a )?(recuperar|mejorar|morir)|cuanto tiempo (le queda|vivira)|esperanza de vida|pronostico|se esta muriendo|esta empeorando|va a (morir|estar bien|mejorar)",
);

/** Requests to create, edit, send, delete or otherwise ACT on records: the agent has no write or action path. */
const ACTION = re(
  "\\b(delete|remove|edit|update|create|add|cancel|reschedule|schedule|send|text|email|remind|mark|assign|book|rename|elimina|borra|edita|actualiza|crea|agrega|anade|cancela|reprograma|programa|envia|manda|recuerda|marca|asigna|reserva)\\w*\\b.{0,25}\\b(visit|appointment|medication|task|note|handoff|record|shift|reminder|message|dose|visita|cita|medicamento|tarea|nota|relevo|registro|turno|recordatorio|mensaje|dosis)\\b",
);

/** Returns a refusal for advice-seeking, emergencies, manipulation and action requests; null for a plain record question. */
export function prefilter(question: string): PrefilterHit | null {
  const q = normalizeQuestion(question);
  if (q === "") return null;

  // 1. Urgent / triage. A lookup about the PAST ("When was her last seizure?") is a record question unless it says "now".
  const lookup = LOOKUP_START.test(q);
  if (URGENT.test(q) && (!lookup || PRESENT.test(q)))
    return { refusal: "medical_advice", category: "urgent" };

  // 2. Manipulation of the agent or requests for other families' data.
  if (MANIPULATION.test(q)) return { refusal: "out_of_scope", category: "manipulation" };

  // 3. Medical advice.
  const cue = CUE.test(q);
  if (DOSE_SPECIFIC.test(q) || (cue && ACTION_VERB.test(q) && MED_WORD.test(q)))
    return { refusal: "medical_advice", category: "dose_change" };
  if (TREAT_STANDALONE.test(q) || (cue && TREAT_TERMS.test(q)))
    return { refusal: "medical_advice", category: "treatment" };
  if (DIAGNOSIS.test(q)) return { refusal: "medical_advice", category: "diagnosis" };
  if (PROGNOSIS.test(q)) return { refusal: "medical_advice", category: "prognosis" };

  // 4. Actions on records.
  if (ACTION.test(q)) return { refusal: "out_of_scope", category: "action" };
  return null;
}
