'use client';
import { createContext, useContext } from 'react';
import { copy, label, caseTitle, severityText, scenarioTitle, scenarioDescription, statusText, metricTitle, metricDefinition, type Locale } from '@/lib/i18n';
export const LocaleContext = createContext<Locale>('en');
export function useLocale() {
  const locale = useContext(LocaleContext);
  return { locale, t: (en: string, de: string) => copy(locale, en, de), label: (key: string) => label(locale, key), caseTitle: (id: string, fallback?: string) => caseTitle(locale, id, fallback), severityText: (value?: string) => severityText(locale, value), scenarioTitle: (value: Parameters<typeof scenarioTitle>[1]) => scenarioTitle(locale, value), scenarioDescription: (value: Parameters<typeof scenarioDescription>[1]) => scenarioDescription(locale, value), statusText: (value: string) => statusText(locale, value), metricTitle: (key: string) => metricTitle(locale, key), metricDefinition: (key: string) => metricDefinition(locale, key) };
}
