import type { Component } from 'solid-js'
import { A } from '@solidjs/router'
import { Page } from '@/components/Page.jsx'
import { t } from '@/i18n/index.js'
import { buttonVariants } from '@/components/ui/button.jsx'

export const NotFound: Component = () => (
  <Page title={t('notFound.title')}>
    <div class="flex flex-col items-center gap-4 py-16">
      <p class="text-sm text-muted-foreground">{t('notFound.title')}</p>
      <A href="/" class={buttonVariants({ variant: 'outline' })}>
        {t('notFound.back')}
      </A>
    </div>
  </Page>
)
