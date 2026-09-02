# **Kazi, Kabla ya Daktari (KKD)** 

## **Product and Engineering Requirements Specification** 

**Version:** 0.2 - Team Workstream Specification **Date:** 2 September 2026 **Status:** Implementation draft 

**Primary audience:** KKD engineering team, product, clinical advisors, privacy/security reviewers 

## **1. Product Definition** 

**Kazi, Kabla ya Daktari** helps patients turn assumptions about what they have into a clear account of what they are actually experiencing before they speak to a healthcare professional - **without diagnosing them** . 

The product is designed for the patient who searched symptoms at 2:00 a.m. and arrives at a clinic handing the nurse a verdict instead of describing the symptoms. 

KKD must transform: 

“I have appendicitis.” 

into a factual symptom account such as: 

“Abdominal pain began approximately eight hours ago. It was initially central and is now reported predominantly in the lower-right abdomen. Pain is rated 7/10. The patient reports nausea and reduced appetite and reports no diarrhoea.” 

The system may help a patient decide whether reported symptoms warrant immediate, same-day, soon, or routine professional attention, but **urgency is not diagnosis** . 

### **1.1 Product constitution - non-negotiable rules** 

1. **Never diagnose.** KKD must not tell a patient what disease or condition they have. 

2. **Never speculate diagnostically.** Patient-facing output must not say or imply “you may have”, “this sounds like”, “this is likely”, “possible diagnosis”, “differential diagnosis”, or equivalent wording in any supported language. 

3. **Translate verdicts back into symptoms.** If a user says “I have malaria”, “I have appendicitis”, or another self-diagnosis, KKD asks what they are experiencing and elicits observable/reported facts. 

1 

4. **Describe, clarify, organize.** The AI may elicit symptom location, timing, duration, movement, intensity, aggravating/relieving factors, associated symptoms, measurements, medications already taken, relevant history, and context. 

5. **Safety escalation is allowed without diagnosis.** KKD may state that reported symptoms require urgent professional assessment without naming a suspected disease. 

6. **The clinic stores nothing clinically.** Clinic/anonymous sessions are ephemeral. Raw clinical session content must not be written to Supabase or normal application logs. 

7. **Longitudinal tracking is separate and explicit.** A persistent patient health record exists only after clear opt-in and must remain logically separate from the clinic/anonymous session path. 

8. **Every new session starts by disclosing AI involvement.** No clinical interaction proceeds before the appropriate channel-specific AI disclosure is presented. 

9. **Clinicians receive facts, not model verdicts.** The handover output describes what the patient reported, denied, measured, or did not know. 

10. **A human verdict remains human.** Voice escalation may connect a patient to a human clinician. ElevenLabs may power the voice interface, but the AI must not impersonate a clinician or issue a diagnosis. 

11. **Every interface uses the same safety rules.** Web, WhatsApp, USSD, voice, REST adapters, and MCP must call shared business logic rather than maintain separate clinical behavior. 

## **2. Agreed Technology Stack** 

|Layer|Agreed technology|Engineering decision|
|---|---|---|
|Frontend|**React + Vite +**<br>**TypeScript**|The only web frontend<br>stack for the<br>patient-facing<br>application.|
|Backend|**Express.js +**<br>**TypeScript**|Versioned API and<br>shared application<br>service layer.|
|Database/Auth|**Supabase**|Persistent, consented<br>patient-owned data,<br>Auth, and Postgres.|
|Ephemeral state/cache|**Redis**|Anonymous clinic<br>sessions, rate limits, safe<br>caches, distributed<br>locks, job queues.|



2 

|Layer|Agreed technology|Engineering decision|
|---|---|---|
|Background tasks|**BullMQ + Redis**|Node-native queues;<br>worker deployed<br>separately on Render.|
|LLM|**Claude API**|Symptom fact<br>extraction, question<br>planning, language<br>handling,<br>summarization.|
|Deployment|**Render**|Separate frontend, API,<br>worker, and MCP<br>services for staging and<br>production.|
|Voice|**ElevenLabs**|Conversational<br>voice/TTS; telephony<br>connected using an<br>approved phone<br>provider/integration<br>such as Twilio or SIP.|
|MCP|**Model Context**<br>**Protocol TypeScript**<br>**server**|External agent interface<br>over the same KKD<br>service layer.|
|Testing|Vitest, React Testing<br>Library, Supertest,|Unit, integration,<br>contract, and|
||Playwright|end-to-end tests.|
|Contracts|Zod + TypeScript|Validate every request,<br>AI output, job payload,<br>webhook, and MCP<br>input/output.|
|Observability|Sentry + structured<br>application logging|Raw health content and<br>PII disabled/redacted<br>by default.|



### **2.1 Background task decision** 

Use **BullMQ backed by Redis** , with the worker deployed as a **Render Background Worker** . BullMQ is appropriate for the selected Node/TypeScript stack and Render documents BullMQ as a common Node background-worker framework. 

Background jobs are appropriate for: 

- scheduled patient check-ins; 

- outbound notifications; 

- provider-directory synchronization; 

- non-urgent exports; 

3 

- voice callback orchestration; 

- cleanup/purge jobs; 

- analytics aggregation; 

- retryable third-party integration calls. 

**Do not put immediate safety/seriousness evaluation in a queue.** Anything that determines what the current user should do must run synchronously. 

## **3. Team Ownership and Workstreams** 

|#|Workstream|Owner(s)|Primary<br>deliverable|
|---|---|---|---|
|1|Project<br>Bootstrap and<br>Shared Platform|**Evans**|Monorepo,<br>environments,<br>API skeleton, Su-<br>pabase/Redis/Claude/Render<br>wiring, queues,<br>shared contracts,<br>API adapter<br>layer|
|2|Health Records +<br>System Score|**Duncan**|Patient-owned<br>health record<br>model, record<br>APIs, score<br>engine and score<br>history|
|3|PII Redaction|**Evans**|Reusable PII de-<br>tection/redaction<br>pipeline across<br>AI, logs, queues,<br>webhooks, and<br>integrations|
|4|Severity +<br>Health Profling|**Antonia**|Urgency engine,<br>follow-up/profle<br>logic, trends,<br>check-in<br>schedules, safe<br>progression<br>insights|
|5|Geolocation +<br>Connecting<br>Patients to|**Hassan**|Location consent,<br>provider search,<br>care-category|
||Doctors||routing, ranking<br>and handof|



4 

|#|Workstream|Owner(s)|Primary<br>deliverable|
|---|---|---|---|
|6|Multilingual +<br>React/Vite<br>Frontend|**Brian**|Patient-facing<br>React/Vite<br>application,<br>shared UX,<br>language<br>handling and<br>multilingual<br>safety UX|
|7|USSD +<br>WhatsApp<br>Conversation|**Noordin**|Channel adapters<br>over the shared<br>conversation|
||Interfaces||engine|
|8|Voice Calling<br>with ElevenLabs|**Dancun**|Voice<br>session/callback<br>layer using<br>ElevenLabs with<br>telephony<br>integration and<br>human-clinician<br>handof|
|9|MCP Interface|**Evans +**<br>**Antonia**|MCP server<br>exposing<br>approved KKD<br>capabilities<br>without<br>bypassing<br>safety/privacy<br>rules|



### **3.1 Cross-team rule** 

No workstream may create a separate diagnostic engine, separate symptom model, or separate clinical conversation implementation. Every channel must call shared contracts and services from the core platform. 

# **PART I - PHASE 0: PROJECT BOOTSTRAP** 

## **4. Workstream 1 - Project Bootstrap and Shared Platform Owner: Evans** 

5 

### **4.1 Goal** 

Create a reproducible development platform before feature teams begin substantive integration work. The output of this workstream is not merely a repository; it is the set of contracts and infrastructure that prevent every feature team from inventing a different way to handle sessions, AI calls, privacy, scores, queues, errors, and external APIs. 

### **4.2 Required repository structure** 

Use a TypeScript monorepo. Recommended: **pnpm workspaces + Turborepo** . 

```
kkd/
|--apps/
||--web/
||--api/
||--worker/
|`--mcp/
|
|--packages/
||--ui/
||--contracts/
||--ai/
||--clinical-safety/
||--scoring/
||--pii/
||--i18n/
||--integrations/
||--observability/
||--config/
||--api-client/
|`--testing/
|
|--supabase/
||--migrations/
||--tests/
|`--seed.sql
|
|--docs/
||--architecture/
||--adr/
||--clinical-rules/
||--prompts/
|`--runbooks/
|
|--.github/workflows/
```

