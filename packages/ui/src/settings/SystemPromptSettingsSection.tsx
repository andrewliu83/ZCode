import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Textarea } from "@/components/ui/textarea.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { toast } from "@/components/ui/toast.js";
import { useSettings } from "@/hooks/useSettingService.js";
import {
  useCurrentPromptSession,
  useSystemPromptInspection,
} from "@/hooks/useSystemPromptInspection.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

export function SystemPromptSettingsSection(props: {
  workspacePath?: string | null;
  workspaceIdentity?: string | null;
  remoteSessionId?: string | null;
}) {
  const { intl, locale } = useZCodeIntl();
  const text = (key: string) => intl.formatMessage({ id: `settings.systemPrompt.${key}` });
  const { settings, update } = useSettings();
  const currentSessionId = useCurrentPromptSession(props.workspacePath, props.workspaceIdentity);
  const [target, setTarget] = useState<string | null>(null);
  const sessionId = target === null ? currentSessionId : target || undefined;
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { snapshot, loading, error, refresh } = useSystemPromptInspection({
    ...props,
    sessionId,
    mainSystemPrompt: settings?.mainSystemPrompt,
    thinkrailEnabled: settings?.thinkrailEnabled,
  });
  const saved = settings?.mainSystemPrompt?.trim() || snapshot?.defaultPrompt || "";
  const value = draft ?? saved;
  const dirty = value.trim() !== saved;
  const errorMessage =
    error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : typeof error === "string"
        ? error
        : undefined;
  const save = async (restore: boolean) => {
    setSaving(true);
    try {
      await update({ mainSystemPrompt: restore ? "" : value.trim() });
      setDraft(null);
      await refresh();
      toast(text("saved"));
    } catch (saveError) {
      logger.warn("[system-prompt] 保存失败", {
        error: saveError instanceof Error ? saveError.message : String(saveError),
      });
      toast(text("saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="settings-system-prompt">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">{text("baseTitle")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{text("baseDescription")}</p>
        </div>
        <Textarea
          aria-label={text("baseTitle")}
          data-testid="settings-system-prompt-editor"
          value={value}
          onChange={(event) => setDraft(event.target.value)}
          disabled={!settings || saving}
          maxLength={65536}
          className="field-sizing-fixed min-h-64 max-h-[60vh] resize-y font-mono text-xs leading-relaxed"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="settings-system-prompt-save"
            onClick={() => void save(false)}
            disabled={!dirty || saving || !settings}
          >
            {text("save")}
          </Button>
          <Button
            variant="outline"
            data-testid="settings-system-prompt-restore"
            onClick={() => void save(true)}
            disabled={saving || !settings || (!settings.mainSystemPrompt?.trim() && draft === null)}
          >
            {text("restore")}
          </Button>
        </div>
      </section>
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{text("injectedTitle")}</h3>
          <Button
            variant="outline"
            size="sm"
            disabled={loading || !props.workspacePath}
            onClick={() => void refresh()}
          >
            <RefreshCw className="mr-1.5 size-3.5" />
            {text("refresh")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{text("injectedDescription")}</p>
        {props.workspacePath && (
          <div className="space-y-2">
            <p className="break-all text-xs text-muted-foreground">{props.workspacePath}</p>
            <Select
              value={sessionId ?? "workspace"}
              onValueChange={(next) => setTarget(next === "workspace" ? "" : next)}
            >
              <SelectTrigger
                aria-label={text("target")}
                className="w-full"
                data-testid="settings-system-prompt-target"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="workspace">{text("workspacePreview")}</SelectItem>
                {sessionId &&
                  !snapshot?.availableSessions?.some(
                    (session) => session.sessionId === sessionId,
                  ) && (
                    <SelectItem value={sessionId}>
                      {text("session")} {sessionId.slice(-8)}
                    </SelectItem>
                  )}
                {snapshot?.availableSessions?.map((session) => (
                  <SelectItem key={session.sessionId} value={session.sessionId}>
                    {text("session")} {session.sessionId.slice(-8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {loading && <p className="text-xs text-muted-foreground">{text("loading")}</p>}
        {error != null && (
          <p className="text-xs text-destructive" role="alert">
            {text("loadError")}
            {errorMessage && <span className="mt-1 block break-words">{errorMessage}</span>}
          </p>
        )}
        {!props.workspacePath && (
          <p className="text-xs text-muted-foreground">{text("noWorkspace")}</p>
        )}
        {snapshot?.authority === "workspace" && (
          <p className="text-xs text-muted-foreground">{text("previewDescription")}</p>
        )}
        {snapshot?.busy && <p className="text-xs text-muted-foreground">{text("busy")}</p>}
        {snapshot && (
          <details
            className="rounded-xl border border-border bg-card"
            data-prompt-source="base_prompt"
          >
            <summary className="cursor-pointer px-4 py-3 text-xs font-medium">
              {text("effectiveBase")} · {text("readOnly")}
            </summary>
            <div className="px-3 pb-3">
              <Textarea
                readOnly
                aria-label={text("effectiveBase")}
                value={snapshot.basePrompt}
                className="field-sizing-fixed min-h-48 max-h-[60vh] resize-y bg-background font-mono text-xs leading-relaxed"
              />
            </div>
          </details>
        )}
        {snapshot?.sections.map((section, index) => (
          <details
            key={`${section.source}:${index}`}
            open={section.source === "thinkrail"}
            className="rounded-xl border border-border bg-card"
            data-prompt-source={section.source}
          >
            <summary className="cursor-pointer px-4 py-3 text-xs font-medium">
              {section.name}
              <span className="ml-2 font-normal text-muted-foreground">
                {text(`role.${section.injectionTarget}`)} · {text("readOnly")}
              </span>
            </summary>
            <div className="px-3 pb-3">
              <Textarea
                readOnly
                aria-label={`${section.name} ${text("readOnly")}`}
                value={section.content}
                className="field-sizing-fixed min-h-48 max-h-[60vh] resize-y bg-background font-mono text-xs leading-relaxed"
              />
            </div>
          </details>
        ))}
        {snapshot?.authority === "session" &&
          (snapshot.lastRequest ? (
            <details
              className="rounded-xl border border-border bg-card"
              data-testid="settings-system-prompt-last-request"
            >
              <summary className="cursor-pointer px-4 py-3 text-xs font-medium">
                {text("lastRequest")} · {new Date(snapshot.lastRequest.at).toLocaleString(locale)}
              </summary>
              <p className="px-4 pb-2 text-xs text-muted-foreground">
                {text("lastRequestDescription")}
              </p>
              <div className="px-3 pb-3">
                <Textarea
                  readOnly
                  aria-label={text("lastRequest")}
                  value={snapshot.lastRequest.systemMessages.join("\n\n")}
                  className="field-sizing-fixed min-h-64 max-h-[60vh] resize-y bg-background font-mono text-xs leading-relaxed"
                />
              </div>
            </details>
          ) : (
            <p className="text-xs text-muted-foreground">{text("noRequest")}</p>
          ))}
      </section>
    </div>
  );
}
