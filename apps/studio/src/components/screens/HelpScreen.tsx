import type { LucideIcon } from "lucide-react";
import {
  Braces,
  Check,
  Database,
  MemoryStick,
  MessageSquareText,
  PhoneCall,
  Radio,
  UsersRound,
  Wrench,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import type { SectionId } from "../Sidebar";
import { cn } from "../../lib/cn";
import { Badge } from "../ui/Badge";

type HelpTab = "build" | "operate";
type PreviewTone = "neutral" | "blue" | "green" | "amber" | "red" | "purple";

interface GuideStep {
  title: string;
  control: string;
  description: string;
  result: string;
}

interface HelpPreview {
  title: string;
  status: string;
  statusTone: PreviewTone;
  action?: string;
  tabs?: string[];
  activeTab?: string;
  rows: Array<{ label: string; value: string }>;
}

interface HelpTopic {
  section: SectionId;
  title: string;
  description: string;
  icon: LucideIcon;
  prerequisite: string;
  steps: GuideStep[];
  note: string;
  preview: HelpPreview;
}

const buildTopics: HelpTopic[] = [
  {
    section: "builder",
    title: "Agent Builder",
    description:
      "Design the full call flow and decide what the Realtime Agent should say, observe, and do at every stage.",
    icon: Workflow,
    prerequisite:
      "Prepare reusable Data, State, Tools, and Functions first when the flow needs structured assessment logic. A simple conversation flow can be created immediately.",
    steps: [
      {
        title: "Create the Agent",
        control: "Create Agent",
        description: "Enter a recognizable Name and a short Description, then confirm creation.",
        result: "A new Agent card is created and its starter flow opens.",
      },
      {
        title: "Configure the call session",
        control: "Start block",
        description:
          "Select the Start block. Set the model, language, voice, Global Instruction, turn detection, transcription, and the State Schema used by this Agent.",
        result: "These settings initialize one Realtime session when each call begins.",
      },
      {
        title: "Add conversation stages",
        control: "Node / End",
        description:
          "Drag blocks onto the canvas. Use a Node for each conversation stage and an End block for each distinct closing outcome.",
        result: "The flow becomes readable as a sequence of clear stages.",
      },
      {
        title: "Configure a Node",
        control: "Instruction / Response / Tool",
        description:
          "Select a Node and write its instruction. Choose response creation behavior, output modalities, Tool Choice, and the Tools available in that stage.",
        result: "The Agent receives stage-specific instructions and only the Tools selected for that Node.",
      },
      {
        title: "Connect and branch the flow",
        control: "Edge",
        description:
          "Drag from a block handle to another block. Select the Edge and add State conditions, timeout conditions, or a fallback route.",
        result: "The Runtime can move deterministically between Nodes after State changes.",
      },
      {
        title: "Check and publish",
        control: "Validate → Save → Deploy",
        description: "Run Validate, resolve every error, save the current flow, and then deploy it.",
        result: "The saved configuration becomes available for new outbound calls.",
      },
    ],
    note: "Typing @ in supported fields opens Data and State suggestions. Runtime State is referenced as @state.object.field.",
    preview: {
      title: "On Call Agent",
      status: "Saved",
      statusTone: "green",
      action: "Save",
      tabs: ["Base", "Instruction", "Response", "Tool", "Edge"],
      activeTab: "Instruction",
      rows: [
        { label: "Flow", value: "Start  →  AI Consent  →  Check-in  →  End" },
        { label: "Instruction", value: "Ask one clear question and wait for the caller." },
        { label: "Binding", value: "@state.consent.status" },
      ],
    },
  },
  {
    section: "tools",
    title: "Tools",
    description:
      "Define structured observations that GPT Realtime can send to the Runtime, such as consent or an assessment response.",
    icon: Wrench,
    prerequisite:
      "Decide what the model needs to report. A Tool should describe one clear observation and should not contain service-side business logic.",
    steps: [
      {
        title: "Create the Tool",
        control: "Create Tool",
        description: "Enter an English Name and Description. The Tool key is generated for model and Runtime use.",
        result: "A reusable Tool card appears in the workspace.",
      },
      {
        title: "Define runtime inputs",
        control: "Inputs",
        description:
          "Add values that the Node supplies when the Tool is attached, such as an assessment key or current response options.",
        result: "One Tool can be reused with different Node-specific context.",
      },
      {
        title: "Add model parameters",
        control: "Add Parameter",
        description:
          "Define each argument the model must provide. Select its type and mark Required only when the call is invalid without it.",
        result: "A valid GPT Realtime Tool schema is created.",
      },
      {
        title: "Restrict accepted values",
        control: "Add Value",
        description:
          "For string or numeric parameters, add enum values one row at a time. Array parameters use one shared Item Type.",
        result: "The model is guided toward predictable structured values.",
      },
      {
        title: "Save and attach it",
        control: "Save Tool",
        description: "Save the Tool, then select it from the Tool section of the intended Agent Node.",
        result: "GPT Realtime can call the Tool only while that Node is active.",
      },
    ],
    note: "Tool descriptions guide the model. State updates and deterministic calculations belong in a Function connected from the Node.",
    preview: {
      title: "Observe Response",
      status: "2 parameters",
      statusTone: "green",
      action: "Add Parameter",
      tabs: ["Inputs", "Parameters"],
      activeTab: "Parameters",
      rows: [
        { label: "outcome", value: "string · answered / ambiguous_option / off_topic" },
        { label: "response_id", value: "string · required" },
        { label: "candidate_response_ids", value: "array<string>" },
      ],
    },
  },
  {
    section: "functions",
    title: "Functions",
    description:
      "Run deterministic Python or State updates after a Tool call without asking the model to perform business logic.",
    icon: Braces,
    prerequisite:
      "Know which Tool values, Data values, or State values the Function needs and which State fields it should update.",
    steps: [
      {
        title: "Create the Function",
        control: "Create Function",
        description: "Give the Function an English Name and describe the action it performs.",
        result: "A reusable Function definition is created.",
      },
      {
        title: "Declare Inputs",
        control: "Add Input",
        description:
          "Add typed fields to the locked Input Object. These are the only external values available to Code actions.",
        result: "The Function contract clearly shows what must be mapped at runtime.",
      },
      {
        title: "Add deterministic logic",
        control: "Add Action → Code",
        description:
          'Write Python statements directly with inputs["field"]. Return a dictionary when a later State action needs calculated values.',
        result: "Calculated values become available under the action's @output key.",
      },
      {
        title: "Update State",
        control: "Add Action → State",
        description:
          "Add one or more Target, Method, and Value rows. Values can come from @inputs, @output, @state, or @data.",
        result: "All configured State mutations run in the displayed action order.",
      },
      {
        title: "Bind it in a Node",
        control: "Node → Tool → Function",
        description: "In Agent Builder, check a Tool, select this Function, and explicitly map every Function Input.",
        result: "The Function runs after that Tool call with the correct runtime values.",
      },
    ],
    note: "Functions do not keep their own runtime memory. Persist values needed by later responses or Edges in the Agent State.",
    preview: {
      title: "Apply Screening Answer",
      status: "2 actions",
      statusTone: "purple",
      action: "Add Action",
      tabs: ["Inputs", "Actions"],
      activeTab: "Actions",
      rows: [
        { label: "Code", value: 'score = inputs["score"]' },
        { label: "Output key", value: "@output.evaluation" },
        { label: "State", value: "@state.phq_9.score  ·  Set  ·  @output.evaluation.score" },
      ],
    },
  },
  {
    section: "state",
    title: "State",
    description:
      "Define the structured runtime memory that an Agent uses to track consent, progress, scores, and routing values during one call.",
    icon: MemoryStick,
    prerequisite:
      "List the values that must survive across conversation turns. Group related fields into Objects such as consent, screening, or phq_9.",
    steps: [
      {
        title: "Create a schema",
        control: "Create State",
        description: "Enter a unique English Name and Description. A stable key is generated automatically.",
        result: "A reusable State Schema card is created.",
      },
      {
        title: "Open the schema",
        control: "State card",
        description:
          "Select the card to open Custom State and System State. System State is Runtime-managed and read-only.",
        result: "The editable schema workspace opens.",
      },
      {
        title: "Group related values",
        control: "Add Object",
        description: "Create an Object with a unique English Name, such as Consent or PHQ 9.",
        result: "A namespace such as @state.consent is added.",
      },
      {
        title: "Define stored values",
        control: "Add Field",
        description: "Choose a field Name, type, default value, update method, and Read Only behavior.",
        result: "A typed path such as @state.consent.status becomes available.",
      },
      {
        title: "Save and assign it",
        control: "Save State → Start block",
        description: "Save the schema, open the Agent's Start block, and select it in the State section.",
        result: "Every new call receives an isolated instance of this schema.",
      },
    ],
    note: "Rename or delete Objects and Fields carefully because existing Tool, Function, Instruction, and Edge bindings may depend on their paths.",
    preview: {
      title: "On Call State",
      status: "Assigned",
      statusTone: "blue",
      action: "Add Object",
      tabs: ["Custom State", "System State"],
      activeTab: "Custom State",
      rows: [
        { label: "consent", value: "status · string" },
        { label: "screening", value: "active_assessment_key · string" },
        { label: "phq_9", value: "current_item_index · integer  /  score · number" },
      ],
    },
  },
  {
    section: "data",
    title: "Data",
    description:
      "Store reusable JSON resources such as assessment questions, response sets, prompts, and other static reference content.",
    icon: Database,
    prerequisite:
      "Prepare valid JSON with stable keys. Use Data for values that do not change during a call and State for runtime values.",
    steps: [
      {
        title: "Create the resource",
        control: "Add Data",
        description: "Enter a Name and Description, then choose JSON as the Format.",
        result: "A new Data entry is ready for content.",
      },
      {
        title: "Provide JSON content",
        control: "Upload File / Text",
        description: "Upload a JSON file or paste JSON text. Keep uploaded files within the supported 10 MB limit.",
        result: "Studio parses the content and exposes its nested paths.",
      },
      {
        title: "Save the Data",
        control: "Add Data / Save",
        description: "Resolve any JSON formatting error and confirm the editor.",
        result: "The resource appears in the Data list with its description.",
      },
      {
        title: "Insert a reference",
        control: "Type @",
        description:
          "In a supported Instruction or mapping field, type @, choose the Data entry, and continue selecting nested keys or array indexes.",
        result: "A token such as @PHQ-9.items[0].prompt is inserted.",
      },
      {
        title: "Verify the value",
        control: "Hover token",
        description:
          "Hover over the reference token to preview the resolved value before saving the consuming resource.",
        result: "You can confirm the correct path without memorizing the JSON structure.",
      },
    ],
    note: "Changing a JSON key can break existing references. Prefer adding new keys or reviewing every binding after a structural change.",
    preview: {
      title: "PHQ-9",
      status: "JSON",
      statusTone: "blue",
      action: "Add Data",
      rows: [
        { label: "File", value: "phq-9.json" },
        { label: "Question", value: "@PHQ-9.items[0].prompt" },
        { label: "Response set", value: "@PHQ-9.response_sets.frequency.options" },
      ],
    },
  },
];

const operateTopics: HelpTopic[] = [
  {
    section: "deployments",
    title: "Deployments",
    description: "View deployed Agents and start a real outbound call to a saved Contact.",
    icon: PhoneCall,
    prerequisite:
      "Save and validate the Agent, deploy it from Agent Builder, and save Twilio, OpenAI, and Public URL values in Settings.",
    steps: [
      {
        title: "Find the deployed Agent",
        control: "Deployment card",
        description: "Confirm that the intended Agent appears with a Deployed status.",
        result: "The Agent is available to the Runtime for new calls.",
      },
      {
        title: "Open the call form",
        control: "Start Call",
        description: "Select Start Call on that Agent's card. The Agent is already fixed to the selected deployment.",
        result: "A recipient selection form opens.",
      },
      {
        title: "Choose the recipient",
        control: "Contact",
        description: "Search or select a Contact. Confirm the profile image, name, and formatted phone number.",
        result: "The recipient number is taken from the Contact profile.",
      },
      {
        title: "Place the call",
        control: "Start Call",
        description:
          "Confirm the form once. Keep the Runtime and its public HTTPS endpoint available while Twilio connects.",
        result: "Twilio places the call and Studio moves to Call Live.",
      },
    ],
    note: "Settings changes apply to the next call without redeploying the Agent. Flow changes require Save and Update Deployment.",
    preview: {
      title: "On Call Agent",
      status: "Deployed",
      statusTone: "green",
      action: "Start Call",
      rows: [
        { label: "Contact", value: "정석환  ·  010-4871-0779" },
        { label: "From", value: "+1 917 960 7135" },
        { label: "Connection", value: "Twilio Media Streams" },
      ],
    },
  },
  {
    section: "contacts",
    title: "Contacts",
    description: "Manage recipient profiles used by outbound calling and longitudinal reporting.",
    icon: UsersRound,
    prerequisite:
      "Have the recipient's phone number and basic profile information. Add only the information needed for calling and analysis.",
    steps: [
      {
        title: "Add a recipient",
        control: "Add Contact",
        description: "Enter Name, Phone Number, Age, Gender, Email, Details, and an optional profile image.",
        result: "A Contact row is added and becomes selectable from Deployments.",
      },
      {
        title: "Review the profile",
        control: "Contact row",
        description: "Select anywhere on a row to open the detail panel on the right.",
        result: "The profile image and contact details appear without entering edit mode.",
      },
      {
        title: "Update information",
        control: "Edit icon",
        description: "Use the edit icon in the profile panel, change the required fields, and save.",
        result: "Future calls and records use the updated Contact details.",
      },
      {
        title: "Remove a Contact",
        control: "Delete icon",
        description: "Select the delete icon on the row and confirm the deletion dialog.",
        result: "The Contact is removed only after explicit confirmation.",
      },
    ],
    note: "Phone numbers are displayed in a readable local format while outbound calling uses the normalized dialable value.",
    preview: {
      title: "Contacts",
      status: "3 contacts",
      statusTone: "neutral",
      action: "Add Contact",
      rows: [
        { label: "정석환", value: "010-4871-0779  ·  Male  ·  68" },
        { label: "Email", value: "seokhwan.jung@kt.com" },
        { label: "Updated", value: "Today, 3:42 PM" },
      ],
    },
  },
  {
    section: "live",
    title: "Call Live",
    description:
      "Follow the current call status, transcript, and Agent activity while the conversation is in progress.",
    icon: Radio,
    prerequisite:
      "Start an outbound call from Deployments. Call Live is event-driven and does not require manual refresh while Runtime events are connected.",
    steps: [
      {
        title: "Start a call",
        control: "Deployments → Start Call",
        description: "Choose a Contact and place the outbound call.",
        result: "Studio opens Call Live for the new call.",
      },
      {
        title: "Check connection status",
        control: "Status badge",
        description: "Watch the call move through preparing, ringing, and in-progress states.",
        result: "You can distinguish connection delay from an active conversation.",
      },
      {
        title: "Follow the conversation",
        control: "Live transcript",
        description: "Read caller messages, Agent messages, Tool calls, and runtime events in chronological order.",
        result: "The active Agent behavior can be observed without joining the audio.",
      },
      {
        title: "Review the completed call",
        control: "Call Records",
        description:
          "After the call ends, open its finalized record for stored transcript, final State, and review outcome.",
        result: "Operational monitoring continues as a permanent call record.",
      },
    ],
    note: "If no active call exists, the page remains idle. It updates when a call started from Deployments emits lifecycle events.",
    preview: {
      title: "Live Call",
      status: "In progress",
      statusTone: "green",
      tabs: ["Transcript", "Runtime"],
      activeTab: "Transcript",
      rows: [
        { label: "Agent", value: "요즘은 어떻게 지내세요?" },
        { label: "Caller", value: "요즘은 그냥 잘 지내요." },
        { label: "Tool", value: "complete_check_in" },
      ],
    },
  },
  {
    section: "calls",
    title: "Call Records",
    description: "Inspect historical calls and download the exact transcript and final runtime State used for review.",
    icon: MessageSquareText,
    prerequisite:
      "A Runtime call must have reached a stored lifecycle state. Completed, failed, declined, safety, and incomplete calls can all appear here.",
    steps: [
      {
        title: "Locate the call",
        control: "Call row",
        description:
          "Use Contact, Agent, Status, Review, Duration, Turns, Latency, and Started columns to identify a call.",
        result: "The operational outcome is visible before opening details.",
      },
      {
        title: "Open call details",
        control: "Select row",
        description: "Select the row itself. Action icons remain separate so accidental deletion does not occur.",
        result: "The full record and conversation details open.",
      },
      {
        title: "Download the conversation",
        control: "Download Transcript",
        description: "Download the ordered Agent, caller, Tool, and system transcript as JSON.",
        result: "The exact stored conversation can be audited or processed externally.",
      },
      {
        title: "Download final memory",
        control: "Download State",
        description: "Download the State snapshot captured when the call ended.",
        result: "Assessment progress, scores, consent, and routing values are preserved as JSON.",
      },
      {
        title: "Delete a record",
        control: "Delete icon",
        description: "Select the delete icon at the end of the row and confirm the dialog.",
        result: "The call record is removed only after confirmation.",
      },
    ],
    note: "Review values identify safety, declined consent, or incomplete assessment independently from telephony Status.",
    preview: {
      title: "Call Records",
      status: "Completed",
      statusTone: "green",
      rows: [
        { label: "Contact", value: "정석환  ·  010-4871-0779" },
        { label: "Call", value: "On Call Agent  ·  08:42  ·  18 turns" },
        { label: "Downloads", value: "Transcript JSON  ·  State JSON" },
      ],
    },
  },
];

export function HelpScreen() {
  const [tab, setTab] = useState<HelpTab>("build");
  const [activeTopicSection, setActiveTopicSection] = useState<SectionId>("builder");
  const topics = tab === "build" ? buildTopics : operateTopics;
  const activeTopic = topics.find((topic) => topic.section === activeTopicSection) ?? topics[0];

  const selectTab = (nextTab: HelpTab) => {
    setTab(nextTab);
    setActiveTopicSection(nextTab === "build" ? "builder" : "deployments");
  };

  return (
    <main id="main-content" className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-bg)] p-6 max-md:p-4">
      <div className="mx-auto max-w-[1080px]">
        <div>
          <h2 className="text-xl font-extrabold tracking-[-0.03em] text-[var(--text)]">Help</h2>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Step-by-step guidance for building Voice Agents and operating real calls.
          </p>
        </div>

        <div className="mt-6 flex gap-1 border-b border-[var(--border)]" role="tablist" aria-label="Help sections">
          {(
            [
              ["build", "Build", buildTopics.length],
              ["operate", "Operate", operateTopics.length],
            ] as Array<[HelpTab, string, number]>
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              aria-controls={`help-${id}`}
              onClick={() => selectTab(id)}
              className={cn(
                "flex h-11 cursor-pointer items-center gap-2 border-b-2 px-4 text-xs font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                tab === id
                  ? "border-[var(--blue)] text-[var(--blue)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]",
              )}
            >
              {label}
              <Badge>{count}</Badge>
            </button>
          ))}
        </div>

        <section id={`help-${tab}`} role="tabpanel" aria-label={`${tab === "build" ? "Build" : "Operate"} guides`}>
          <div
            className="mt-5 flex gap-1 overflow-x-auto border-b border-[var(--border)]"
            role="tablist"
            aria-label={`${tab === "build" ? "Build" : "Operate"} topics`}
          >
            {topics.map((topic) => (
              <button
                key={topic.section}
                type="button"
                role="tab"
                aria-selected={activeTopic?.section === topic.section}
                aria-controls={`help-topic-${topic.section}`}
                onClick={() => setActiveTopicSection(topic.section)}
                className={cn(
                  "flex h-11 shrink-0 cursor-pointer items-center border-b-2 px-4 text-xs font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                  activeTopic?.section === topic.section
                    ? "border-[var(--blue)] text-[var(--blue)]"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]",
                )}
              >
                {topic.title}
              </button>
            ))}
          </div>

          {activeTopic && (
            <div id={`help-topic-${activeTopic.section}`} role="tabpanel" className="mt-5">
              <HelpGuide topic={activeTopic} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function HelpGuide({ topic }: { topic: HelpTopic }) {
  const Icon = topic.icon;
  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--blue-soft)] text-[var(--blue)]">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-[var(--text)]">{topic.title}</h3>
          <p className="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">{topic.description}</p>
        </div>
      </div>

      <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(360px,1.2fr)] gap-5 border-b border-[var(--border)] p-5 max-lg:grid-cols-1">
        <section aria-labelledby={`before-${topic.section}`}>
          <p
            id={`before-${topic.section}`}
            className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--text-muted)]"
          >
            Before you start
          </p>
          <p className="mt-2 text-[11px] leading-6 text-[var(--text-secondary)]">{topic.prerequisite}</p>
          <div className="mt-4 rounded-xl border border-[var(--blue-border)] bg-[var(--blue-soft)] px-4 py-3">
            <p className="text-[9px] font-extrabold uppercase tracking-[0.1em] text-[var(--blue)]">Good to know</p>
            <p className="mt-1.5 text-[10px] leading-5 text-[var(--text-secondary)]">{topic.note}</p>
          </div>
        </section>
        <UiExample preview={topic.preview} />
      </div>

      <section className="p-5" aria-labelledby={`steps-${topic.section}`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p
              id={`steps-${topic.section}`}
              className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--text-muted)]"
            >
              Step-by-step
            </p>
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              Follow the controls in order. Each change is explained before the next step.
            </p>
          </div>
          <Badge tone="blue">{topic.steps.length} steps</Badge>
        </div>
        <ol className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {topic.steps.map((step, index) => (
            <li
              key={step.title}
              className="grid grid-cols-[32px_minmax(150px,0.45fr)_minmax(0,1fr)] gap-4 py-4 max-md:grid-cols-[32px_minmax(0,1fr)]"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--blue-soft)] text-[10px] font-extrabold text-[var(--blue)] ring-1 ring-inset ring-[var(--blue-border)]">
                {index + 1}
              </span>
              <div>
                <p className="text-[11px] font-bold text-[var(--text)]">{step.title}</p>
                <span className="mt-2 inline-flex min-h-6 items-center rounded-md border border-[var(--border-strong)] bg-[var(--surface-subtle)] px-2 font-mono text-[9px] font-bold text-[var(--text-secondary)]">
                  {step.control}
                </span>
              </div>
              <div className="max-md:col-start-2">
                <p className="text-[11px] leading-5 text-[var(--text-secondary)]">{step.description}</p>
                <div className="mt-2 flex items-start gap-2 text-[10px] leading-5 text-[var(--text-muted)]">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--green)]" aria-hidden="true" />
                  <span>{step.result}</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </article>
  );
}

