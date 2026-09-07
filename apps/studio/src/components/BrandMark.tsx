import studioLogoUrl from "../assets/voice-agent-studio.svg";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <img src={studioLogoUrl} alt={compact ? "Voice Agent Studio" : ""} className="h-8 w-9 shrink-0 object-contain" />
      {!compact && (
        <div className="whitespace-nowrap text-[14px] font-extrabold tracking-[-0.03em] text-[var(--text)]">
          Voice Agent Studio
        </div>
      )}
    </div>
  );
}
