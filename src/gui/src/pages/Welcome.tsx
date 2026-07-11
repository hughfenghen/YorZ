import { type Component } from 'solid-js'
import { t } from '../i18n/index.js'

export const WelcomePage: Component = () => {
  return (
    <section class="p-8">
      <header class="mb-4">
        <h1 class="text-2xl font-bold">{t('welcome.title')}</h1>
      </header>
      <p class="text-muted-foreground">{t('welcome.description')}</p>
      <p class="mt-4 text-muted-foreground">
        {t('welcome.addHint')}
        <code class="ml-1 rounded bg-muted px-1.5 py-0.5 font-mono text-sm">yorz add &lt;path&gt;</code>
      </p>
    </section>
  )
}