function UiExample({ preview }: { preview: HelpPreview }) {
  return (
    <figure aria-label={`${preview.title} UI example`}>
      <figcaption className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--text-muted)]">
        Simplified UI example
      </figcaption>
      <div className="overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface-subtle)] shadow-sm">
        <div className="flex h-8 items-center gap-1.5 border-b border-[var(--border)] bg-[var(--surface)] px-3">
          <span className="h-2 w-2 rounded-full bg-[var(--red-soft)] ring-1 ring-inset ring-[var(--red-border)]" />
          <span className="h-2 w-2 rounded-full bg-[var(--amber-soft)] ring-1 ring-inset ring-[var(--amber-border)]" />
          <span className="h-2 w-2 rounded-full bg-[var(--green-soft)] ring-1 ring-inset ring-[var(--green-border)]" />
          <span className="ml-2 text-[8px] font-semibold text-[var(--text-muted)]">Voice Agent Studio</span>
        </div>
        <div className="p-3.5">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[11px] font-bold text-[var(--text)]">{preview.title}</p>
            <Badge tone={preview.statusTone}>{preview.status}</Badge>
            {preview.action && (
              <span className="inline-flex h-7 items-center rounded-md bg-[var(--primary)] px-2.5 text-[9px] font-bold text-white shadow-sm">
                {preview.action}
              </span>
            )}
          </div>
          {preview.tabs && (
            <div className="mt-3 flex gap-3 overflow-hidden border-b border-[var(--border)]">
              {preview.tabs.map((tab) => (
                <span
                  key={tab}
                  className={cn(
                    "shrink-0 border-b-2 pb-2 text-[8px] font-bold",
                    tab === preview.activeTab
                      ? "border-[var(--blue)] text-[var(--blue)]"
                      : "border-transparent text-[var(--text-muted)]",
                  )}
                >
                  {tab}
                </span>
              ))}
            </div>
          )}
          <div className="mt-3 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)]">
            {preview.rows.map((row) => (
              <div
                key={`${row.label}-${row.value}`}
                className="grid grid-cols-[104px_minmax(0,1fr)] gap-3 border-b border-[var(--border)] px-3 py-2.5 last:border-b-0 max-sm:grid-cols-1 max-sm:gap-1"
              >
                <span className="text-[8px] font-bold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                  {row.label}
                </span>
                <span className="min-w-0 break-words font-mono text-[9px] leading-4 text-[var(--text-secondary)]">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
