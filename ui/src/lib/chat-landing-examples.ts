export interface ChatLandingExample {
  id: string
  label: string | null
  title: string
  prompt: string
}

export function chatLandingExampleGroups(
  t: (key: string) => string,
  product?: string | null,
): ChatLandingExample[][] {
  if (product === 'nano') {
    return [[
      {
        id: 'workspace',
        label: t('chatLanding.workspaceAuditLabel'),
        title: t('chatLanding.workspaceAuditTitle'),
        prompt: t('chatLanding.workspaceAuditPrompt'),
      },
      {
        id: 'code-review',
        label: t('chatLanding.codeReviewLabel'),
        title: t('chatLanding.codeReviewTitle'),
        prompt: t('chatLanding.codeReviewPrompt'),
      },
      {
        id: 'inbox',
        label: t('chatLanding.inboxTriageLabel'),
        title: t('chatLanding.inboxTriageTitle'),
        prompt: t('chatLanding.inboxTriagePrompt'),
      },
    ]]
  }

  return [
    [
      {
        id: 'market',
        label: t('chatLanding.marketBriefLabel'),
        title: t('chatLanding.marketBriefTitle'),
        prompt: t('chatLanding.marketBriefPrompt'),
      },
      {
        id: 'portfolio',
        label: t('chatLanding.portfolioReviewLabel'),
        title: t('chatLanding.portfolioReviewTitle'),
        prompt: t('chatLanding.portfolioReviewPrompt'),
      },
      {
        id: 'thesis',
        label: t('chatLanding.researchMemoLabel'),
        title: t('chatLanding.researchMemoTitle'),
        prompt: t('chatLanding.researchMemoPrompt'),
      },
    ],
    [
      {
        id: 'workspace',
        label: t('chatLanding.workspaceAuditLabel'),
        title: t('chatLanding.workspaceAuditTitle'),
        prompt: t('chatLanding.workspaceAuditPrompt'),
      },
      {
        id: 'automation',
        label: t('chatLanding.automationLabel'),
        title: t('chatLanding.automationTitle'),
        prompt: t('chatLanding.automationPrompt'),
      },
      {
        id: 'quant',
        label: t('chatLanding.quantDeskLabel'),
        title: t('chatLanding.quantDeskTitle'),
        prompt: t('chatLanding.quantDeskPrompt'),
      },
    ],
  ]
}
