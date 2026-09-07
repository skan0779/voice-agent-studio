import { describe, expect, it } from "vitest";
import { defaultPlatformSettings, migratePlatformSettings } from "./settings";

const initialPlatformSettings = defaultPlatformSettings;

describe("platform settings migration", () => {
  it("does not ship a default phone number", () => {
    expect(defaultPlatformSettings.environmentVariables.twilioPhoneNumber).toBe("");
  });

  it("reduces the previous multi-environment settings to one deployment", () => {
    const migrated = migratePlatformSettings(
      {
        endpoints: [{ provider: "openai", url: "https://custom.openai.test/v1" }],
        secrets: [{ name: "OPENAI_API_KEY", maskedValue: "••••test" }],
        environments: [{ id: "production" }],
      },
      initialPlatformSettings,
    );

    expect(migrated.connections.publicUrl).toBe("");
    expect(migrated.connections.telephonyIntegration).toBe("media_streams");
    expect(migrated.environmentVariables.openaiEndpoint).toBe("https://custom.openai.test/v1");
    expect(migrated.environmentVariables.openaiApiKey).toBe("");
  });

  it("migrates the legacy ngrok URL and adds Media Streams", () => {
    const migrated = migratePlatformSettings(
      {
        connections: { ngrokUrl: "https://voice.example.test" },
        environmentVariables: initialPlatformSettings.environmentVariables,
      },
      initialPlatformSettings,
    );

    expect(migrated.connections).toEqual({
      publicUrl: "https://voice.example.test",
      telephonyIntegration: "media_streams",
    });
  });

  it("keeps the provider-neutral public URL", () => {
    const migrated = migratePlatformSettings(
      {
        connections: { publicUrl: "https://voice.example.test", telephonyIntegration: "media_streams" },
        environmentVariables: initialPlatformSettings.environmentVariables,
      },
      initialPlatformSettings,
    );

    expect(migrated.connections.publicUrl).toBe("https://voice.example.test");
  });
});
