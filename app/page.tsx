import Workspace from './workspace';
import { catalog } from '@/lib/evaluation';
import { parseView, type SearchParams } from '@/lib/view';

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <Workspace initialView={parseView(await searchParams, catalog)} />;
}
