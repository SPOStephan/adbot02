import type { FunnelConfig, FunnelPage } from "./funnel";

const clone = <T>(value: T): T => structuredClone(value);

export function duplicateFunnelPage(config: FunnelConfig, pageId: string, createId = () => crypto.randomUUID()): FunnelConfig {
  const index = config.pages.findIndex(page => page.id === pageId);
  if (index < 0) return config;
  const source = config.pages[index];
  const duplicate = clone(source) as FunnelPage;
  duplicate.id = createId();
  duplicate.name = `${source.name} – Kopie`;
  if (duplicate.type === "choice-grid" || duplicate.type === "choice-list") {
    duplicate.questionKey = `${duplicate.questionKey}-${duplicate.id.slice(0, 8)}`;
    duplicate.options = duplicate.options.map(option => ({ ...option, id: createId() }));
  }
  const pages = [...config.pages];
  pages.splice(index + 1, 0, duplicate);
  return { ...config, pages };
}

export function moveFunnelPage(config: FunnelConfig, pageId: string, direction: -1 | 1): FunnelConfig {
  const index = config.pages.findIndex(page => page.id === pageId);
  if (index <= 0 || index >= config.pages.length - 1) return config;
  const target = index + direction;
  if (target <= 0 || target >= config.pages.length - 1) return config;
  const pages = [...config.pages];
  [pages[index], pages[target]] = [pages[target]!, pages[index]!];
  return { ...config, pages };
}

export function deleteFunnelPage(config: FunnelConfig, pageId: string): FunnelConfig {
  const page = config.pages.find(item => item.id === pageId);
  if (!page || page.type === "start" || page.type === "contact" || config.pages.length <= 2) return config;
  return { ...config, pages: config.pages.filter(item => item.id !== pageId) };
}