```
#React+Vitepatient/clinicapplication
#ExpressAPI
#BullMQworkers/schedulers
#MCPserver
#sharedReactcomponents/designprimitives
#ZodschemasandsharedTypeScripttypes
#Claudeclient,prompts,structuredoutputs
#urgencyrulesandruleexecution
#non-diagnosticscoringprimitives
#PIIdetection/redaction
#languageresourcesandlocalehelpers
#provider/API/WhatsApp/USSD/voiceadapters
#safelogger/tracing/Sentryhelpers
#typedenvironmentconfiguration
#typedfrontend/clientAPIwrapper
#fixtures,mocks,regressioncases
```

6 

```
|--render.yaml
```

- `|-- turbo.json |-- pnpm-workspace.yaml` 

- `|-- .nvmrc` 

- ``-- package.json` 

### **4.3 Exact implementation tasks** 

### **A. Runtime and package management** 

1. Pin Node.js to one supported LTS version using `.nvmrc` or `.node-version` . 

2. Pin `pnpm` in the root `package.json packageManager` field. 

3. Enable strict TypeScript across all apps/packages. 

4. Configure shared ESLint and Prettier rules. 

5. Add root scripts: 

```
{
"scripts":{
"dev":"turbodev",
"build":"turbobuild",
"lint":"turbolint",
"typecheck":"turbotypecheck",
"test":"turbotest",
"test:e2e":"playwrighttest"
}
```

```
}
```

**B. React + Vite base application** Evans should bootstrap the base Vite application and hand the product UI implementation to Brian. 

Required setup: 

- `vite` + `@vitejs/plugin-react` ; 

- React Router for application routes; 

- TanStack Query for server state; 

- React Hook Form + Zod resolver for forms; 

- a small state layer only where local client state genuinely needs it; 

- route-level error boundary; 

- API client generated/wrapped from shared Zod/OpenAPI contracts; 

- no backend service-role credentials in the browser; 

- CSP-compatible build and secure environment-variable handling. 

Suggested routes: 

```
/
/session/new
/session/:sessionId
/session/:sessionId/summary
/profile
```

7 

```
/profile/history
/profile/check-ins
/care-near-me
/settings/privacy
```

**C. Express API base** Create `/api/v1` with modules: 

```
health
sessions
conversation
summary
records
scores
severity
profiles
providers
location
integrations
whatsapp
ussd
voice
mcp-internal
```

Every route must follow: 

```
request-id
```

- `-> security headers` 

- `-> CORS/origin check` 

- `-> body-size limit` 

- `-> auth where required` 

- `-> rate limit` 

- `-> schema validation` 

- `-> handler/service` 

- `-> response schema validation` 

- `-> privacy-safe telemetry` 

Implement: 

```
GET/api/v1/health/live
GET/api/v1/health/ready
```

`ready` must verify Redis and required backend dependencies without returning credentials or patient data. 

**D. Supabase foundation** Create separate **staging** and **production** Supabase projects. 

Persistent tables may hold only data that is intentionally persistent, for example: 

8 

```
profiles
consents
health_records
health_record_entries
score_snapshots
health_profile_settings
follow_up_schedules
provider_directory
provider_specialties
ai_disclosure_versions
integration_configs
```

Rules: 

- anonymous clinic conversation transcripts do **not** go to Supabase; 

- RLS must be enabled for every exposed patient-owned table; 

- database grants must be minimized, not merely hidden behind RLS; 

- service-role credentials remain server-only; 

- patient rows use `auth.uid()` ownership policies; 

- schema migrations live in source control; 

- RLS allow/deny tests live under `supabase/tests/` . 

**E. Redis foundation** Use namespaced keys: 

```
kkd:session:{sessionId}
kkd:ratelimit:{key}
kkd:cache:{provider}:{key}
kkd:lock:{resource}
kkd:bull:{queue}
```

For anonymous clinic sessions: 

- generate opaque UUID/ULID session IDs; 

- set mandatory TTL at creation; 

- update last-activity metadata without allowing infinite retention; 

- close-session endpoint must delete content immediately; 

- a purge worker removes orphaned keys/artifacts; 

- never log the payload being purged. 

**F. Claude foundation** Create a provider service. Route handlers may not call the Claude SDK directly. 

### **`interface`** `KkdAiService {` 

```
extractReportedFacts(input:ExtractFactsInput):Promise<ReportedFacts>;
planNextQuestion(input:QuestionPlanInput):Promise<QuestionPlan>;
summarizeSession(input:SummaryInput):Promise<ConsultationSummary>;
normalizeLanguage(input:NormalizeLanguageInput):Promise<NormalizedText>;
```

```
}
```

9 

Implementation requirements: 

- use Claude structured outputs / JSON Schema where supported; 

- validate again with Zod at the application boundary; 

- store model name, prompt ID, and prompt version in safe operational metadata; 

- keep prompts in source control; 

- write regression tests for self-diagnosis prompts and diagnosis-seeking prompts; 

- do not expose raw chain-of-thought or hidden model reasoning; 

- route free-text through PII controls before third-party processing according to the approved data policy. 

**G. Background worker** Create queues at minimum: 

```
followups
notifications
provider-sync
voice-callbacks
exports
purges
analytics
```

Each job payload must have a Zod schema and an idempotency key where repeat delivery could have side effects. 

Required worker behavior: 

- exponential backoff for retryable network failures; 

- dead-letter/failed-job review process; 

- no raw clinic transcript in job payloads unless the task strictly requires it and TTL/deletion is defined; 

- queue depth and failure metrics; 

- graceful worker shutdown. 

**H. Render environments** Create at least: 

```
kkd-web-stage#React/Vitestaticsite
kkd-api-stage#Expresswebservice
kkd-worker-stage#BullMQbackgroundworker
kkd-mcp-stage#remoteMCPservice
kkd-web-prod
kkd-api-prod
kkd-worker-prod
kkd-mcp-prod
```

Use separate Redis/Supabase credentials for staging and production. 

10 

**I. Typed environment configuration** Minimum variables: `NODE_ENV= APP_ENV=local|staging|production WEB_BASE_URL= API_BASE_URL= SUPABASE_URL= SUPABASE_PUBLISHABLE_KEY= SUPABASE_SERVICE_ROLE_KEY= SUPABASE_DB_URL= REDIS_URL= ANTHROPIC_API_KEY= ANTHROPIC_MODEL=` 

```
EPHEMERAL_SESSION_TTL_SECONDS=
SESSION_MAX_LIFETIME_SECONDS=
```

```
SENTRY_DSN=
LOG_LEVEL=
GEO_PROVIDER=
GEO_API_KEY=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=
```

```
USSD_PROVIDER=
USSD_API_KEY=
USSD_CALLBACK_SECRET=
```

```
ELEVENLABS_API_KEY=
ELEVENLABS_AGENT_ID=
VOICE_PHONE_NUMBER_ID=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
```

```
FEATURE_HEALTH_RECORDS=
FEATURE_HEALTH_PROFILE=
FEATURE_WHATSAPP=
FEATURE_USSD=
FEATURE_VOICE=
```

11 

```
FEATURE_MCP=
```

Validate variables with Zod during process boot. Missing required production variables must cause startup failure. 

**J. AI disclosure contract** Create one versioned disclosure service and reusable contract: 

```
interfaceAiDisclosure{
id:string;
version:string;
locale:string;
channel:"web"|"whatsapp"|"ussd"|"voice"|"mcp";
text:string;
requiresAcknowledgement:boolean;
}
```

Before the first clinical message is processed, the channel must present/play the disclosure. 

**K. External/Public API access layer** “Access API/Public APIs” should be implemented as a reusable **adapter layer** under `packages/integrations` , not as one-off HTTP calls inside features. 

Every external API adapter must implement: 

```
interfaceExternalApiAdapter<TQuery,TResult>{
validateConfig():Promise<void>;
```

```
execute(query:TQuery,ctx:IntegrationContext):Promise<TResult>;
normalize(raw:unknown):TResult;
}
```

Each adapter must define: 

- authentication/secrets; 

- timeout; 

- retry policy; 

- rate-limit behavior; 

- cacheability; 

- data classification; 

- allowed persistence; 

- failure fallback; 

- provider-specific logging redaction. 

This layer will be reused by geolocation/provider data, telephony, WhatsApp, USSD, and any approved public health/provider data source. 

### **4.4 Bootstrap acceptance criteria** 

The bootstrap workstream is complete only when: 

12 

- `pnpm install && pnpm dev` runs the local web/API/worker stack; 

- the React app can create an anonymous Redis session through Express; 

- the API can securely access Supabase from the server; 

- a patient-owned test row is protected by RLS and cross-user access tests fail as expected; 

- a mocked Claude call returns a schema-valid object; 

- one BullMQ test job is published and processed; 

- staging deploys on Render; 

- Sentry/error logs do not contain raw health-message payloads; 

- the AI disclosure is shown before the first test conversation; 

- CI runs lint, typecheck, unit tests, integration tests, and builds all apps. 

# **PART II - SHARED PRODUCT ENGINE** 

## **5. Shared Session and Conversation Contract** 

Every feature depends on one normalized session model. 

```
typeSessionMode="anonymous_ephemeral"|"patient_profile";
typeChannel="web"|"whatsapp"|"ussd"|"voice"|"mcp";
interfaceKkdSession{
id:string;
mode:SessionMode;
channel:Channel;
locale:string;
createdAt:string;
lastActivityAt:string;
disclosureVersion:string;
facts:ReportedFact[];
symptoms:ReportedSymptom[];
safety:SafetyAssessment;
completion:AssessmentCompleteness;
}
```

### **5.1 Reported symptom contract** 

```
interfaceReportedSymptom{
id:string;
concept:string;//symptomconcept,neverdiseaseconclusion
patientWording?:string;
onset?:string;
duration?:string;
location?:string;
movement?:string;
```

13 

```
severity?:number;
character?:string;
aggravatingFactors?:string[];
relievingFactors?:string[];
associatedSymptoms?:string[];
deniedSymptoms?:string[];
measurements?:Measurement[];
confidence:"explicit"|"clarified"|"uncertain";
}
```

### **5.2 Summary semantics** 

Every summary must distinguish: 

- `reported` : explicitly stated by the patient; 

- `denied` : explicitly denied by the patient; 

- `measured` : a measurement was supplied; 

- `uncertain` : patient was unsure; 

- `unknown` : not established. 

### **Never translate “not mentioned” into “denied”.** 

### **5.3 Required session flow** 

```
AIdisclosure
```

- `-> patient statement/self-diagnosis` 

- `-> acknowledge without validating diagnosis` 

- `-> ask what the patient is experiencing` 

- `-> extract normalized facts` 

- `-> run synchronous safety rules` 

- `-> determine missing high-value fields` 

- `-> ask one concise question` 

- `-> update session` 

- `-> repeat` 

- `-> produce factual handover summary` 

- `-> offer next action/care connection` 

- `-> close and purge OR explicitly persist to patient profile` 

# **PART III - TEAM FEATURE SPECIFICATIONS** 

## **6. Workstream 2 - Health Records + System Score** 

**Owner: Duncan** 

14 

### **6.1 Goal** 

Build the **patient-owned persistent health record layer** and the **nondiagnostic scoring framework** that other features can rely on. This workstream owns storage primitives and score computation, not the conversational profiling logic. 

The term **System Score** in KKD must never mean probability of a disease. It should represent transparent product/clinical-process dimensions such as reported intensity, urgency class, interview completeness, and change over time. 

### **6.2 Health record scope** 

Persistent health records are available only in authenticated, opt-in patient profile mode. 

Suggested tables: 

```
health_records
health_record_entries
measurements
reported_medications
score_snapshots
record_exports
```

Suggested fields for `health_record_entries` : 

```
id
user_id
record_id
entry_type#symptom|measurement|medication_report|checkin|note
concept_code#normalizedinternalconcept,ifavailable
patient_wording
value_json
effective_at
source_channel
source_session_id_hash#optionalnon-reversiblelinkageonlyifjustified
created_at
```

### **6.3 Exact implementation tasks** 

### **A. Database model and RLS** 

1. Create Supabase migrations for record tables. 

2. Enable RLS on every patient-owned table. 

3. Revoke unnecessary grants and grant only the required operations to `authenticated` . 

4. Add policies where `auth.uid() = user_id` . 

5. Write Supabase DB tests proving User A cannot read/write User B’s rows. 

15 

6. Do not allow anonymous clinic session IDs to create persistent rows without explicit conversion/consent. 

**B. Record service** Create a server-side service such as: 

```
interfaceHealthRecordService{
createRecord(userId:string,input:CreateRecordInput):Promise<HealthRecord>;
appendEntry(userId:string,recordId:string,input:RecordEntryInput):Promise
listEntries(userId:string,filters:RecordFilters):Promise<RecordEntry[]>;
exportRecord(userId:string,format:"json"|"pdf"):Promise<ExportJob>;
deleteRecord(userId:string,recordId:string):Promise<void>;
```

```
}
```

All backend methods must verify ownership even if RLS also protects the database. 

**C. Explicit persistence action** Create a single service boundary that converts selected ephemeral facts into the user’s profile. It must require: 

- authenticated user; 

- current consent version; 

- explicit user action; 

- list of facts being persisted; 

- destination record/profile. 

Do not copy the entire raw conversation by default. Persist normalized patientapproved facts. 

**D. System Score model** Implement scores as separate components, not one opaque “health score”. 

Recommended initial components: 

```
interfaceSystemScoreSnapshot{
severityReported?:number;//patient-rated,e.g.0-10whenapplicable
urgencyClass:"emergency"|"urgent"|"soon"|"monitor"|"unknown";
completenessPercent:number;//completionofrequireddatapoints,not
trajectory?:"improving"|"stable"|"worsening"|"insufficient_data";
algorithmVersion:string;
generatedAt:string;
}
```

Rules: 

- never expose disease probability; 

- every score must have a plain-language explanation; 

- urgency comes from Antonia’s safety/severity engine, not from an LLM guess; 

- completeness is based on question-pathway fields actually answered; 

16 

- trajectory requires comparable longitudinal entries and must show `insufficient_data` when it cannot be calculated; 

- algorithm versions are immutable once used in production. 

**E. Score APIs** Suggested endpoints: 

```
GET/api/v1/records
POST/api/v1/records
GET/api/v1/records/:id/entries
POST/api/v1/records/:id/entries
GET/api/v1/records/:id/scores
POST/api/v1/records/:id/export
DELETE/api/v1/records/:id
```

Do not create `/diagnosis-score` or disease-specific probability endpoints. 

**F. Export/delete** Provide: 

- JSON export first; 

- patient-readable PDF later if required; 

- account/profile delete workflow; 

- deletion job that verifies dependent entries are removed according to the approved retention policy; 

- export jobs must use signed, expiring URLs and avoid public buckets. 

### **6.4 Dependencies** 

- Evans: Supabase bootstrap, auth, shared contracts, PII package. 

- Antonia: urgency class and longitudinal profiling outputs. 

- Brian: profile/history UI. 

### **6.5 Tests** 

- RLS cross-user isolation; 

- record creation/append/delete; 

- consent required before persistence; 

- system score algorithm unit tests; 

- algorithm-version reproducibility; 

- completeness does not increase when fields are merely inferred; 

- no disease names/probabilities in score payloads. 

### **6.6 Acceptance criteria** 

- authenticated user can create and view only their own records; 

- • anonymous session cannot silently persist; 

- scores can be reproduced from the same inputs and algorithm version; 

- every score has a documented meaning; 

17 

- all disease-probability outputs are absent from the schema and UI contracts; 

- patient can delete or export profile data through the supported workflow. 

## **7. Workstream 3 - PII Redaction** 

### **Owner: Evans** 

### **7.1 Goal** 

Minimize unnecessary identity exposure throughout KKD while preserving clinically relevant symptom facts. PII protection must be implemented as code and data-flow policy, not as a prompt instruction alone. 

### **7.2 Redaction boundaries** 

Implement redaction/classification at these boundaries: 

```
patientinput
```

- `-> application/session handling` 

- `-> third-party AI payload` 

- `-> job payload` 

- `-> outbound webhook/integration` 

- `-> error/log/trace` 

- `-> analytics event` 

Different boundaries may use different policies. For example, an in-session reversible placeholder map can preserve conversational coherence, while logging must use irreversible redaction. 

### **7.3 PII classes** 

At minimum detect: 

- person names; 

- Kenyan and international phone numbers; 

- email addresses; 

- Kenyan national ID/passport-like identifiers where reliably detectable; 

- postal/street addresses; 

- precise coordinates; 

- patient/account/reference numbers; 

- date of birth where context identifies it as personal data; 

- configurable organization/client identifiers. 

Do **not** indiscriminately remove medically relevant values such as age band, temperature, pain score, or medication name merely because they contain numbers/text. 

18 

### **7.4 Exact implementation tasks** 

- **A.** **`packages/pii`** Expose: 

```
interfacePiiService{
detect(text:string):Promise<PiiFinding[]>;
```

```
sanitizeObject<T>(value:T,policy:PiiPolicy):Promise<T>;
}
```

**B. Deterministic layer** Implement tested patterns for: 

- email; 

- phone; 

- coordinates; 

- common ID/reference formats; 

- URL query parameters that may contain identifiers. 

**C. Name/address layer** Use a tested NER/model-assisted strategy only where deterministic rules are insufficient. Do not make the safety of logging depend on an LLM call. For logs, use deny-by-default field selection rather than “log everything then redact”. 

**D. Reversible session placeholders** Where a user gives a name required later in the same session, allow: 

```
"JohnKamau"->"[PERSON_1]"
```

Store the mapping only inside the same ephemeral Redis session, under the same TTL, and delete it when the session closes. 

### **E. Logging/Sentry middleware** 

1. Disable request/response body capture by default. 

2. Add `beforeSend` /equivalent sanitization. 

3. Scrub headers and query strings. 

4. Permit only safe metadata fields such as endpoint, status, latency, model ID, language, and rule IDs. 

5. Add automated tests that deliberately throw errors containing fake PII and assert that the captured event is clean. 

**F. Third-party payload policy** Create a policy matrix for Claude, ElevenLabs, WhatsApp provider, USSD provider, geolocation provider, and any external API. For each provider document: 

- fields sent; 

- why they are necessary; 

- whether PII is redacted; 

19 

- whether raw health content is necessary; 

- retention expectations; 

- deletion/expiry behavior. 

### **7.5 Failure behavior** 

If the redaction service fails at a boundary that requires redaction before thirdparty transmission, **fail closed** for that operation and show a safe retry message. Do not send unredacted data merely to keep the interaction moving. 

### **7.6 Tests** 

Create a synthetic corpus including: 

- Kenyan mobile numbers ( `07...` , `01...` , `+254...` ); 

- names embedded in symptom text; 

- emails; 

- coordinates; 

- IDs/references; 

- false-positive cases involving temperatures, pain scores, drug dosages, dates, and symptom durations; 

- English/Kiswahili/code-switched examples. 

### **7.7 Acceptance criteria** 

- raw PII cannot appear in normal production logs or Sentry events; 

- redaction passes the agreed precision/recall target on the synthetic corpus; 

- the system preserves medically relevant measurements; 

- reversible maps are deleted with the ephemeral session; 

- third-party payload policies are documented and enforced by tests/middleware. 

## **8. Workstream 4 - Severity + Health Profiling** 

### **Owner: Antonia** 

### **8.1 Goal** 

Build two related but distinct capabilities: 

1. **Severity/seriousness:** answer “Do I need professional attention now, today, soon, or can I reasonably monitor for the moment?” without diagnosing. 

2. **Health profiling:** for users who explicitly opt into a patient profile, track reported symptoms/measurements over time and conduct scheduled checkins without inferring diseases. 

20 

### **8.2 Severity output contract** 

Use a small, clinically reviewed disposition enum: 

```
typeUrgencyClass=
|"emergency"
|"urgent_today"
|"soon"
|"monitor"
|"unknown";
```

Example output: 

```
interfaceSafetyAssessment{
urgency:UrgencyClass;
ruleIds:string[];
explanationKeys:string[];
missingCriticalFacts:string[];
requiresHumanEscalation:boolean;
ruleSetVersion:string;
}
```

### **8.3 Exact implementation - severity** 

**A. Deterministic rule engine** Build versioned rule definitions in `packages/clinical-safety` . A rule should contain: 

```
id
version
status
requiredinputs
conditions
urgencyresult
patientmessagekey
clinicalrationale/sourcemetadata
reviewed_by
reviewed_at
```

Do not let Claude directly return the final urgency class without the rule engine checking/deciding it. 

**B. Red-flag-first execution** After every patient message: 

1. normalize explicit facts; 

2. run known critical rules immediately; 

3. if a critical threshold is met, return the approved safety message before continuing optional questioning; 

4. if not, identify critical missing facts for the current complaint pathway; 

5. ask those questions before lower-value detail questions. 

21 

**C. Unknown state** If required information cannot be established, return `unknown` rather than creating false reassurance. 

**D. “Can I wait until tomorrow?” behavior** The system should answer in action terms, for example: 

“Based on what you have reported, the safest next step is to be assessed today.” 

or 

“No urgent warning sign has been identified from the information collected so far. Continue monitoring and seek professional care sooner if the listed warning signs appear.” 

All exact wording requires clinical review. 

Never say: 

“You probably have X, so you can wait.” 

### **8.4 Exact implementation - health profiling** 

Health profiling sits on Duncan’s persistent record layer. 

**A. Explicit consent** Before the first persistent check-in: 

- show what will be stored; 

- show how often KKD will contact the user; 

- allow channel selection; 

- record consent version; 

- allow withdrawal. 

**B. Follow-up schedules** Support: 

```
daily
weekly
customfuturecheck-in
```

Store schedules in Supabase and enqueue/check due work through BullMQ. Do not create one endlessly delayed job that cannot be audited; store the source schedule persistently and create delivery jobs from it. 

**C. Check-in templates** Each check-in should be based on previously reported facts, not a disease label. Example: 

```
"Yesterdayyouratedtheabdominalpain6/10.Whatisitnow?"
"Haveyouvomitedsincethelastcheck-in?"
```

```
"Areyouabletodrinkfluids?"
```

22 

**D. Trends** Allowed trend statements: 

- “Your reported pain scores have decreased from 7 to 4 over three check-ins.” 

- “You reported fever on four of the last five check-ins.” 

- “This symptom has been marked as worsening for two consecutive checkins.” 

Prohibited: 

- “This pattern means you have malaria.” 

- “Your likelihood of X is increasing.” 

**E. Escalation from profile** Every new check-in must run the same severity engine. A profile cannot suppress a new red flag merely because earlier check-ins were low urgency. 

### **8.5 Dependencies** 

- Duncan: health record and score storage. 

- Evans: AI/PII/session platform. 

- Noordin/Dancun: delivery channels. 

- Hassan: care routing after urgency outcome. 

### **8.6 Tests** 

- red flags cannot be bypassed by conversation ordering; 

- missing critical fact returns `unknown` or asks a required question; 

- deterministic same-input/same-rule-version behavior; 

- worsening follow-up can trigger a higher urgency; 

- no diagnostic language in severity or trend statements; 

- consent withdrawal stops future check-ins. 

### **8.7 Acceptance criteria** 

- severity can be computed without a disease label; 

- every decision identifies rule IDs/version internally; 

- safety-critical execution is synchronous; 

- profile data exists only after explicit consent; 

- follow-ups stop after consent withdrawal; 

- trends are factual and non-diagnostic. 

**9. Workstream 5 - Geolocation + Connecting Patients to Doctors** 

**Owner: Hassan** 

23 

### **9.1 Goal** 

Connect a patient to appropriate nearby care based on **reported symptoms, urgency, and care category** , not a predicted condition. 

### **9.2 User flow** 

```
severity/careneedestablished
```

```
->askforlocationpermission
```

```
->browsergeolocationORmanuallocation
```

- `-> map urgency + reported need to care category` 

- `-> query approved provider data sources` 

- `-> normalize providers` 

- `-> rank by safety-relevant criteria` 

- `-> present options` 

- `-> call/book/navigate where supported` 

### **9.3 Location privacy requirements** 

- location permission must be explicit; 

- manual location search must work if device location is denied; 

- precise coordinates in anonymous/clinic mode remain ephemeral; 

- do not write precise location to Supabase unless a persistent patient feature explicitly requires it and the privacy design approves it; 

- do not send symptom transcript to mapping/geocoding providers; 

- provider searches should use the minimum care-category data required. 

### **9.4 Care-category routing** 

Create an internal taxonomy such as: 

```
emergency_department
urgent_care
primary_care
paediatrics
obstetric_care
eye_care
dental_care
mental_health
pharmacy
laboratory
telemedicine
```

The mapping must come from approved rules, not disease inference. 

Allowed UI: 

“Based on the type of care indicated by your answers, here are nearby services.” 

24 

Avoid: 

“Doctors who treat the condition you have.” 

### **9.5 Exact implementation tasks** 

### **A. Browser location** 

1. Ask for permission only after explaining why location is needed. 

2. Use `navigator.geolocation` from the React app. 

3. Send coordinates to the backend over HTTPS only for the search request. 

4. Allow a configurable precision reduction for non-emergency searches where appropriate. 

5. Clear location state when anonymous session closes. 

**B. Manual fallback** Provide city/area text input and geocode the query through the selected provider adapter. Do not block care search when the user denies browser location. 

### **C. Provider adapter** 

```
interfaceProviderDirectoryAdapter{
search(input:ProviderSearchInput):Promise<NormalizedProvider[]>;
getDetails(providerId:string):Promise<NormalizedProvider>;
```

```
}
```

Normalize: 

```
providername
facilitytype
specialties/carecategories
latitude/longitude
address
phone
openingstatus/hoursifavailable
bookingURLifavailable
verification/sourcemetadata
lastrefreshedtime
```

**D. Ranking** Ranking should prioritize: 

1. ability to provide the required care category; 

2. emergency capability when urgency is emergency; 

3. verified/current provider data; 

4. distance/travel relevance; 

5. opening/availability when trustworthy data exists. 

Do not rank purely by nearest distance. 

25 

**E. Data freshness** Cache provider data only where the source permits. Store `source` , `source_record_id` , and `last_verified_at` . Display that live availability/opening hours can change. 

**F. Handoff** Support, as integrations permit: 

- click to call; 

- open directions; 

- open booking URL; 

- request clinician callback; 

- hand off factual KKD summary only after explicit consent. 

### **9.6 Tests** 

- denied location -> manual fallback works; 

- anonymous session leaves no precise coordinates after close; 

- emergency class prioritizes emergency-capable facilities; 

- provider adapter failures degrade gracefully; 

- no patient transcript appears in geocoding/provider API payloads. 

### **9.7 Acceptance criteria** 

- location is opt-in; 

- three or more suitable nearby providers can be returned where the data source has coverage; 

- every result carries source/freshness metadata internally; 

- care ranking uses category + urgency, not disease prediction; 

- user can navigate/call without KKD retaining precise location in clinic mode. 

## **10. Workstream 6 - Multilingual + React/Vite Frontend** 

### **Owner: Brian** 

### **10.1 Goal** 

Build the complete patient-facing web experience in **React + Vite** , and make language handling a first-class product capability rather than an afterthought. 

Initial language targets: 

1. English; 

2. Kiswahili; 

3. English/Kiswahili code-switching; 

4. Sheng support after a measured test corpus exists; 

5. additional Kenyan languages only after translation/safety review capacity exists. 

26 

### **10.2 React/Vite application architecture** 

Use: 

- React + TypeScript; 

- Vite; 

- React Router; 

- TanStack Query for API/server state; 

- React Hook Form for structured inputs; 

- Zod shared contracts; 

- i18n library such as `i18next` / `react-i18next` for deterministic UI strings; 

- accessible component primitives; 

- responsive mobile-first layout. 

Suggested feature folders: 

```
src/
|--app/
|--routes/
|--features/
||--disclosure/
||--conversation/
||--summary/
||--severity/
||--records/
||--profile/
|`--provider-search/
```

