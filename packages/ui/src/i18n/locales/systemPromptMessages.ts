export const systemPromptMessagesZhCN: Record<string, string> = {
  "settings.systemPrompt.title": "系统提示词",
  "settings.systemPrompt.kernel": "Agent 内核",
  "settings.systemPrompt.managedBase":
    "此内核的默认提示词由其运行时管理，暂不可读取全文。填写正文可覆盖基座；留空使用默认，自动扩展仍保留。",
  "settings.systemPrompt.baseTitle": "本应用的主智能体基础提示词",
  "settings.systemPrompt.effectiveBase": "当前目标生效的基础提示词",
  "settings.systemPrompt.baseDescription":
    "可修改所选内核主智能体的基础正文，保存后从下一轮输入生效；其它内核不受影响。自动注入内容在下方单独显示。",
  "settings.systemPrompt.save": "保存提示词",
  "settings.systemPrompt.restore": "恢复默认",
  "settings.systemPrompt.saved": "提示词已保存，将从下一轮输入生效",
  "settings.systemPrompt.saveError": "保存提示词失败，请重试",
  "settings.systemPrompt.injectedTitle": "自动注入的提示词",
  "settings.systemPrompt.injectedDescription":
    "这些内容由运行时按来源组装，只读显示。选择当前会话可查看实际配置与最近一次发送给模型的系统提示词。",
  "settings.systemPrompt.refresh": "刷新",
  "settings.systemPrompt.target": "查看目标",
  "settings.systemPrompt.workspacePreview": "工作区默认配置预览",
  "settings.systemPrompt.previewDescription":
    "预览不包含会话专用输出风格、记忆和 Hook 结果；选择已运行的会话查看实际注入内容。",
  "settings.systemPrompt.session": "会话",
  "settings.systemPrompt.loading": "正在读取运行时提示词…",
  "settings.systemPrompt.loadError": "无法读取当前目标的提示词，请刷新重试。",
  "settings.systemPrompt.noWorkspace": "选择工作区后可查看默认正文和自动注入内容。",
  "settings.systemPrompt.busy": "当前轮次保留已有配置，保存的改动将从下一轮输入生效。",
  "settings.systemPrompt.readOnly": "只读",
  "settings.systemPrompt.role.system": "系统消息",
  "settings.systemPrompt.role.meta_user": "上下文提醒（user）",
  "settings.systemPrompt.lastRequest": "最近一次实际模型请求",
  "settings.systemPrompt.lastRequestDescription":
    "这是该会话最近发给模型的 system 内容，可能与下一轮采用的配置不同。",
  "settings.systemPrompt.noRequest": "当前进程尚未记录此会话的模型请求。",
  "settings.systemPrompt.nativeInspectionLimited":
    "此原生内核管理默认提示词和动态上下文；页面显示应用覆盖正文与可读取的扩展，未取得完整请求快照时不会显示为完整提示词。",
};

export const systemPromptMessagesEnUS: Record<string, string> = {
  "settings.systemPrompt.title": "System prompt",
  "settings.systemPrompt.kernel": "Agent kernel",
  "settings.systemPrompt.managedBase":
    "This kernel manages its default prompt and does not expose its full text. Enter instructions to override the base, or leave them empty to use the default. Automatic additions remain enabled.",
  "settings.systemPrompt.baseTitle": "This app's main agent base prompt",
  "settings.systemPrompt.effectiveBase": "Current target's effective base prompt",
  "settings.systemPrompt.baseDescription":
    "Edit the selected kernel's main agent base. Changes apply on the next input and do not affect other kernels. Automatic additions are shown separately below.",
  "settings.systemPrompt.save": "Save prompt",
  "settings.systemPrompt.restore": "Restore default",
  "settings.systemPrompt.saved": "Prompt saved. It will apply on the next input.",
  "settings.systemPrompt.saveError": "Could not save the prompt. Please retry.",
  "settings.systemPrompt.injectedTitle": "Automatically added prompts",
  "settings.systemPrompt.injectedDescription":
    "The runtime assembles these instructions. They are read-only. Select a session to inspect its configuration and the last system prompt sent to the model.",
  "settings.systemPrompt.refresh": "Refresh",
  "settings.systemPrompt.target": "Inspection target",
  "settings.systemPrompt.workspacePreview": "Workspace default preview",
  "settings.systemPrompt.previewDescription":
    "The preview excludes session output styles, memory, and hook results. Select a running session to inspect its actual additions.",
  "settings.systemPrompt.session": "Session",
  "settings.systemPrompt.loading": "Reading runtime prompts…",
  "settings.systemPrompt.loadError": "Could not read prompts for this target. Refresh to retry.",
  "settings.systemPrompt.noWorkspace":
    "Select a workspace to inspect its default prompt and automatic additions.",
  "settings.systemPrompt.busy":
    "The current turn keeps its configuration. Saved changes apply on the next input.",
  "settings.systemPrompt.readOnly": "Read-only",
  "settings.systemPrompt.role.system": "System message",
  "settings.systemPrompt.role.meta_user": "Context reminder (user)",
  "settings.systemPrompt.lastRequest": "Last model request",
  "settings.systemPrompt.lastRequestDescription":
    "These are the system messages last sent by this session. The next turn may use updated settings.",
  "settings.systemPrompt.noRequest":
    "This process has not recorded a model request for this session yet.",
  "settings.systemPrompt.nativeInspectionLimited":
    "This native kernel manages its default prompt and dynamic context. This view shows the app override and inspectable additions; an unavailable complete request snapshot is never presented as a complete prompt.",
};
