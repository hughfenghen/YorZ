import type { Component } from 'solid-js'
import { Page } from '@/components/Page.jsx'
import { t } from '@/i18n/index.js'

/**
 * 首页占位。业务功能（spec 列表、会话）尚未接入，这里只验证外壳链路：
 * 路由 → Page 骨架 → 主题令牌 → i18n。
 */
export const Home: Component = () => (
  <Page title={t('home.title')}>
    <section class="rounded-lg border border-border bg-card p-4">
      <h2 class="text-sm font-medium">{t('home.scaffoldTitle')}</h2>
      <p class="mt-2 text-sm text-muted-foreground">{t('home.scaffoldBody')}</p>
      <p class="mt-2 text-xs text-muted-foreground">{t('home.scaffoldHint')}</p>
    </section>
  </Page>
)
