import {
  TID_V4_COMPOSER_AGENT_KERNEL,
  TID_V4_COMPOSER_AGENT_KERNEL_OPTION,
  testId,
  BUILT_IN_AGENT_KERNELS,
  type AgentKernelId,
  type AgentKernelDescriptor,
} from "@zcode/shared";
import { memo } from "react";
import { ChevronDownIcon, CpuIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export type ComposerAgentKernel = AgentKernelId;

export const AgentKernelSelect = memo(function AgentKernelSelect({
  value,
  kernels = BUILT_IN_AGENT_KERNELS,
  disabled,
  disabledReason,
  existingSession,
  loading,
  open,
  onOpenChange,
  onSelect,
}: {
  value: ComposerAgentKernel;
  kernels?: readonly AgentKernelDescriptor[];
  disabled?: boolean;
  disabledReason?: string;
  existingSession: boolean;
  loading?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (kernel: ComposerAgentKernel) => void;
}) {
  const { intl } = useZCodeIntl();
  const label = loading
    ? intl.formatMessage({ id: "common.loading" })
    : (kernels.find((kernel) => kernel.id === value)?.label ?? value);
  const title =
    disabledReason ??
    intl.formatMessage({
      id: existingSession ? "chat.agentKernel.newConversation" : "chat.agentKernel.label",
    });
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          title={title}
          aria-label={`${intl.formatMessage({ id: "chat.agentKernel.label" })}: ${label}`}
          data-testid={TID_V4_COMPOSER_AGENT_KERNEL}
          data-agent-kernel={loading ? undefined : value}
          className="h-7 shrink-0 gap-1 px-1.5 text-ui-caption"
        >
          <CpuIcon className="size-3.5 @max-sm/composer:hidden" aria-hidden="true" />
          <span>{label}</span>
          <ChevronDownIcon className="size-3 @max-sm/composer:hidden" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (!disabled && kernels.some((kernel) => kernel.id === next) && next !== value)
              onSelect(next);
          }}
        >
          {kernels.map((kernel) => (
            <DropdownMenuRadioItem
              key={kernel.id}
              value={kernel.id}
              data-testid={testId(TID_V4_COMPOSER_AGENT_KERNEL_OPTION, kernel.id)}
            >
              {kernel.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});