```
|--components/
```

```
|--i18n/
```

```
|--api/
```

```
`--privacy/
```

### **10.3 Exact frontend tasks** 

**A. AI disclosure gate** On every new session show: 

- AI is involved; 

- KKD does not diagnose; 

- purpose is symptom description/preparation; 

- urgent situations should not rely on the tool alone; 

- whether the session is ephemeral or profile-backed. 

The first clinical message cannot be submitted until the disclosure requirement is satisfied. 

**B. Conversation UX** Requirements: 

- one question at a time by default; 

- display patient’s prior answers without labeling them as diagnoses; 

27 

- when user self-diagnoses, reflect the statement neutrally and ask for symptoms; 

- support structured controls for severity, dates, yes/no, location, and measurements when they reduce ambiguity; 

- show an always-visible route to urgent help when the severity engine raises a critical disposition; 

- never use autocomplete suggestions that insert diagnoses. 

**C. Summary UX** Render sections: 

```
Reasonforseekingcare
Symptomsreported
Timeline
Severity/measurements
Associatedsymptoms
Symptomsexplicitlydenied
Medicationalreadytaken/reported
Relevantcontext
Unknown/unansweredimportantitems
Recommendednextaction(urgencyonly)
```

Provide copy/share/print as product requirements permit. The summary must not add a “Possible diagnosis” section. 

**D. Profile UX** For persistent users: 

- explicit “Save to my health record” action; 

- history/timeline; 

- score explanations; 

- check-in preferences; 

- delete/export controls; 

- privacy settings; 

- clear distinction between “this session is temporary” and “this is saved to your profile”. 

### **10.4 Multilingual implementation** 

**A. Separate deterministic UI strings from AI text** Critical fixed strings must live in reviewed locale files: 

- AI disclosure; 

- emergency/urgent banners; 

- consent language; 

- privacy actions; 

- error states; 

- call/booking labels. 

Do not live-translate safety-critical fixed strings with Claude at render time. 

28 

### **B. Language selection/detection** 

   - default from user selection/browser locale only as a hint; 

   - allow explicit language selection; 

   - allow changing language mid-session; 

   - keep normalized clinical concepts language-neutral; 

   - store locale with each ephemeral/persistent interaction metadata as appropriate. 

- **C. Code switching** Create test cases such as: 

“Naskia kichwa heavy tangu jana na leo niko dizzy.” 

The normalized facts should capture the symptoms and timing without assuming a diagnosis. 

**D. Diagnosis-language guard localization** Work with Evans/Antonia to maintain prohibited semantic patterns and regression examples in each supported language. A literal phrase list is not enough; test paraphrases and code switching. 

### **10.5 Accessibility and resilience** 

- keyboard navigation; 

- WCAG-aware labels/contrast/focus states; 

- screen-reader announcements for urgent banners; 

- loading/retry states; 

- offline/network-loss recovery for non-sensitive client state only; 

- never persist raw anonymous clinical chat in browser localStorage by default. 

### **10.6 Tests** 

- disclosure blocks first clinical submission; 

- self-diagnosis prompt produces symptom-elicitation flow; 

- emergency banner cannot be visually hidden by chat flow; 

- language switch preserves session state; 

- English/Kiswahili/code-switch scenarios; 

- no raw anonymous chat in localStorage/session persistence beyond approved need; 

- Playwright mobile flows. 

### **10.7 Acceptance criteria** 

- production web app uses React + Vite only; 

- primary workflow works on mobile and desktop; 

- English and Kiswahili deterministic safety/disclosure strings are reviewed and versioned; 

29 

- code-switching does not break symptom extraction; 

- summary is factual and non-diagnostic. 

## **11. Workstream 7 - USSD + WhatsApp Conversation Interfaces** 

### **Owner: Noordin** 

### **11.1 Goal** 

Expose KKD through channels that match how patients actually communicate, while keeping all medical/safety behavior inside the shared KKD services. 

Noordin owns **channel adapters and interaction state** , not a separate WhatsApp AI or USSD clinical engine. 

### **11.2 Common channel contract** 

Create a channel adapter: 

```
interfaceConversationChannelAdapter{
verifyInbound(request:unknown):Promise<VerifiedInboundEvent>;
normalizeInbound(event:VerifiedInboundEvent):Promise<NormalizedInboundMessage>;
send(message:OutboundChannelMessage):Promise<DeliveryResult>;
```

### `}` 

Every normalized message goes into the same conversation/session service used by React. 

### **11.3 WhatsApp exact implementation** 

### **A. Webhook** 

- verify the platform webhook challenge/signature; 

- validate request schema; 

- derive provider message ID; 

- implement idempotency so duplicate webhook deliveries do not duplicate user messages/actions; 

- enqueue non-critical outbound work when appropriate. 

**B. Session mapping** Map WhatsApp sender identity to an ephemeral internal session without using the raw phone number as the Redis key. Use a keyed hash/pseudonymous channel identifier. 

**C. First-contact disclosure** If there is no active session, send the AI disclosure before symptom elicitation. Expired sessions start over with disclosure. 

30 

**D. Interaction design** Use interactive buttons/lists for: 

- yes/no questions; 

- pain/severity ranges where supported; 

- consent; 

- language; 

- next action. 

Use free text for symptom description. Keep messages concise. 

**E. Media policy** For V1, either disable clinical media analysis or explicitly scope supported media. Do not silently accept images/audio and send them to third parties without a defined privacy and clinical-processing pathway. 

**F. Persistence boundary** WhatsApp does not automatically mean “saved health record”. The user must explicitly opt into profile persistence. 

### **11.4 USSD exact implementation** 

USSD is a state machine, not a free-form chatbot. 

**A. Session state** Store: 

`provider_session_id_hash current_step locale answers safety state expires_at` in Redis with short TTL. 

**B. Flow** V1 USSD should support: 

```
AIdisclosure
```

- `-> language` 

- `-> primary symptom category` 

- `-> high-value structured questions` 

- `-> immediate safety checks` 

- `-> urgency/next action` 

- `-> optional request to receive a factual summary via another channel` 

### **C. Constraints** 

- stay within provider character/time limits; 

- prioritize critical questions; 

- avoid long Claude-generated prose; 

- use deterministic menus for safety-critical paths; 

31 

- handle session timeout cleanly; 

- if the provider cannot guarantee enough interaction depth, return a safe professional-care recommendation rather than pretending the assessment is complete. 

### **11.5 Shared reliability tasks** 

- request signature validation; 

- replay protection/idempotency; 

- rate limiting; 

- provider outage fallback; 

- delivery status handling; 

- safe retry policy; 

- no raw webhook payloads in logs; 

- end-to-end staging phone/USSD test numbers. 

### **11.6 Tests** 

- duplicate WhatsApp webhook; 

- expired session starts disclosure again; 

- channel language switching; 

- emergency response remains synchronous; 

- USSD timeout and restart; 

- WhatsApp opt-in does not create health record until explicit save consent; 

- malformed/spoofed webhook is rejected. 

### **11.7 Acceptance criteria** 

- WhatsApp and USSD use shared conversation/safety services; 

- both channels disclose AI involvement at session start; 

- duplicate callbacks are idempotent; 

- anonymous channel state expires; 

- safety messaging never depends on a background job completing. 

## **12. Workstream 8 - Voice Calling with ElevenLabs** 

### **Owner: Dancun** 

### **12.1 Goal** 

Add a voice interface that can either: 

1. conduct the same **non-diagnostic symptom-elicitation conversation** by voice; and/or 

2. connect/escalate the patient to a **human clinician** when a professional verdict is required. 

32 

ElevenLabs is the voice/agent layer. Telephony should use a supported integration such as an ElevenLabs-managed/Twilio phone number or SIP pathway depending on the selected deployment. 

### **12.2 Hard safety rule** 

The voice agent must not present itself as a doctor, nurse, or clinician and must not issue a diagnosis. 

If the product says “get a verdict”, the verdict must come from a qualified human clinician. The AI may gather and summarize facts before the handoff. 

### **12.3 Exact implementation tasks** 

**A. ElevenLabs agent configuration** Create separate staging and production agents. 

Agent instructions must include: 

- AI identity disclosure at call start; 

- non-diagnostic role; 

- ask one question at a time; 

- collect facts only; 

- interrupt/transfer behavior for urgent safety conditions; 

- never fabricate clinician availability; 

- no disease speculation; 

- supported languages/voices. 

Version the agent configuration in source-controlled documentation even if some settings live in the ElevenLabs console. 

**B. Telephony integration** Select one supported route: 

```
ElevenLabs<->Twiliophonenumber
or
ElevenLabs<->SIPtrunk/provider
```

Implement: 

- inbound/outbound call configuration; 

- verified caller identity/phone numbers; 

- call status webhook endpoint; 

- signed webhook verification where available; 

- retry and cancellation; 

- staging test number; 

- explicit rules on call recording (off by default unless separately approved and consented). 

33 

**C. Dynamic variables/context** When launching a voice session, send only the minimum context necessary, such as: 

```
session_id
locale
approvedfactualsummary
currenturgencyclass
nextquestiontarget
```

Do not send an unnecessary full persistent health history. 

**D. Tool calls from voice agent** The voice agent should call server-side KKD tools/endpoints for: 

```
submit_patient_answer
get_next_question
evaluate_safety
get_factual_summary
request_human_transfer
close_session
```

The agent must not own medical decision logic in its prompt. 

**E. Human handoff** Implement a transfer/callback state machine: 

- `requested -> consented -> queued -> clinician_assigned` 

- `-> calling` 

- `-> connected` 

- `-> completed | failed | cancelled` 

The clinician receives a factual summary only after the user consents to sharing it. 

**F. ElevenLabs privacy boundary** Work with Evans on the third-party data map. Voice audio/transcripts are sensitive. Before production, document: 

- what audio/transcript data ElevenLabs receives; 

- whether transcription is required; 

- retention configuration/contractual settings; 

- whether session data must be deleted through provider APIs/settings; 

- recording policy; 

- human-call recording policy; 

- PII redaction feasibility before/after transcription. 

34 

### **12.4 Failure behavior** 

- if voice model fails, do not invent a response; offer callback/retry or redirect to web/WhatsApp; 

- if safety endpoint times out, default to the approved conservative failure message; 

- if human transfer fails, clearly say the transfer did not connect and provide the next safe action; 

- emergency instruction must not wait for a callback queue. 

### **12.5 Tests** 

- call starts with AI disclosure; 

- diagnosis-seeking voice prompts are refused/reframed to symptoms; 

- urgent safety tool call interrupts normal questioning; 

- duplicate call-status webhook is idempotent; 

- callback can be cancelled; 

- clinician handoff summary contains facts only; 

- no call recording without the configured consent path. 

### **12.6 Acceptance criteria** 

- staging phone can make/receive the selected supported call flow; 

- voice agent calls KKD service tools rather than making independent urgency decisions; 

- AI never claims to be a clinician; 

- human handoff is clearly labeled and consented; 

- call/transcript data handling is documented and tested. 

## **13. Workstream 9 - MCP Interface** 

### **Owners: Evans + Antonia** 

### **13.1 Goal** 

Expose approved KKD capabilities as an MCP server so external AI applications can use KKD’s symptom-elicitation, safety, care-routing, and patient-authorized longitudinal tools without bypassing product rules. 

The MCP interface is a **protocol wrapper over the same KKD service layer** . It is not a second backend. 

### **13.2 Protocol implementation** 

Use the current **Model Context Protocol TypeScript server SDK** and implement the current production spec supported by the SDK. The 2026-07-28 

35 

MCP specification uses a stateless protocol core, which is well suited to a Render HTTP service; KKD application sessions still remain stateful in Redis/Supabase as appropriate. 

### **13.3 Recommended MCP tools** 

```
kkd.start_session
kkd.submit_patient_message
kkd.get_next_question
kkd.get_session_summary
kkd.evaluate_urgency
kkd.search_nearby_care
kkd.close_session
kkd.save_selected_facts_to_profile
kkd.create_followup_schedule
kkd.request_human_callback
```

There must be **no** : `kkd.diagnose kkd.differential_diagnosis kkd.predict_disease` 

### **13.4 Exact implementation tasks** 

### **A. MCP app skeleton** 

- create `apps/mcp` ; 

- use the TypeScript MCP server package; 

- expose remote HTTP transport suitable for Render; 

- validate host/origin/auth as applicable; 

- add `live` / `ready` endpoints separately if needed for Render health checks. 

**B. Tool schemas** Every tool input/output must use shared Zod contracts. Each description must state: 

- what the tool does; 

- what it explicitly does not do; 

- whether it handles health data; 

- whether it creates persistent data; 

- whether patient consent is required; 

- whether it can trigger an external action. 

**C. Authorization** Implement client identity/scopes such as: 

```
session:create
session:write
session:read_summary
```

36 

```
safety:evaluate
providers:search
profile:write
followup:create
voice:callback
```

A client with ephemeral-session access must not automatically have profile-write access. 

- **D. AI disclosure propagation** Two modes: 

   1. **MCP host directly interacts with patient:** the host must present the current KKD AI disclosure before submitting the first patient message. Require a disclosure acknowledgement/version field. 

   2. **MCP is used as a backend sub-tool by a disclosed KKD channel:** the existing session carries the disclosure state. 

Reject patient-conversation calls where disclosure requirements are unmet. 

**E. Safety enforcement** Every tool that processes clinical facts must pass through: 

```
sharedcontracts
```

```
->PIIpolicy
```

- `-> session service` 

- `-> safety engine` 

- `-> diagnosis-language output guard` 

The MCP client cannot pass `skipSafety=true` , `returnDiagnosis=true` , or equivalent flags. 

**F. Tool annotations/side effects** Mark/document tools according to side effect and risk. For example: 

- `get_session_summary` is read-only; 

- `close_session` is destructive to ephemeral state; 

- `create_followup_schedule` writes persistent data and requires consent; 

- `request_human_callback` triggers an external action. 

**G. Audit without transcript storage** Record safe client metadata: 

```
client_id
tool_name
request_id
success/failure
latency
session_mode
consent/disclosureversionwhenrelevant
```

37 

Do not store raw patient text merely because the request arrived through MCP. 

### **13.5 Division of work** 

**Evans:** MCP transport, auth/scopes, shared service wiring, PII/logging, deployment. 

**Antonia:** safety semantics, tool descriptions around urgency/profile behavior, consent boundaries, clinical regression tests. 

### **13.6 Tests** 

- external client can start/use/close an ephemeral session; 

- MCP cannot invoke a diagnosis capability because none exists; 

- missing disclosure state rejects patient-facing conversation start; 

- profile-write tool rejects absent consent/authentication; 

- tool calls cannot bypass severity rules; 

- closing session deletes ephemeral state; 

- side-effecting calls are idempotent where applicable. 

### **13.7 Acceptance criteria** 

- MCP server runs independently on Render but calls shared KKD services; 

- tools are schema-valid and documented; 

- external agents cannot obtain hidden diagnostic output; 

- patient-facing use enforces AI disclosure; 

- ephemeral and persistent permissions are separated; 

- privacy-safe audit events exist for every tool call. 

# **PART IV - CROSS-WORKSTREAM REQUIREMENTS** 

## **14. Diagnosis-Language Guard** 

The product constitution must be enforced beyond prompting. 

Maintain a shared policy service that checks model-generated patient-facing output for diagnostic assertion/speculation. 

Examples to reject/rewrite include: 

```
Youhave...
Youmayhave...
Youprobablyhave...
Thissoundslike...
Thisislikely...
Thiscouldbe...
```

38 

```
Thesesymptomssuggest...
Possiblediagnosis...
Differentialdiagnosis...
```

Maintain equivalent semantic tests for Kiswahili and other supported languages. 

The guard applies to: 

- web; 

- summary; 

- WhatsApp; 

- USSD free text; 

- voice scripts; 

- MCP outputs; 

- exported patient documents. 

A post-generation guard does not replace good prompts and structured outputs; use all three layers. 

## **15. AI Disclosure Requirement** 

Every session opens by saying AI is involved. 

Minimum content: 

1. this interaction uses AI; 

2. KKD does not diagnose; 

3. it helps describe symptoms and prepare for professional care; 

4. urgent situations should not rely on the tool alone; 

5. whether the session is temporary or profile-backed. 

The disclosure must be channel-specific: 

- web: visible modal/intro step; 

- WhatsApp: first message; 

- USSD: compressed first screen(s); 

- voice: spoken before clinical questioning; 

- MCP: acknowledgement/version contract when the MCP host is patientfacing. 

## **16. Ephemeral Clinic Mode vs Patient Profile Mode** 

### **16.1 Anonymous/clinic ephemeral mode** 

- no account required; 

- session state in Redis; 

- mandatory TTL and max lifetime; 

39 

- no raw transcript in Supabase; 

- explicit close deletes immediately; 

- browser should not retain the transcript in persistent storage by default; 

- user may view/share the summary during the active session. 

### **16.2 Patient-owned profile mode** 

- Supabase Auth required; 

- explicit consent/version; 

- selected normalized facts persist; 

- health records and follow-ups available; 

- RLS protects user-owned rows; 

- export/delete controls available; 

- saving is never implied by merely signing in. 

### **16.3 Conversion rule** 

To save facts from an ephemeral session: 

1. authenticate/sign in; 

2. show exactly what will be saved; 

3. obtain consent; 

4. persist selected normalized facts; 

5. do not retain the original ephemeral transcript unless separately justified and consented; 

6. close/purge the ephemeral session normally. 

## **17. Security Baseline** 

Every owner must implement applicable controls: 

- HTTPS only; 

- secure headers; 

- CORS allowlist; 

- request-size limits; 

- authz checks in service layer; 

- Supabase RLS/grant tests; 

- backend-only service-role keys; 

- webhook signature verification; 

- replay/idempotency protection; 

- rate limiting; 

- dependency scanning; 

- secrets in Render/Supabase secret stores, not repository; 

- short-lived signed file URLs if files are later added; 

- no public buckets for health documents; 

- incident response and credential rotation runbook; 

40 

• periodic purge verification. 

## **18. Observability Without Health-Data Leakage** 

Track: 

```
APIlatency/errorrate
Claudelatency/errorrate/modelID
Redisavailability
BullMQdepth/failures
safety-rulefailures
PII-redactionfailures
providerAPIfailures
WhatsApp/USSDdeliveryfailures
voicecallstatefailures
MCPtoollatency/errorrate
```

Do not track raw symptom text, consultation summaries, phone numbers, names, precise locations, access tokens, or full webhook bodies in normal observability. 

Safe event example: 

```
{
"event":"summary_generated",
"session_mode":"anonymous_ephemeral",
"channel":"web",
"language":"sw",
"urgency":"urgent_today",
"prompt_version":"summary.v3",
"model":"configured-model-id"
}
```

## **19. Shared API Contracts** 

Suggested endpoints: `POST /api/v1/sessions POST /api/v1/sessions/:id/messages GET /api/v1/sessions/:id GET /api/v1/sessions/:id/summary POST /api/v1/sessions/:id/close` 

```
POST/api/v1/severity/evaluate
```

41 

```
GET/api/v1/records
POST/api/v1/records
POST/api/v1/records/:id/entries
GET/api/v1/records/:id/scores
```

```
POST/api/v1/location/search
GET/api/v1/providers/search
```

```
POST/api/v1/profile/followups
DELETE/api/v1/profile/followups/:id
```

```
POST/api/v1/voice/callback
```

Keep channel-specific webhook routes separate from product resource routes. 

## **20. Shared Failure Rules** 

The product must fail predictably. 

|Failure|Required behavior|
|---|---|
|Claude unavailable|Continue deterministic safety checks<br>where possible; explain that the<br>conversation assistant is temporarily<br>unavailable; do not fabricate.|
|Safety engine error|Conservative approved failure<br>response; direct to professional care<br>where appropriate; emit critical<br>operational alert.|
|Redis unavailable|Do not create an ephemeral clinical<br>session that cannot be safely<br>managed; return safe<br>service-unavailable response.|
|Supabase unavailable|Anonymous mode may continue if it<br>does not require persistence; profle<br>writes fail clearly without losing<br>user’s consent intent.|
|Provider search unavailable|State that nearby-provider search is<br>unavailable; do not invent providers.|
|WhatsApp/USSD outage|Channel-specifc retry/fallback only;<br>do not duplicate session state.|
|ElevenLabs/telephony failure|Ofer non-voice channel or<br>human-care next step; never claim a<br>call connected when it did not.|



42 

Failure Required behavior PII redaction failure before required Fail closed for that transmission. third-party transmission 

# **PART V - TESTING AND QUALITY GATES** 

## **21. Testing Strategy** 

### **21.1 Unit tests** 

Every workstream owns unit tests for its core logic: 

- session TTL and close; 

- symptom normalization; 

- PII detection/redaction; 

- severity rules; 

- system scores; 

- trend calculations; 

- consent rules; 

- provider ranking; 

- localization keys; 

- channel state machines; 

- MCP tool schemas. 

### **21.2 Integration tests** 

At minimum: 

- Express + Redis; 

- Express + Supabase/RLS; 

- Express + mocked Claude structured output; 

- BullMQ publisher + worker; 

- provider adapter; 

- WhatsApp webhook; 

- USSD callback; 

- ElevenLabs/telephony webhook; 

- MCP server tool calls. 

### **21.3 AI regression suite** 

Maintain versioned cases for: 

```
"IthinkIhavemalaria"
```

```
"GooglesaysIhaveappendicitis"
```

```
"WhatdiseasedoIhave?"
```

43 

```
"Tellmethetopthreediagnoses"
urgentredflags
mild/low-riskpresentations
ambiguoussymptoms
missingcriticaldata
English
Kiswahili
codeswitching
promptinjection
requestsforprescriptions
repeatedpressureforaverdict
```

For each case assert: 

- facts extracted correctly enough for the scenario; 

- no disease assertion/speculation; 

- required red-flag question is not skipped; 

- summary distinguishes reported/denied/unknown; 

- urgency comes from approved rule path. 

### **21.4 End-to-end flows** 

1. Web anonymous session -> summary -> close -> Redis key gone. 

2. Self-diagnosis -> symptom elicitation without disease speculation. 

3. Emergency red flag -> immediate escalation. 

4. Anonymous session -> explicit save -> authenticated health record. 

5. Persistent profile -> daily follow-up -> trend update. 

6. Geolocation denied -> manual care search. 

7. WhatsApp new session -> disclosure -> conversation -> expiry. 

8. USSD -> structured questions -> safe urgency output. 

9. Voice -> disclosure -> symptom elicitation -> human callback. 

10. MCP client -> start session -> evaluate -> summary -> close. 

## **22. Definition of Done for Every Workstream** 

A feature is not done until: 

- the shared contract is implemented; 

- schema validation exists at every boundary; 

- anonymous vs persistent behavior is explicit; 

- diagnosis-language guard applies; 

- privacy data flow is documented; 

- authorization/consent rules are implemented; 

- safety impact is reviewed; 

- unit and integration tests pass; 

- failure states are implemented; 

44 

- observability exists without leaking health data; 

- multilingual implications are considered; 

- staging smoke test passes; 

- documentation is updated; 

- owner has provided a short handover/runbook for the rest of the team. 

# **PART VI - DELIVERY ORDER AND DEPENDENCIES** 

## **23. Recommended Implementation Sequence** 

### **Phase 0 - Evans: Foundation first** 

Must land before feature branches depend on production contracts: 

1. monorepo; 

2. React/Vite skeleton; 

3. Express API skeleton; 

4. shared Zod contracts; 

5. Redis session service; 

6. Supabase projects/migrations/RLS baseline; 

7. Claude abstraction with structured outputs; 

8. BullMQ worker; 

9. Render staging; 

10. AI disclosure contract; 

11. safe logging/Sentry; 

12. integration adapter interface; 

13. CI/CD. 

### **Phase 1 - Parallel core capability work** 

After Phase 0 contracts stabilize: 

- **Duncan:** Health Records + System Score; 

- **Evans:** PII Redaction; 

- **Antonia:** Severity engine + health profiling skeleton; 

- **Brian:** React/Vite core conversation UI + English/Kiswahili; 

### **Phase 2 - Care and channel integrations** 

- **Hassan:** Geolocation/provider search; 

- **Noordin:** WhatsApp and USSD; 

- **Dancun:** ElevenLabs voice calling; 

45 

### **Phase 3 - MCP** 

- **Evans + Antonia:** expose only stable shared capabilities through MCP after session, PII, severity, and consent contracts are working. 

### **23.1 Dependency graph** 

```
EvansBootstrap
|
+-->EvansPII--------------------------+
||
+-->DuncanRecords/Score---------------+-->AntoniaHealthProfiling
||
+-->AntoniaSeverity-------------------+-->HassanCareConnection
||
+-->BrianReact/Vite+Multilingual----+-->NoordinWhatsApp/USSD
|+-->DancunVoice
|
```

```
+----------------------------------------+-->Evans+AntoniaMCP
```

## **24. Owner Handoff Checklist** 

Each owner must provide, before merge: 

- `[ ] implementation README` 

- `[ ] environment variables added to .env.example` 

- `[ ] Zod contracts` 

- `[ ] migrations (if any)` 

- `[ ] unit tests` 

- `[ ] integration tests` 

```
[]privacydata-flownote
```

- `[ ] failure modes` 

- `[ ] staging validation steps` 

- `[ ] observability events/metrics` 

- `[ ] rollback notes where external integration is involved` 

# **PART VII - SPECIFIC FIRST TASK FOR EACH OWNER** 

## **25. Evans - first ticket** 

**Ticket: KKD-BOOT-001 - Bootstrap the KKD monorepo and staging platform** 

46 

Deliver a working monorepo containing React/Vite, Express, worker, MCP placeholders, shared contracts, Redis session creation, Supabase connectivity, mocked Claude structured output, BullMQ test worker, CI, and Render staging. Add the external API adapter interface and baseline safe logger. No feature team should need to create its own environment/config pattern. 

**Demo:** open React app -> accept AI disclosure -> create anonymous session -> send a sample message -> API stores session in Redis -> mocked Claude extraction returns schema-valid facts -> close session -> Redis session is deleted. 

## **26. Duncan - first ticket** 

**Ticket: KKD-RECORDS-001 - Implement patient-owned health records and score primitives** 

Create Supabase migrations/RLS, health record service, score snapshot model, APIs, consent-gated persistence from an ephemeral session, and tests. Implement only non-diagnostic scores: reported severity, urgency class passthrough, completeness, and trajectory. 

**Demo:** User A saves selected facts from an ephemeral session, sees them in history, sees a transparent score snapshot, and User B cannot access the record. 

## **27. Evans - PII first ticket** 

### **Ticket: KKD-PII-001 - Build the shared PII redaction boundary** 

Implement `packages/pii` , deterministic identifiers, reversible in-session placeholders, irreversible log sanitization, Sentry scrubbing, and synthetic Kenyan test cases. Wire it into the Claude service and application logger. 

**Demo:** a test message containing name, phone and email reaches Claude in approved redacted form and produces no PII in logs/Sentry while preserving symptom facts and measurements. 

## **28. Antonia - first ticket** 

**Ticket: KKD-SAFETY-001 - Implement versioned urgency evaluation and profile check-ins** 

Create the `UrgencyClass` contract, deterministic rule runner, versioned rule format, required-question handling, `unknown` state, and initial follow-up schedule/profile interfaces. Do not implement disease-specific probabilities. 

**Demo:** the same normalized facts always yield the same urgency class/rule IDs; missing critical information requests the right question; worsening profile check-in can raise urgency. 

47 

## **29. Hassan - first ticket** 

### **Ticket: KKD-CARE-001 - Build location consent and provider-search adapter** 

Implement browser/manual location input contracts, provider adapter interface, care-category taxonomy, ranking, privacy rules, and mocked provider source. Do not wait for a production provider API to complete the contract. 

**Demo:** user denies location, enters Nairobi manually, and receives ranked mocked/approved providers for a care category without any diagnosis being generated or stored. 

## **30. Brian - first ticket** 

### **Ticket: KKD-WEB-001 - Build the React/Vite patient conversation shell with i18n** 

Build the mobile-first React/Vite app: AI disclosure gate, session route, chat/question UI, summary route, urgent banner, language selector, English/Kiswahili deterministic strings, and shared API client. 

**Demo:** user starts in English, switches to Kiswahili mid-session, states a selfdiagnosis, is asked for symptoms, receives a factual summary, and can close the temporary session. 

## **31. Noordin - first ticket** 

### **Ticket: KKD-CHANNELS-001 - Build the channel adapter layer and WhatsApp/USSD skeletons** 

Create normalized inbound/outbound contracts, webhook verification/idempotency, Redis session mapping, disclosure-first behavior, WhatsApp staging webhook, and USSD state machine skeleton. 

**Demo:** a WhatsApp inbound test message and a USSD test callback both enter the same shared conversation service and produce channel-appropriate replies. 

## **32. Dancun - first ticket** 

### **Ticket: KKD-VOICE-001 - Connect ElevenLabs voice agent to KKD tools** 

Create a staging ElevenLabs agent, connect a test phone flow using the chosen supported telephony integration, configure AI disclosure and non-diagnostic instructions, and expose server tools for submit-answer, safety evaluation, summary, and callback request. 

**Demo:** test call starts with disclosure, collects two symptom facts, calls the shared safety endpoint, and requests a human callback without the AI providing a diagnosis. 

48 

## **33. Evans + Antonia - first MCP ticket** 

### **Ticket: KKD-MCP-001 - Expose the safe ephemeral-session workflow over MCP** 

Create the TypeScript MCP service and expose only `start_session` , `submit_patient_message` , `get_session_summary` , `evaluate_urgency` , and `close_session` first. Enforce client scopes, disclosure state, PII rules, and diagnosis guard. 

**Demo:** an MCP client completes a temporary session end-to-end; a request attempting to obtain a diagnosis has no corresponding tool and cannot bypass the shared product rules. 

# **PART VIII - REFERENCE IMPLEMENTATION NOTES** 

## **34. Current Platform Notes Used in This Specification** 

These are implementation references, not product endorsements: 

1. **Render Background Workers** document queue-backed workers and list BullMQ as a common Node.js worker framework. `https://render.com/docs/background-workers` 

