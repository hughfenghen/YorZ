import type { Component } from 'solid-js'
import { Page } from '@/components/Page.jsx'
import { t } from '@/i18n/index.js'

/** Spec 列表占位。接入 API 后在这里换成真实列表。 */
export const Specs: Component = () => (
  <Page title={t('specs.title')}>
    <p class="py-16 text-center text-sm text-muted-foreground">{t('specs.empty')}</p>
  </Page>
)
