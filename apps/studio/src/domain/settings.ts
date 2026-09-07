import type { PlatformSettings } from "./flow";

export const defaultPlatformSettings: PlatformSettings = {
  connections: { publicUrl: "", telephonyIntegration: "media_streams" },
  environmentVariables: {
    twilioAccountSid: "",
    twilioAuthToken: "",
    twilioPhoneNumber: "",
    openaiEndpoint: "https://api.openai.com/v1",
    openaiApiKey: "",
  },
};

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function migratePlatformSettings(raw: unknown, fallback: PlatformSettings): PlatformSettings {
  if (!isRecord(raw)) return structuredClone(fallback);

  if (isRecord(raw.connections) && isRecord(raw.environmentVariables)) {
    return {
      connections: {
        publicUrl:
          typeof raw.connections.publicUrl === "string"
            ? raw.connections.publicUrl
            : typeof raw.connections.ngrokUrl === "string"
              ? raw.connections.ngrokUrl
              : fallback.connections.publicUrl,
        telephonyIntegration: raw.connections.telephonyIntegration === "sip" ? "sip" : "media_streams",
      },
      environmentVariables: {
        twilioAccountSid:
          typeof raw.environmentVariables.twilioAccountSid === "string"
            ? raw.environmentVariables.twilioAccountSid
            : fallback.environmentVariables.twilioAccountSid,
        twilioAuthToken:
          typeof raw.environmentVariables.twilioAuthToken === "string"
            ? raw.environmentVariables.twilioAuthToken
            : fallback.environmentVariables.twilioAuthToken,
        twilioPhoneNumber:
          typeof raw.environmentVariables.twilioPhoneNumber === "string"
            ? raw.environmentVariables.twilioPhoneNumber
            : fallback.environmentVariables.twilioPhoneNumber,
        openaiEndpoint:
          typeof raw.environmentVariables.openaiEndpoint === "string"
            ? raw.environmentVariables.openaiEndpoint
            : fallback.environmentVariables.openaiEndpoint,
        openaiApiKey:
          typeof raw.environmentVariables.openaiApiKey === "string"
            ? raw.environmentVariables.openaiApiKey
            : fallback.environmentVariables.openaiApiKey,
      },
    };
  }

  const endpoints = Array.isArray(raw.endpoints) ? raw.endpoints.filter(isRecord) : [];
  const openaiEndpoint = endpoints.find((endpoint) => endpoint.provider === "openai")?.url;
  return {
    ...structuredClone(fallback),
    environmentVariables: {
      ...fallback.environmentVariables,
      openaiEndpoint:
        typeof openaiEndpoint === "string" ? openaiEndpoint : fallback.environmentVariables.openaiEndpoint,
    },
  };
}