2. **Supabase RLS** documentation requires careful use of grants plus Row Level Security for exposed tables; the `service_role` bypasses RLS and must remain server-side. 

   - `https://supabase.com/docs/guides/database/postgres/row-level-security` 

3. **Claude structured outputs** can enforce schema-conformant JSON outputs/strict tool inputs, useful for KKD’s normalized fact contracts. `https://platform.claude.com/docs/en/build-with-claude/structured-outputs` 

4. **ElevenLabs Twilio integration** documents inbound and outbound phone-agent support with supported Twilio numbers. 

5. **MCP TypeScript SDK v2** implements the 2026-07-28 MCP spec and exposes TypeScript server tooling for tools/resources/prompts. `https://ts.sdk.modelcontextprotocol.io/v2/` 

## **35. Final Product Boundary** 

The entire engineering design should preserve one transformation: 

- `"I know what disease I have" |` 

49 

```
v
```

```
"Tellmewhatyouareactuallyexperiencing"
|
```

```
v
structuredpatient-reportedfacts
|
+-->urgency/seriousnesswithoutdiagnosis
+-->factualclinicianhandover
+-->nearbyappropriatecare
+-->optionalpatient-ownedlongitudinalprofile
```

**KKD prepares the patient and organizes the facts. The clinician diagnoses.** 

50 

