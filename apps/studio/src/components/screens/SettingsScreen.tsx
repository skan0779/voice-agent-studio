import { Bot, Eye, EyeOff, KeyRound, Link2, PhoneCall, RadioTower, Save } from "lucide-react";
import { useMemo, useState } from "react";
import type { PlatformSettings } from "../../domain/flow";
import { cn } from "../../lib/cn";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Field";

type SettingsTab = "connections" | "environments";
type SecretFieldId = "twilioAuthToken" | "openaiApiKey";

export function SettingsScreen({
  settings,
  onChange,
  onSave,
}: {
  settings: PlatformSettings;
  onChange: (settings: PlatformSettings) => void;
  onSave: () => Promise<void>;
}) {
  const [tab, setTab] = useState<SettingsTab>("connections");
  const [visibleSecrets, setVisibleSecrets] = useState<Record<SecretFieldId, boolean>>({
    twilioAuthToken: false,
    openaiApiKey: false,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const configuredVariables = useMemo(
    () => Object.values(settings.environmentVariables).filter((value) => value.trim()).length,
    [settings.environmentVariables],
  );
  const publicUrlValid = useMemo(() => {
    if (!settings.connections.publicUrl.trim()) return false;
    try {
      return new URL(settings.connections.publicUrl).protocol === "https:";
    } catch {
      return false;
    }
  }, [settings.connections.publicUrl]);
  const updateConnection = (patch: Partial<PlatformSettings["connections"]>) => {
    onChange({ ...settings, connections: { ...settings.connections, ...patch } });
  };
  const updateVariable = <K extends keyof PlatformSettings["environmentVariables"]>(
    key: K,
    value: PlatformSettings["environmentVariables"][K],
  ) => {
    onChange({
      ...settings,
      environmentVariables: { ...settings.environmentVariables, [key]: value },
    });
  };
  const toggleSecret = (id: SecretFieldId) => {
    setVisibleSecrets((current) => ({ ...current, [id]: !current[id] }));
  };
  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save Settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <main id="main-content" className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-bg)] p-6 max-md:p-4">
      <div className="mx-auto max-w-[1080px]">
        <div className="flex items-end justify-between gap-4 max-sm:items-start">
          <div>
            <h2 className="text-xl font-extrabold tracking-[-0.03em] text-[var(--text)]">Settings</h2>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Manage external connections and Runtime environment variables. Configure model behavior in the Start
              block.
            </p>
          </div>
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            <Save className="h-4 w-4" /> Save
          </Button>
        </div>

        {saveError && (
          <div
            className="mt-5 rounded-xl border border-[var(--red-border)] bg-[var(--red-soft)] px-4 py-3 text-xs font-semibold text-[var(--red)]"
            role="alert"
          >
            {saveError}
          </div>
        )}

        <section className="mt-6 grid grid-cols-2 gap-4 max-md:grid-cols-1" aria-label="Settings summary">
          <StatusCard
            icon={Link2}
            label="Connection"
            value="Media Streams"
            status={publicUrlValid ? "Ready" : "Required"}
            tone={publicUrlValid ? "green" : "amber"}
          />
          <StatusCard
            icon={KeyRound}
            label="Environment"
            value={`${configuredVariables}/5`}
            status={configuredVariables === 5 ? "Ready" : "Required"}
            tone={configuredVariables === 5 ? "green" : "amber"}
          />
        </section>

        <div className="mt-6 flex gap-1 border-b border-[var(--border)]" role="tablist" aria-label="Settings sections">
          {(
            [
              ["connections", "Connections", 2],
              ["environments", "Environments", 5],
            ] as Array<[SettingsTab, string, number]>
          ).map(([id, label, count]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
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

        {tab === "connections" && (
          <section className="mt-5 space-y-4" aria-label="Connection settings">
            <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
              <div className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--purple-soft)] text-[var(--purple)]">
                  <PhoneCall className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-[var(--text)]">Telephony Integration</h3>
                  <p className="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
                    Choose how phone audio is connected to the Voice Agent Runtime.
                  </p>
                </div>
                <Badge tone="green" dot>
                  Configured
                </Badge>
              </div>
              <div
                className="grid grid-cols-2 gap-3 p-5 max-md:grid-cols-1"
                role="radiogroup"
                aria-label="Telephony Integration"
              >
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--blue-border)] bg-[var(--blue-soft)] p-4">
                  <input
                    type="radio"
                    name="telephony-integration"
                    value="media_streams"
                    checked={settings.connections.telephonyIntegration === "media_streams"}
                    onChange={() => updateConnection({ telephonyIntegration: "media_streams" })}
                    className="mt-0.5 accent-[var(--blue)]"
                  />
                  <span>
                    <span className="block text-[11px] font-bold text-[var(--text)]">Twilio Media Streams</span>
                    <span className="mt-1 block text-[9px] leading-4 text-[var(--text-muted)]">
                      Twilio streams call audio to the Runtime over WebSocket.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-not-allowed items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4 opacity-65">
                  <input
                    type="radio"
                    name="telephony-integration"
                    value="sip"
                    disabled
                    checked={settings.connections.telephonyIntegration === "sip"}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[11px] font-bold text-[var(--text)]">
                      SIP <Badge>Coming Soon</Badge>
                    </span>
                    <span className="mt-1 block text-[9px] leading-4 text-[var(--text-muted)]">
                      Connect telephony through a SIP trunk without the Media Streams bridge.
                    </span>
                  </span>
                </label>
              </div>
            </article>

            <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
              <div className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--blue-soft)] text-[var(--blue)]">
                  <RadioTower className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-[var(--text)]">Public URL</h3>
                  <p className="mt-1 text-[10px] leading-5 text-[var(--text-muted)]">
                    Public Base URL used by Twilio Webhooks and Media Streams to reach the Runtime.
                  </p>
                </div>
                <Badge tone={publicUrlValid ? "green" : "amber"} dot>
                  {publicUrlValid ? "Configured" : "Required"}
                </Badge>
              </div>
              <div className="p-5">
                <Input
                  id="public-url"
                  aria-label="PUBLIC_URL"
                  type="url"
                  value={settings.connections.publicUrl}
                  onChange={(event) => updateConnection({ publicUrl: event.target.value })}
                  placeholder="https://voice.example.com"
                  className="font-mono text-xs"
                  aria-invalid={settings.connections.publicUrl ? !publicUrlValid : undefined}
                />
              </div>
            </article>
          </section>
        )}

        {tab === "environments" && (
          <section className="mt-5 space-y-4" aria-label="Runtime environment variables">
            <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
              <EnvironmentCard
                icon={RadioTower}
                title="Twilio Environment"
                description="Used for outbound calls and Media Streams authentication."
                configured={
                  [
                    settings.environmentVariables.twilioAccountSid,
                    settings.environmentVariables.twilioAuthToken,
                    settings.environmentVariables.twilioPhoneNumber,
                  ].filter((value) => value.trim()).length
                }
                total={3}
              >
                <Field label="TWILIO_ACCOUNT_SID" htmlFor="twilio-account-sid">
                  <Input
                    id="twilio-account-sid"
                    value={settings.environmentVariables.twilioAccountSid}
                    onChange={(event) => updateVariable("twilioAccountSid", event.target.value)}
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="font-mono text-xs"
                    autoComplete="off"
                  />
                </Field>
                <SecretField
                  id="twilio-auth-token"
                  label="TWILIO_AUTH_TOKEN"
                  value={settings.environmentVariables.twilioAuthToken}
                  visible={visibleSecrets.twilioAuthToken}
                  onToggle={() => toggleSecret("twilioAuthToken")}
                  onChange={(value) => updateVariable("twilioAuthToken", value)}
                />
                <Field label="TWILIO_PHONE_NUMBER" htmlFor="twilio-phone-number">
                  <Input
                    id="twilio-phone-number"
                    type="tel"
                    value={settings.environmentVariables.twilioPhoneNumber}
                    onChange={(event) => updateVariable("twilioPhoneNumber", event.target.value)}
                    placeholder="+19179607135"
                    className="font-mono text-xs"
                    autoComplete="tel"
                  />
                </Field>
              </EnvironmentCard>

              <EnvironmentCard
                icon={Bot}
                title="OpenAI Environment"
                description="Used for Realtime session connectivity and authentication."
                configured={
                  [settings.environmentVariables.openaiEndpoint, settings.environmentVariables.openaiApiKey].filter(
                    (value) => value.trim(),
                  ).length
                }
                total={2}
              >
                <Field label="OPENAI_ENDPOINT" htmlFor="openai-endpoint">
                  <Input
                    id="openai-endpoint"
                    type="url"
                    value={settings.environmentVariables.openaiEndpoint}
                    onChange={(event) => updateVariable("openaiEndpoint", event.target.value)}
                    placeholder="https://api.openai.com/v1"
                    className="font-mono text-xs"
                  />
                </Field>
                <SecretField
                  id="openai-api-key"
                  label="OPENAI_API_KEY"
                  value={settings.environmentVariables.openaiApiKey}
                  visible={visibleSecrets.openaiApiKey}
                  onToggle={() => toggleSecret("openaiApiKey")}
                  onChange={(value) => updateVariable("openaiApiKey", value)}
                />
              </EnvironmentCard>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function SecretField({
  id,
  label,
  value,
  visible,
  onToggle,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  visible: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Enter a value"
          autoComplete="new-password"
          className="pr-11 font-mono text-xs"
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-1 top-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-[var(--text-muted)] outline-none hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </Field>
  );
}

function EnvironmentCard({
  icon: Icon,
  title,
  description,
  configured,
  total,
  children,
}: {
  icon: typeof Bot;
  title: string;
  description: string;
  configured: number;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
      <div className="flex items-start gap-3 border-b border-[var(--border)] px-5 py-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-subtle)] text-[var(--text-secondary)]">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-[var(--text)]">{title}</h3>
          <p className="mt-1 text-[9px] leading-4 text-[var(--text-muted)]">{description}</p>
        </div>
        <Badge tone={configured === total ? "green" : "amber"} dot>
          {configured}/{total}
        </Badge>
      </div>
      <div className="space-y-5 p-5">{children}</div>
    </article>
  );
}

function StatusCard({
  icon: Icon,
  label,
  value,
  status,
  tone,
}: {
  icon: typeof Link2;
  label: string;
  value: string;
  status: string;
  tone: "green" | "amber";
}) {
  const color = tone === "green" ? "var(--green)" : "var(--amber)";
  return (
    <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xs">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface-subtle)]">
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)]">{label}</p>
          <p className="mt-0.5 text-sm font-extrabold text-[var(--text)]">{value}</p>
        </div>
        <Badge className="ml-auto" tone={tone} dot>
          {status}
        </Badge>
      </div>
    </article>
  );
}
